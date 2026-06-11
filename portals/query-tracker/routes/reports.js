const express = require('express');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const Query = require('../models/Query');
const { auth } = require('../middlewares/auth');

const router = express.Router();

// Helper function to format query data for export
const formatQueryForExport = (query) => {
  return {
    'Platform': query.platform,
    'Customer Name': query.customerName,
    'Customer Mobile': query.customerMobile,
    'Customer Email': query.customerEmail || '',
    'Company Name': query.companyName || '',
    'Location': query.location || '',
    'Customer Query': query.customerQuery,
    'How did you hear about us?': query.howDidYouHearAboutUs || '',
    'Agent Remark': query.agentRemark || '',
    'Query Received Date': query.queryReceivedDate ? new Date(query.queryReceivedDate).toLocaleDateString() : '',
    'Agent Calling Date': query.agentCallingDate ? new Date(query.agentCallingDate).toLocaleDateString() : '',
    'Status': query.status,
    'Created By': query.createdBy?.name || '',
    'Assigned To': query.assignedTo?.name || ''
  };
};

// @route   GET /api/reports/:type
// @desc    Get report data
// @access  Private
router.get('/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    let query = {};

    // Build query based on type
    switch (type) {
      case 'all':
        // Admin sees all, users see only their queries
        if (req.user.role !== 'admin') {
          query.$or = [
            { createdBy: req.user._id },
            { assignedTo: req.user._id }
          ];
        }
        break;
      case 'my':
        query.createdBy = req.user._id;
        break;
      case 'open':
        query.status = 'Open';
        if (req.user.role !== 'admin') {
          query.$or = [
            { createdBy: req.user._id },
            { assignedTo: req.user._id }
          ];
        }
        break;
      case 'closed':
        query.status = 'Closed';
        if (req.user.role !== 'admin') {
          query.$or = [
            { createdBy: req.user._id },
            { assignedTo: req.user._id }
          ];
        }
        break;
      case 'in-progress':
        query.status = 'In-Progress';
        if (req.user.role !== 'admin') {
          query.$or = [
            { createdBy: req.user._id },
            { assignedTo: req.user._id }
          ];
        }
        break;
      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    const queries = await Query.find(query)
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 });

    const formattedData = queries.map(formatQueryForExport);

    res.json({ data: formattedData, count: formattedData.length });
  } catch (error) {
    console.error('[Reports Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/reports/:type/excel
// @desc    Download report as Excel
// @access  Private
router.get('/:type/excel', auth, async (req, res) => {
  try {
    const { type } = req.params;
    let query = {};

    switch (type) {
      case 'all':
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'my':
        query.createdBy = req.user._id;
        break;
      case 'open':
        query.status = 'Open';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'closed':
        query.status = 'Closed';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'in-progress':
        query.status = 'In-Progress';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    const queries = await Query.find(query)
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 });

    const formattedData = queries.map(formatQueryForExport);

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Queries');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_queries_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('[Reports Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/reports/:type/pdf
// @desc    Download report as PDF
// @access  Private
router.get('/:type/pdf', auth, async (req, res) => {
  try {
    const { type } = req.params;
    let query = {};

    switch (type) {
      case 'all':
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'my':
        query.createdBy = req.user._id;
        break;
      case 'open':
        query.status = 'Open';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'closed':
        query.status = 'Closed';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'in-progress':
        query.status = 'In-Progress';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    const queries = await Query.find(query)
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 });

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_queries_${Date.now()}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text(`${type.toUpperCase()} Queries Report`, { align: 'center' });
    doc.moveDown();

    queries.forEach((query, index) => {
      doc.fontSize(12).text(`Query ${index + 1}:`, { underline: true });
      doc.fontSize(10);
      doc.text(`Platform: ${query.platform}`);
      doc.text(`Customer: ${query.customerName}`);
      doc.text(`Mobile: ${query.customerMobile}`);
      doc.text(`Email: ${query.customerEmail || 'N/A'}`);
      doc.text(`Company: ${query.companyName || 'N/A'}`);
      doc.text(`Location: ${query.location || 'N/A'}`);
      doc.text(`Query: ${query.customerQuery}`);
      doc.text(`How did you hear about us?: ${query.howDidYouHearAboutUs || 'N/A'}`);
      doc.text(`Status: ${query.status}`);
      doc.text(`Received Date: ${query.queryReceivedDate ? new Date(query.queryReceivedDate).toLocaleDateString() : 'N/A'}`);
      doc.moveDown();
    });

    doc.end();
  } catch (error) {
    console.error('[Reports Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/reports/:type/csv
// @desc    Download report as CSV
// @access  Private
router.get('/:type/csv', auth, async (req, res) => {
  try {
    const { type } = req.params;
    let query = {};

    switch (type) {
      case 'all':
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'my':
        query.createdBy = req.user._id;
        break;
      case 'open':
        query.status = 'Open';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'closed':
        query.status = 'Closed';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      case 'in-progress':
        query.status = 'In-Progress';
        if (req.user.role !== 'admin') {
          query.$or = [{ createdBy: req.user._id }, { assignedTo: req.user._id }];
        }
        break;
      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    const queries = await Query.find(query)
      .populate('createdBy', 'name')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 });

    const formattedData = queries.map(formatQueryForExport);

    if (formattedData.length === 0) {
      return res.status(404).json({ message: 'No data to export' });
    }

    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const timestamp = Date.now();
    const filePath = path.join(os.tmpdir(), `${type}_queries_${timestamp}.csv`);

    const headers = Object.keys(formattedData[0]).map(key => ({ id: key, title: key }));
    const csvWriter = createCsvWriter({
      path: filePath,
      header: headers
    });

    await csvWriter.writeRecords(formattedData);

    const fileContent = fs.readFileSync(filePath);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_queries_${timestamp}.csv`);
    res.send(fileContent);

    fs.unlinkSync(filePath);
  } catch (error) {
    console.error('[Reports Route Error]', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

