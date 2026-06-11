const express = require('express');
const { body, validationResult } = require('express-validator');
const Query = require('../models/Query');
const { auth } = require('../middlewares/auth');

const router = express.Router();

// @route   GET /api/queries
// @desc    Get all queries with filters
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { 
      status, 
      assignedTo, 
      createdBy, 
      search,
      page = 1, 
      limit = 10 
    } = req.query;

    const query = {};
    const orConditions = [];

    // If user is not admin, only show their queries or assigned queries
    if (req.user.role !== 'admin') {
      orConditions.push(
        { createdBy: req.user._id },
        { assignedTo: req.user._id }
      );
    }

    if (status) query.status = status;
    if (assignedTo) query.assignedTo = assignedTo;
    if (createdBy) query.createdBy = createdBy;

    // Global search filter
    if (search) {
      orConditions.push(
        { customerName: { $regex: search, $options: 'i' } },
        { customerMobile: { $regex: search, $options: 'i' } },
        { queryType: { $regex: search, $options: 'i' } }
      );
    }

    // Combine all OR conditions
    if (orConditions.length > 0) {
      if (orConditions.length === 1) {
        Object.assign(query, orConditions[0]);
      } else {
        query.$or = orConditions;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const queries = await Query.find(query)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Query.countDocuments(query);

    res.json({
      queries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[Queries Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/queries/:id
// @desc    Get single query
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const query = await Query.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    if (!query) {
      return res.status(404).json({ message: 'Query not found' });
    }

    // Check access
    if (req.user.role !== 'admin' && 
        query.createdBy._id.toString() !== req.user._id.toString() &&
        (!query.assignedTo || query.assignedTo._id.toString() !== req.user._id.toString())) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(query);
  } catch (error) {
    console.error('[Queries Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/queries
// @desc    Create a new query
// @access  Private
router.post('/', [
  body('platform').isIn(['Website', 'Email', 'Phone', 'WhatsApp']).withMessage('Invalid platform'),
  body('customerName').trim().notEmpty().withMessage('Customer name is required'),
  body('customerMobile').trim().notEmpty().withMessage('Customer mobile is required'),
  body('customerQuery').trim().notEmpty().withMessage('Customer query is required')
], auth, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const queryData = {
      ...req.body,
      createdBy: req.user._id
    };

    // Handle empty assignedTo - only include if it's a valid non-empty value
    if (req.body.assignedTo && req.body.assignedTo.trim() !== '') {
      queryData.assignedTo = req.body.assignedTo;
    } else {
      // Remove assignedTo if it's empty to avoid ObjectId casting error
      delete queryData.assignedTo;
    }

    if (req.body.queryReceivedDate) {
      queryData.queryReceivedDate = new Date(req.body.queryReceivedDate);
    }
    if (req.body.agentCallingDate) {
      queryData.agentCallingDate = new Date(req.body.agentCallingDate);
    }

    const query = new Query(queryData);
    await query.save();

    const populatedQuery = await Query.findById(query._id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    res.status(201).json(populatedQuery);
  } catch (error) {
    console.error('[Queries Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/queries/:id
// @desc    Update a query
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const query = await Query.findById(req.params.id);

    if (!query) {
      return res.status(404).json({ message: 'Query not found' });
    }

    // Check access: user can only update their own queries, admin can update any
    if (req.user.role !== 'admin' && 
        query.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Handle empty assignedTo - only include if it's a valid non-empty value
    const updateData = { ...req.body };
    if (req.body.assignedTo !== undefined) {
      if (req.body.assignedTo && req.body.assignedTo.trim() !== '') {
        updateData.assignedTo = req.body.assignedTo;
      } else {
        // Set to null if empty to clear the assignment
        updateData.assignedTo = null;
      }
    }

    Object.assign(query, updateData);

    if (req.body.queryReceivedDate) {
      query.queryReceivedDate = new Date(req.body.queryReceivedDate);
    }
    if (req.body.agentCallingDate) {
      query.agentCallingDate = new Date(req.body.agentCallingDate);
    }

    await query.save();

    const populatedQuery = await Query.findById(query._id)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email');

    res.json(populatedQuery);
  } catch (error) {
    console.error('[Queries Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/queries/:id
// @desc    Delete a query
// @access  Private (Admin or Query Creator)
router.delete('/:id', auth, async (req, res) => {
  try {
    const query = await Query.findById(req.params.id);

    if (!query) {
      return res.status(404).json({ message: 'Query not found' });
    }

    // Check access: user can only delete their own queries, admin can delete any
    if (req.user.role !== 'admin' && 
        query.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own queries' });
    }

    await Query.findByIdAndDelete(req.params.id);

    res.json({ message: 'Query deleted successfully' });
  } catch (error) {
    console.error('[Queries Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

