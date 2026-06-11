/**
 * Cross-company / optional-company recruitment admin (recruiters CRUD, interviews aggregate).
 */
const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');

async function listRecruiters(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    
    const { getUsersCollection } = require('../../../config/mongo');
    let recruiters = [];
    const recruiterMap = new Map(); // Use Map to avoid duplicates
    
    try {
      if (!company || company === 'all' || company === 'undefined') {
        // Get recruiters from all companies for admin portal
        const companyNames = ['Ecosoul Home', 'Thrive'];
        for (const companyName of companyNames) {
          try {
            const usersCol = await getUsersCollection(null, companyName);
            const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
            employees.forEach(emp => {
              const name = emp.name || emp.firstName;
              if (name && name !== 'Unknown') {
                // Use email as key to avoid duplicates
                const key = emp.email || name;
                if (!recruiterMap.has(key)) {
                  recruiterMap.set(key, {
                    id: emp._id?.toString(),
                    name: name,
                    email: emp.email || '',
                    role: emp.role || 'recruiter',
                    phone: emp.phone || emp.mobile || ''
                  });
                }
              }
            });
          } catch (err) {
            // Continue to next company
          }
        }
        recruiters = Array.from(recruiterMap.values());
      } else {
        // Get recruiters from specific company
        const usersCol = await getUsersCollection(null, company);
        const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
        recruiters = employees.map(emp => ({
          id: emp._id?.toString(),
          name: emp.name || emp.firstName || 'Unknown',
          email: emp.email || '',
          role: emp.role || 'recruiter',
          phone: emp.phone || emp.mobile || ''
        })).filter(emp => emp.name !== 'Unknown');
      }
    } catch (err) {
      console.error('Error fetching recruiters:', err);
    }
    
    res.json({
      success: true,
      data: recruiters
    });
  } catch (error) {
    console.error('HRMS get recruiters error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function createRecruiter(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { name, email, phone, role } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }
    
    const { getUsersCollection } = require('../../../config/mongo');
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    const usersCol = await getUsersCollection(null, companyName);
    
    // Check if email already exists
    const existing = await usersCol.findOne({ email: email.toLowerCase() });
    if (existing) {
      // If a user already exists with this email, update them to be a recruiter
      const updatedRecruiter = {
        name: name,
        firstName: name.split(' ')[0] || name,
        lastName: name.split(' ').slice(1).join(' ') || '',
        phone: phone || existing.phone || '',
        role: role || 'recruiter',
        status: 'active',
        updatedAt: new Date()
      };

      await usersCol.updateOne(
        { _id: existing._id },
        { $set: updatedRecruiter }
      );

      return res.json({
        success: true,
        message: 'Recruiter updated successfully',
        data: {
          id: existing._id.toString(),
          email: existing.email,
          ...updatedRecruiter
        }
      });
    }
    
    // Create new recruiter
    const recruiter = {
      name: name,
      firstName: name.split(' ')[0] || name,
      lastName: name.split(' ').slice(1).join(' ') || '',
      email: email.toLowerCase(),
      phone: phone || '',
      role: role || 'recruiter',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await usersCol.insertOne(recruiter);
    
    res.json({
      success: true,
      message: 'Recruiter added successfully',
      data: {
        id: result.insertedId.toString(),
        ...recruiter
      }
    });
  } catch (error) {
    console.error('HRMS add recruiter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

async function updateRecruiter(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const recruiterId = req.params.id;
    const { name, email, phone, role } = req.body;
    
    if (!recruiterId) {
      return res.status(400).json({
        success: false,
        error: 'Recruiter ID is required'
      });
    }
    
    const { getUsersCollection } = require('../../../config/mongo');
    const { ObjectId } = require('mongodb');
    
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    const usersCol = await getUsersCollection(null, companyName);
    
    // Validate ObjectId
    if (!ObjectId.isValid(recruiterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recruiter ID format'
      });
    }
    
    // Check if email is being changed and if it already exists
    if (email) {
      const existing = await usersCol.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: new ObjectId(recruiterId) }
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Recruiter with this email already exists'
        });
      }
    }
    
    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name) {
      updateData.name = name;
      updateData.firstName = name.split(' ')[0] || name;
      updateData.lastName = name.split(' ').slice(1).join(' ') || '';
    }
    if (email) {
      updateData.email = email.toLowerCase();
    }
    if (phone !== undefined) {
      updateData.phone = phone;
    }
    if (role) {
      updateData.role = role;
    }
    
    // Update recruiter
    const result = await usersCol.updateOne(
      { _id: new ObjectId(recruiterId) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Recruiter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Recruiter updated successfully'
    });
  } catch (error) {
    console.error('HRMS update recruiter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

async function deleteRecruiter(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const recruiterId = req.params.id;
    
    if (!recruiterId) {
      return res.status(400).json({
        success: false,
        error: 'Recruiter ID is required'
      });
    }
    
    const { getUsersCollection } = require('../../../config/mongo');
    const { ObjectId } = require('mongodb');
    
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    const usersCol = await getUsersCollection(null, companyName);
    
    // Validate ObjectId
    if (!ObjectId.isValid(recruiterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid recruiter ID format'
      });
    }
    
    // Check if recruiter is assigned to any candidates
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    const recruiter = await usersCol.findOne({ _id: new ObjectId(recruiterId) });
    
    if (recruiter) {
      const recruiterName = recruiter.name || recruiter.firstName || '';
      const assignedCandidates = await recruitmentCol.countDocuments({ assignedTo: recruiterName });
      
      if (assignedCandidates > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete recruiter. ${assignedCandidates} candidate(s) are assigned to this recruiter. Please reassign them first.`
        });
      }
    }
    
    // Delete recruiter
    const result = await usersCol.deleteOne({ _id: new ObjectId(recruiterId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Recruiter not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Recruiter deleted successfully'
    });
  } catch (error) {
    console.error('HRMS delete recruiter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

async function listInterviews(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { status, interviewer, date, search } = req.query;
    
    // For HRMS Admin Portal - get data from all companies if no company specified
    let candidates = [];
    
    if (!company || company === 'all' || company === 'undefined') {
      // Get all databases and aggregate data
      const dbs = await getAllHrmsDbs();
      const allCandidatesPromises = dbs.map(async (db) => {
        const recruitmentCol = db.collection('recruitment');
        
        // Build query - only candidates with scheduled interviews
        const query = {
          $or: [
            { status: 'Interview Scheduled' },
            { interviewDate: { $exists: true, $ne: null } },
            { interviewScheduledAt: { $exists: true, $ne: null } }
          ]
        };
        
        // Filter by status
        if (status && status !== 'All Status') {
          query.status = status;
        }
        
        // Filter by interviewer
        if (interviewer && interviewer !== 'All Interviewers') {
          query.interviewer = interviewer;
        }
        
        // Filter by date
        if (date) {
          const startDate = new Date(date);
          startDate.setHours(0, 0, 0, 0);
          const endDate = new Date(date);
          endDate.setHours(23, 59, 59, 999);
          
          // Add date filter to existing query
          const dateQuery = {
            $or: [
              { interviewDate: { $gte: startDate, $lte: endDate } },
              { interviewScheduledAt: { $gte: startDate, $lte: endDate } }
            ]
          };
          
          if (query.$and) {
            query.$and.push(dateQuery);
          } else {
            query.$and = [dateQuery];
          }
        }
        
        // Search filter
        if (search) {
          query.$and = query.$and || [];
          query.$and.push({
            $or: [
              { candidateName: { $regex: search, $options: 'i' } },
              { email: { $regex: search, $options: 'i' } },
              { contactNumber: { $regex: search, $options: 'i' } },
              { interviewer: { $regex: search, $options: 'i' } }
            ]
          });
        }
        
        return await recruitmentCol.find(query).toArray();
      });
      
      const allCandidatesArrays = await Promise.all(allCandidatesPromises);
      candidates = allCandidatesArrays.flat();
    } else {
      // Get HRMS database for specific company
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      
      // Build query - only candidates with scheduled interviews
      const query = {
        $or: [
          { status: 'Interview Scheduled' },
          { interviewDate: { $exists: true, $ne: null } },
          { interviewScheduledAt: { $exists: true, $ne: null } }
        ]
      };
      
      // Filter by status
      if (status && status !== 'All Status') {
        query.status = status;
      }
      
      // Filter by interviewer
      if (interviewer && interviewer !== 'All Interviewers') {
        query.interviewer = interviewer;
      }
      
      // Filter by date
      if (date) {
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
        
        // Add date filter to existing query
        const dateQuery = {
          $or: [
            { interviewDate: { $gte: startDate, $lte: endDate } },
            { interviewScheduledAt: { $gte: startDate, $lte: endDate } }
          ]
        };
        
        if (query.$and) {
          query.$and.push(dateQuery);
        } else {
          query.$and = [dateQuery];
        }
      }
      
      // Search filter
      if (search) {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { candidateName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { contactNumber: { $regex: search, $options: 'i' } },
            { interviewer: { $regex: search, $options: 'i' } }
          ]
        });
      }
      
      candidates = await recruitmentCol.find(query).toArray();
    }
    
    // Transform to interview format
    const interviews = candidates
      .filter(candidate => candidate.interviewDate || candidate.interviewScheduledAt)
      .map((candidate, index) => {
        const interviewDate = candidate.interviewDate || candidate.interviewScheduledAt;
        const interviewTime = candidate.interviewTime || '';
        const scheduledDateTime = interviewDate ? new Date(interviewDate) : null;
        
        // Determine interview status
        let interviewStatus = 'Scheduled';
        if (scheduledDateTime) {
          const now = new Date();
          if (scheduledDateTime < now) {
            interviewStatus = 'Completed';
          } else if (scheduledDateTime.getTime() - now.getTime() < 24 * 60 * 60 * 1000) {
            interviewStatus = 'Upcoming';
          }
        }
        
        return {
          id: candidate._id?.toString() || index + 1,
          candidateId: candidate._id?.toString(),
          candidateName: candidate.candidateName || 'Unknown',
          email: candidate.email || 'N/A',
          contact: candidate.contactNumber || 'N/A',
          position: candidate.position || candidate.jobTitle || 'N/A',
          interviewer: candidate.interviewer || 'N/A',
          interviewDate: candidate.interviewDate || candidate.interviewScheduledAt,
          interviewTime: candidate.interviewTime || 'N/A',
          meetingLink: candidate.meetingLink || 'N/A',
          status: candidate.status || 'Interview Scheduled',
          interviewStatus: interviewStatus,
          scheduledAt: candidate.interviewScheduledAt || candidate.interviewDate,
          assignedTo: candidate.assignedTo || 'Unassigned'
        };
      })
      .sort((a, b) => {
        // Sort by scheduled date/time
        const dateA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
        const dateB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
        return dateB - dateA; // Most recent first
      });
    
    // Get unique interviewers for filter
    const interviewers = [...new Set(interviews.map(i => i.interviewer).filter(Boolean))];
    
    res.json({
      success: true,
      data: {
        interviews: interviews,
        interviewers: ['All Interviewers', ...interviewers]
      }
    });
  } catch (error) {
    console.error('HRMS get interviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

module.exports = {
  listRecruiters,
  createRecruiter,
  updateRecruiter,
  deleteRecruiter,
  listInterviews,
};
