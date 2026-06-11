const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');

async function getLeavePolicy(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const db = await getHrmsDb(company);
    const col = db.collection('leave_policies');
    
    // Try to get company-specific policy
    let policy = await col.findOne({ company: company || null });
    
    // If no company-specific policy, return default
    if (!policy) {
      policy = {
        company: company || null,
        '0-6months': {
          casualLeave: 0,
          sickLeave: 3,
          earnedLeave: 0,
          compOff: 0
        },
        '6-12months': {
          casualLeave: 6,
          sickLeave: 6,
          earnedLeave: 0,
          compOff: 0
        },
        '1year+': {
          casualLeave: 12,
          sickLeave: 6,
          earnedLeave: 10,
          compOff: 0
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    
    res.json({
      success: true,
      data: {
        '0-6months': policy['0-6months'] || policy['0-6 Months'] || {
          casualLeave: 0,
          sickLeave: 3,
          earnedLeave: 0,
          compOff: 0
        },
        '6-12months': policy['6-12months'] || policy['6-12 Months'] || {
          casualLeave: 6,
          sickLeave: 6,
          earnedLeave: 0,
          compOff: 0
        },
        '1year+': policy['1year+'] || policy['1 Year+'] || {
          casualLeave: 12,
          sickLeave: 6,
          earnedLeave: 10,
          compOff: 0
        }
      }
    });
  } catch (error) {
    console.error('HRMS leave-policy GET error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function putLeavePolicy(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { '0-6months': months0_6, '6-12months': months6_12, '1year+': year1Plus } = req.body;
    
    if (!months0_6 || !months6_12 || !year1Plus) {
      return res.status(400).json({
        success: false,
        error: 'All tenure policies are required'
      });
    }
    
    // Get HRMS database
    const db = await getHrmsDb(company);
    const col = db.collection('leave_policies');
    
    const policy = {
      company: company || null,
      '0-6months': months0_6,
      '6-12months': months6_12,
      '1year+': year1Plus,
      updatedAt: new Date()
    };
    
    // Upsert policy
    await col.updateOne(
      { company: company || null },
      { 
        $set: policy,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    
    res.json({
      success: true,
      message: 'Leave policy updated successfully',
      data: policy
    });
  } catch (error) {
    console.error('HRMS leave-policy PUT error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

module.exports = {
  getLeavePolicy,
  putLeavePolicy,
};
