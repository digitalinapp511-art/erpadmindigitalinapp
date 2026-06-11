const { connectMongo } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');

async function listEmployees(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { search, department, status, payrollCompany } = req.query;
    
    const { getUsersCollection } = require('../../../config/mongo');
    let usersCol;
    try {
      usersCol = await getUsersCollection(null, company);
    } catch (err) {
      console.error(`[employees] Error getting employees for ${company}:`, err);
      return res.status(500).json({ success: false, error: 'Failed to load employees for this company.' });
    }
    
    // Build query (always scope to company)
    const query = { company };
    if (payrollCompany && payrollCompany !== 'all') {
      const pc = String(payrollCompany).trim();
      if (pc) {
        if (pc === 'Beacon IQ') {
          query.payrollCompany = { $in: ['Beacon IQ', 'BeaconIQ'] };
        } else {
          query.payrollCompany = pc;
        }
      }
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (department) {
      query.department = department;
    }
    
    if (status) {
      const s = String(status).trim().toLowerCase();
      // DB uses isActive/active flags (admin portal), not a `status` string.
      // Interpret common values.
      if (s === 'active' || s === 'current') {
        query.isActive = { $ne: false };
      } else if (s === 'inactive' || s === 'ex' || s === 'terminated' || s === 'resigned') {
        query.isActive = false;
      } else {
        // Backward-compat: if some collections truly store status as string.
        query.status = status;
      }
    }
    
    // Fetch employees
    const employees = await usersCol.find(query).toArray();
    
    // Transform to frontend format
    const formattedEmployees = employees.map(emp => ({
      id: emp._id.toString(),
      employeeId: emp.employeeId || emp.email?.split('@')[0] || 'N/A',
      name: emp.name || emp.firstName || 'Unknown',
      email: emp.email || '',
      department: emp.department || 'General',
      designation: emp.designation || emp.role || 'Employee',
      status: emp.status || 'active',
      phone: emp.phone || emp.mobile || '',
      joiningDate: emp.joiningDate || emp.createdAt || null,
      location: emp.location || '',
      payrollCompany: emp.payrollCompany || '',
      // IMPORTANT: Attendance APIs use `emp_code` as the biometric/employee code identifier.
      // Expose it as `biometricId` so UI filters (Absent/Present sets) match correctly.
      biometricId: emp.emp_code || emp.biometricId || emp.employeeId || emp.email?.split('@')[0] || ''
    }));
    
    res.json({
      success: true,
      data: {
        employees: formattedEmployees,
        total: formattedEmployees.length
      }
    });
  } catch (error) {
    console.error('HRMS employees error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

module.exports = {
  listEmployees,
};
