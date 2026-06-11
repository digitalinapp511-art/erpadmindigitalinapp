const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { getUsersCollection, getWarehouseUsersCollection, getDb, LOGIN_DB_NAME } = require('../../../config/mongo');
const {
  encryptAnnualCtcForStorage,
  decryptAnnualCtcStored,
} = require('../../../utils/ctcEncryption');

const DEPARTMENT_MANAGERS_COLLECTION = 'department_managers';
const UI_SETTINGS_COLLECTION = 'ui_settings';

async function getDepartmentManagersCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(DEPARTMENT_MANAGERS_COLLECTION);
}

async function getUiSettingsCollection() {
  const db = await getDb(LOGIN_DB_NAME);
  return db.collection(UI_SETTINGS_COLLECTION);
}

async function getUsersCollectionForRequest(req) {
  if (req?.usersCollectionType === 'warehouse') {
    return getWarehouseUsersCollection();
  }
  return getUsersCollection();
}

/**
 * Check if a user is a dummy/test user
 * @param {Object} user - User object
 * @returns {boolean} - True if user is dummy/test user
 */
function resolveCompanyFromQuery(company) {
  if (!company || company === 'undefined' || company === 'all') return null;
  const lc = String(company).trim().toLowerCase();
  if (lc.includes('thrive')) return 'Thrive';
  if (lc.includes('ecosoul') || lc === '1') return 'Ecosoul Home';
  return String(company).trim();
}

function normalizeDepartmentName(value) {
  return String(value || '').trim().toLowerCase();
}

function isDummyUser(user) {
  const email = (user.email || '').toLowerCase();
  const name = (user.name || '').toLowerCase();
  
  // Common dummy/test patterns
  const dummyEmailPatterns = [
    'test@',
    'dummy@',
    'example@',
    'sample@',
    'demo@',
    '@test.',
    '@example.',
    '@dummy.',
    'admin@test',
    'user@test',
    'testuser@',
    'dummyuser@'
  ];
  
  const dummyNamePatterns = [
    'test user',
    'dummy user',
    'example user',
    'sample user',
    'demo user',
    'test account',
    'dummy account',
    'test data',
    'testuser',
    'dummyuser',
    'testadmin',
    'test admin'
  ];
  
  // Check email patterns
  const isDummyEmail = dummyEmailPatterns.some(pattern => email.includes(pattern));
  
  // Check name patterns
  const isDummyName = dummyNamePatterns.some(pattern => name.includes(pattern));
  
  // Also check if email is very short or suspicious
  const isSuspiciousEmail = email.length < 5 || email.split('@').length !== 2;
  
  return isDummyEmail || isDummyName || isSuspiciousEmail;
}

// @route   GET /api/admin-users
// @desc    Get all users for admin portal (from Employees_List database)
// @access  Private/Admin
// @query   filterDummy - Optional: set to 'true' to filter out dummy/test users
// @query   company - Optional: filter users by company name (e.g., 'Ecosoul Home', 'Thrive')

async function listUsers(req, res) {
  try {
    const { filterDummy, company, payrollCompany } = req.query;
    const shouldFilterDummy = filterDummy === 'true';
    
    const resolvedCompany = resolveCompanyFromQuery(company);
    if (!resolvedCompany) {
      return res.status(400).json({
        success: false,
        error: 'Company is required. Please ensure your company is selected.'
      });
    }
    
    const usersCol = await getUsersCollectionForRequest(req);
    const query = { company: resolvedCompany };
    if (payrollCompany && payrollCompany !== 'all') {
      const pc = String(payrollCompany).trim();
      if (pc) {
        // Back-compat: older values may be stored as 'BeaconIQ' (no space)
        if (pc === 'Beacon IQ') {
          query.payrollCompany = { $in: ['Beacon IQ', 'BeaconIQ'] };
        } else {
          query.payrollCompany = pc;
        }
      }
    }
    const allUsers = await usersCol.find(query).toArray();
    
    console.log(`[admin-users] Fetched ${allUsers.length} users from employee_details in ${LOGIN_DB_NAME} for company: ${resolvedCompany}`);
    
    // By default, show ALL users. Only filter if explicitly requested
    let usersToReturn = allUsers;
    let dummyCount = 0;
    
    if (shouldFilterDummy) {
      usersToReturn = allUsers.filter(user => !isDummyUser(user));
      dummyCount = allUsers.length - usersToReturn.length;
      if (dummyCount > 0) {
        console.log(`[admin-users] Filtered out ${dummyCount} dummy/test users`);
      }
    } else {
      console.log(`[admin-users] Showing all ${allUsers.length} users from database`);
    }
    
    // Transform users to include all fields
    const transformedUsers = usersToReturn.map(user => ({
      id: user._id?.toString(),
      _id: user._id?.toString(),
      name: user.name || '',
      email: user.email || '',
      password: '', // Don't send password
      active: user.isActive !== false, // Default to true if not set
      portals: user.portals || [], // Array of portal names
      role: user.role || 'user',
      employeeId: user.employeeId || '',
      department: user.department || '',
      company: user.company || '',
      hasCredentialAccess: user.hasCredentialAccess !== false,
      hasSubscriptionAccess: user.hasSubscriptionAccess !== false,
      
      // Personal details
      phone: user.phone || '',
      workPhone: user.workPhone || '',
      homePhone: user.homePhone || '',
      personalEmail: user.personalEmail || '',
      fatherName: user.fatherName || '',
      dateOfBirth: user.dateOfBirth || '',
      actualDob: user.actualDob || '',
      gender: user.gender || '',
      maritalStatus: user.maritalStatus || '',
      bloodGroup: user.bloodGroup || '',
      presentAddress: user.presentAddress || '',
      permanentAddress: user.permanentAddress || '',
      emergencyPhone: user.emergencyPhone || '',
      emergencyRelation: user.emergencyRelation || '',
      familyDetails: user.familyDetails || '',
      age: user.age || '',
      
      // Work details
      jobTitle: user.jobTitle || '',
      payrollCompany: user.payrollCompany || '',
      location: user.location || '',
      reportingManager: user.reportingManager || '',
      joiningDate: user.joiningDate || '',
      exitDate: user.exitDate || '',
      card_no: user.card_no || '',
      emp_code: user.emp_code || '',
      
      // Bank & Insurance
      bankAccount: user.bankAccount || '',
      ifsc: user.ifsc || '',
      bankName: user.bankName || '',
      pan: user.pan || '',
      aadhaar: user.aadhaar || '',
      rationNumber: user.rationNumber || '',
      bankBranchName: user.bankBranchName || '',
      uan: user.uan || '',
      esiNo: user.esiNo || '',
      pfNo: user.pfNo || '',
      annualCtc: decryptAnnualCtcStored(user.annualCtc),
      pfRule: user.pfRule || 'NEW',
      pfSlabId: user.pfSlabId || '',
      
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));

    // Log response details
    console.log(`[admin-users] Returning ${transformedUsers.length} users to frontend`);
    if (transformedUsers.length > 0) {
      console.log(`[admin-users] Sample user:`, {
        id: transformedUsers[0].id,
        name: transformedUsers[0].name,
        email: transformedUsers[0].email,
        employeeId: transformedUsers[0].employeeId
      });
    }

    res.json({
      success: true,
      users: transformedUsers,
      total: transformedUsers.length,
      filtered: dummyCount,
      database: LOGIN_DB_NAME, // Show which database was used
      collection: 'employee_details',
      message: `Fetched ${transformedUsers.length} users from employee_details in ${LOGIN_DB_NAME} database`
    });
  } catch (error) {
    console.error('[Admin Users GET Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch users'
    });
  }
}

// @route   GET /api/admin-users/departments/list
// @desc    Get unique list of departments from employees
// @access  Private/Admin
// @query   company - Required: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')

async function listDepartments(req, res) {
  try {
    const { company } = req.query;
    const resolvedCompany = resolveCompanyFromQuery(company);

    if (!resolvedCompany) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required to fetch departments'
      });
    }

    const usersCol = await getUsersCollectionForRequest(req);

    console.log(`[admin-users/departments] Fetching departments for company: ${resolvedCompany}`);

    // Same source as listUsers (employee_details), scoped to selected company
    const users = await usersCol.find({
      company: resolvedCompany,
      $or: [
        { isActive: { $ne: false } },
        { active: { $ne: false } },
        { isActive: { $exists: false } },
        { active: { $exists: false } }
      ],
      department: { $exists: true, $ne: null, $ne: '' }
    }).toArray();
    
    console.log(`[admin-users/departments] Found ${users.length} users with departments`);
    
    // Also try a simpler query if the above returns no results
    if (users.length === 0) {
      console.log(`[admin-users/departments] No users found with first query, trying simpler query...`);
      const allUsers = await usersCol.find({
        company: resolvedCompany,
        department: { $exists: true, $ne: null, $ne: '' }
      }).toArray();
      console.log(`[admin-users/departments] Found ${allUsers.length} total users with departments (without active filter)`);
      
      // Use allUsers if we found any
      if (allUsers.length > 0) {
        const departments = [...new Set(
          allUsers
            .map(user => user.department?.trim())
            .filter(dept => dept && dept.length > 0)
        )].sort();
        
        console.log(`[admin-users/departments] Found ${departments.length} unique departments:`, departments);
        
        return res.json({
          success: true,
          departments: departments,
          count: departments.length,
          company: resolvedCompany,
          collection: 'employee_details',
          message: `Fetched ${departments.length} departments for ${resolvedCompany}`
        });
      }
    }
    
    // Extract unique departments and sort them
    const departments = [...new Set(
      users
        .map(user => user.department?.trim())
        .filter(dept => dept && dept.length > 0)
    )].sort();
    
    console.log(`[admin-users/departments] Found ${departments.length} unique departments:`, departments);
    
    res.json({
      success: true,
      departments: departments,
      count: departments.length,
      company: resolvedCompany,
      collection: 'employee_details',
      message: `Fetched ${departments.length} departments for ${resolvedCompany}`
    });
  } catch (error) {
    console.error('[Admin Users Departments GET Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch departments'
    });
  }
}

// @route   GET /api/admin-users/departments/managers
// @desc    Get department -> manager mapping for a company
// @access  Private/Admin
// @query   company - Required
async function listDepartmentManagers(req, res) {
  try {
    const { company } = req.query;
    if (!company) {
      return res.status(400).json({
        success: false,
        error: 'Company is required.'
      });
    }

    const col = await getDepartmentManagersCollection();
    const docs = await col
      .find({ company: String(company).trim() })
      .project({ _id: 0 })
      .toArray();

    const managersByDepartment = {};
    for (const d of docs) {
      if (!d?.department) continue;
      const normalizedIds = Array.isArray(d.managerUserIds)
        ? d.managerUserIds.filter(Boolean).map((x) => String(x))
        : d.managerUserId
          ? [String(d.managerUserId)]
          : [];

      const normalizedManagers = Array.isArray(d.managers)
        ? d.managers
            .filter((m) => m && (m.userId || m.managerUserId))
            .map((m) => ({
              userId: String(m.userId || m.managerUserId),
              name: m.name || m.managerName || '',
              email: m.email || m.managerEmail || '',
            }))
        : d.managerUserId
          ? [{
              userId: String(d.managerUserId),
              name: d.managerName || '',
              email: d.managerEmail || '',
            }]
          : [];

      managersByDepartment[d.department] = {
        department: d.department,
        managerUserIds: normalizedIds,
        managers: normalizedManagers,
        updatedAt: d.updatedAt || null,
      };
    }

    return res.json({
      success: true,
      company: String(company).trim(),
      managersByDepartment,
      count: Object.keys(managersByDepartment).length,
    });
  } catch (error) {
    console.error('[Admin Dept Managers GET Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch department managers'
    });
  }
}

// @route   PUT /api/admin-users/departments/:department/manager
// @desc    Set or clear manager for a department
// @access  Private/Admin
// @query   company - Required
// @body    managerUserIds - Optional array (empty clears). Back-compat: managerUserId string.
async function setDepartmentManager(req, res) {
  try {
    const { company } = req.query;
    const { department } = req.params;
    const { managerUserIds, managerUserId } = req.body || {};

    const normalizedCompany = String(company || '').trim();
    const normalizedDepartment = String(department || '').trim();

    if (!normalizedCompany) {
      return res.status(400).json({ success: false, error: 'Company is required.' });
    }
    if (!normalizedDepartment) {
      return res.status(400).json({ success: false, error: 'Department is required.' });
    }

    const col = await getDepartmentManagersCollection();

    const ids = Array.isArray(managerUserIds)
      ? managerUserIds.filter(Boolean).map((x) => String(x))
      : managerUserId
        ? [String(managerUserId)]
        : [];

    // Clear mapping
    if (ids.length === 0) {
      await col.deleteOne({ company: normalizedCompany, department: normalizedDepartment });
      return res.json({
        success: true,
        company: normalizedCompany,
        department: normalizedDepartment,
        managers: [],
        message: 'Department managers cleared.'
      });
    }

    const usersCol = await getUsersCollectionForRequest(req);
    const uniqueIds = Array.from(new Set(ids));

    // Validate all ids and fetch users
    for (const id of uniqueIds) {
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: `Invalid manager user ID: ${id}` });
      }
    }

    const users = await usersCol
      .find({ _id: { $in: uniqueIds.map((id) => new ObjectId(id)) } })
      .toArray();

    if (users.length !== uniqueIds.length) {
      return res.status(404).json({
        success: false,
        error: 'One or more manager users were not found.'
      });
    }

    // Enforce: manager must belong to the same department
    const deptKey = normalizeDepartmentName(normalizedDepartment);
    const mismatched = users.filter(
      (u) => normalizeDepartmentName(u?.department) !== deptKey
    );
    if (mismatched.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Managers must belong to department "${normalizedDepartment}".`
      });
    }

    const now = new Date();
    const doc = {
      company: normalizedCompany,
      department: normalizedDepartment,
      managerUserIds: uniqueIds,
      managers: users.map((u) => ({
        userId: u._id.toString(),
        name: u.name || '',
        email: u.email || '',
      })),
      updatedAt: now,
    };

    await col.updateOne(
      { company: normalizedCompany, department: normalizedDepartment },
      { $set: doc, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );

    return res.json({
      success: true,
      company: normalizedCompany,
      department: normalizedDepartment,
      managers: doc.managers,
      managerUserIds: doc.managerUserIds,
      updatedAt: doc.updatedAt,
      message: 'Department managers updated.'
    });
  } catch (error) {
    console.error('[Admin Dept Managers PUT Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to set department manager'
    });
  }
}

// @route   GET /api/admin-users/:id
// @desc    Get single user by ID
// @access  Private/Admin

async function getUserById(req, res) {
  try {
    const { id } = req.params;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const usersCol = await getUsersCollectionForRequest(req);
    const user = await usersCol.findOne({ _id: new ObjectId(id) });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id?.toString(),
        _id: user._id?.toString(),
        name: user.name || '',
        email: user.email || '',
        password: '', // Don't send password
        active: user.isActive !== false,
        portals: user.portals || [],
        role: user.role || 'user',
        employeeId: user.employeeId || '',
        department: user.department || '',
        company: user.company || '',
        hasCredentialAccess: user.hasCredentialAccess !== false,
        hasSubscriptionAccess: user.hasSubscriptionAccess !== false,
        card_no: user.card_no || '',
        emp_code: user.emp_code || '',
        exitDate: user.exitDate || ''
      }
    });
  } catch (error) {
    console.error('[Admin Users GET by ID Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch user'
    });
  }
}

// @route   POST /api/admin-users
// @desc    Create a new user
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')

async function createUser(req, res) {
  try {
    const { 
      name, email, password, active, portals, role, employeeId, department, company: companyField, 
      hasCredentialAccess, hasSubscriptionAccess,
      // Personal details
      phone,
      workPhone,
      homePhone,
      personalEmail,
      fatherName,
      dateOfBirth,
      actualDob,
      age,
      gender,
      maritalStatus,
      bloodGroup,
      address,
      presentAddress,
      permanentAddress,
      city,
      state,
      zipCode,
      emergencyContact,
      emergencyPhone,
      emergencyRelation,
      familyDetails,
      // Work details
      jobTitle, payrollCompany, location, reportingManager, joiningDate, exitDate, card_no, emp_code,
      // Bank & Insurance
      bankAccount, ifsc, bankName, bankBranchName, pan, aadhaar, rationNumber, uan, esiNo, pfNo
    } = req.body;
    const { company } = req.query; // Get company from query parameter (for collection selection)

    // Validation - All fields are now optional
    // Only validate format if values are provided
    
    const isWarehouse = req?.usersCollectionType === 'warehouse';

    // Validate email format (only if email is provided; warehouse staff may omit email)
    if (email && email.trim() !== '' && !isWarehouse) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
    }

    // Validate password length (only if password is provided)
    if (password && password.trim() !== '' && password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollectionForRequest(req);

    // Check if user already exists (only if email is provided)
    if (email && email.trim() !== '') {
      const existingUser = await usersCol.findOne({ email: email.toLowerCase().trim() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'User with this email already exists'
        });
      }
    }

    // Hash password (only if provided)
    let hashedPassword = '';
    if (password && password.trim() !== '') {
      hashedPassword = await bcrypt.hash(password, 10);
    } else {
      // Generate a random password if not provided
      const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
      hashedPassword = await bcrypt.hash(randomPassword, 10);
      console.log('[Admin Users POST] No password provided, generated random password');
    }

    // Create user object with all fields (handle empty values)
    const newUser = {
      name: (name || '').trim() || 'Employee',
      email: email ? email.toLowerCase().trim() : '',
      password: hashedPassword,
      isActive: active !== false, // Default to true
      portals: portals || [], // Array of portal names
      role: role || 'user',
      employeeId: employeeId || '',
      department: department || '',
      company: companyField || company || '',
      hasCredentialAccess: hasCredentialAccess !== false,
      hasSubscriptionAccess: hasSubscriptionAccess !== false,
      
      // Personal details
      phone: phone || '',
      workPhone: workPhone || '',
      homePhone: homePhone || '',
      personalEmail: personalEmail ? String(personalEmail).trim().toLowerCase() : '',
      fatherName: fatherName || '',
      dateOfBirth: dateOfBirth || '',
      actualDob: actualDob || '',
      age: age || '',
      gender: gender || '',
      maritalStatus: maritalStatus || '',
      bloodGroup: bloodGroup || '',
      address: address || '',
      presentAddress: presentAddress || '',
      permanentAddress: permanentAddress || '',
      city: city || '',
      state: state || '',
      zipCode: zipCode || '',
      emergencyContact: emergencyContact || '',
      emergencyPhone: emergencyPhone || '',
      emergencyRelation: emergencyRelation || '',
      familyDetails: familyDetails || '',
      
      // Work details
      jobTitle: jobTitle || '',
      payrollCompany: payrollCompany || '',
      location: location || '',
      reportingManager: reportingManager || '',
      joiningDate: joiningDate || '',
      exitDate: exitDate || '',
      card_no: card_no || '',
      emp_code: emp_code || '',
      
      // Bank & Insurance
      bankAccount: bankAccount || '',
      ifsc: ifsc || '',
      bankName: bankName || '',
      bankBranchName: bankBranchName || '',
      pan: pan || '',
      aadhaar: aadhaar || '',
      rationNumber: rationNumber || '',
      uan: uan || '',
      esiNo: esiNo || '',
      pfNo: pfNo || '',
      
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Log what we're about to insert
    console.log('[Admin Users POST] Creating user with data:', {
      name: newUser.name,
      email: newUser.email,
      employeeId: newUser.employeeId,
      company: newUser.company,
      phone: newUser.phone,
      jobTitle: newUser.jobTitle,
      department: newUser.department,
      location: newUser.location,
      address: newUser.address,
      city: newUser.city,
      state: newUser.state,
      totalFields: Object.keys(newUser).length
    });
    
    // Insert user
    const result = await usersCol.insertOne(newUser);
    
    console.log('[Admin Users POST] User inserted successfully. ID:', result.insertedId.toString());
    console.log('[Admin Users POST] Collection used:', usersCol.collectionName);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: result.insertedId.toString(),
        _id: result.insertedId.toString(),
        name: newUser.name,
        email: newUser.email,
        password: '', // Don't send password
        active: newUser.isActive,
        portals: newUser.portals,
        role: newUser.role,
        employeeId: newUser.employeeId,
        department: newUser.department,
        company: newUser.company,
        hasCredentialAccess: newUser.hasCredentialAccess,
        hasSubscriptionAccess: newUser.hasSubscriptionAccess,
        // Include all other fields in response
        phone: newUser.phone,
        workPhone: newUser.workPhone,
        homePhone: newUser.homePhone,
        personalEmail: newUser.personalEmail,
        fatherName: newUser.fatherName,
        dateOfBirth: newUser.dateOfBirth,
        actualDob: newUser.actualDob,
        age: newUser.age,
        gender: newUser.gender,
        maritalStatus: newUser.maritalStatus,
        bloodGroup: newUser.bloodGroup,
        address: newUser.address,
        presentAddress: newUser.presentAddress,
        permanentAddress: newUser.permanentAddress,
        city: newUser.city,
        state: newUser.state,
        zipCode: newUser.zipCode,
        emergencyContact: newUser.emergencyContact,
        emergencyPhone: newUser.emergencyPhone,
        emergencyRelation: newUser.emergencyRelation,
        familyDetails: newUser.familyDetails,
        jobTitle: newUser.jobTitle,
        location: newUser.location,
        reportingManager: newUser.reportingManager,
        joiningDate: newUser.joiningDate,
        exitDate: newUser.exitDate,
        card_no: newUser.card_no,
        emp_code: newUser.emp_code,
        bankAccount: newUser.bankAccount,
        ifsc: newUser.ifsc,
        bankName: newUser.bankName,
        bankBranchName: newUser.bankBranchName,
        pan: newUser.pan,
        aadhaar: newUser.aadhaar,
        rationNumber: newUser.rationNumber,
        uan: newUser.uan,
        esiNo: newUser.esiNo,
        pfNo: newUser.pfNo,
      }
    });
  } catch (error) {
    console.error('[Admin Users POST Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create user'
    });
  }
}

// @route   PUT /api/admin-users/:id
// @desc    Update a user
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')

async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { 
      name, email, password, active, portals, role, employeeId, department, company: companyField, 
      hasCredentialAccess, hasSubscriptionAccess,
      // Personal details
      phone,
      workPhone,
      homePhone,
      personalEmail,
      fatherName,
      dateOfBirth,
      actualDob,
      age,
      gender,
      maritalStatus,
      bloodGroup,
      address,
      presentAddress,
      permanentAddress,
      city,
      state,
      zipCode,
      emergencyContact,
      emergencyPhone,
      emergencyRelation,
      familyDetails,
      // Work details
      jobTitle, payrollCompany, location, reportingManager, joiningDate, exitDate, card_no, emp_code,
      // Bank & Insurance
      bankAccount, ifsc, bankName, bankBranchName, pan, aadhaar, rationNumber, uan, esiNo, pfNo,
      // Payroll
      annualCtc,
      pfRule,
      pfSlabId,
    } = req.body;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollectionForRequest(req);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Build update object - Only update fields that are provided (partial update)
    const updateData = {
      updatedAt: new Date()
    };

    // Basic fields
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) {
      const normalizedEmail = String(email).toLowerCase().trim();
      const existingEmail = (existingUser.email || '').toLowerCase().trim();
      const isWarehouse = req?.usersCollectionType === 'warehouse';

      // Empty email is allowed (common for warehouse staff without portal login).
      if (normalizedEmail !== '') {
        // Regular employees: validate format when email is provided.
        if (!isWarehouse) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({
              success: false,
              error: 'Invalid email format'
            });
          }
        }

        // Only run duplicate check if email is actually changed.
        if (normalizedEmail !== existingEmail) {
          const emailUser = await usersCol.findOne({
            email: normalizedEmail,
            _id: { $ne: new ObjectId(id) }
          });
          if (emailUser) {
            return res.status(400).json({
              success: false,
              error: 'Email already taken by another user'
            });
          }
        }
      }

      updateData.email = normalizedEmail;
    }
    if (password !== undefined && password !== '') {
      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long'
        });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }
    if (active !== undefined) {
      updateData.isActive = active;
      if (active === false) {
        const exit = exitDate !== undefined ? String(exitDate).trim() : '';
        const isWarehouse = req?.usersCollectionType === 'warehouse';
        if (!exit && !isWarehouse) {
          return res.status(400).json({
            success: false,
            error: 'Exit date is required when marking an employee as inactive.'
          });
        }
        updateData.exitDate = exit || null;
      } else {
        updateData.exitDate = null;
      }
    } else if (exitDate !== undefined) {
      updateData.exitDate = exitDate === null || exitDate === '' ? null : String(exitDate).trim();
    }
    if (portals !== undefined) updateData.portals = portals; // Array of portal names
    if (role !== undefined) updateData.role = role;
    if (employeeId !== undefined) updateData.employeeId = employeeId;
    if (department !== undefined) updateData.department = department;
    if (companyField !== undefined) updateData.company = companyField;
    if (hasCredentialAccess !== undefined) updateData.hasCredentialAccess = hasCredentialAccess;
    if (hasSubscriptionAccess !== undefined) updateData.hasSubscriptionAccess = hasSubscriptionAccess;
    
    // Personal details - Only update if provided
    if (phone !== undefined) updateData.phone = phone;
    if (workPhone !== undefined) updateData.workPhone = workPhone;
    if (homePhone !== undefined) updateData.homePhone = homePhone;
    if (personalEmail !== undefined) updateData.personalEmail = personalEmail ? String(personalEmail).trim().toLowerCase() : '';
    if (fatherName !== undefined) updateData.fatherName = fatherName;
    if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
    if (actualDob !== undefined) updateData.actualDob = actualDob;
    if (age !== undefined) updateData.age = age;
    if (gender !== undefined) updateData.gender = gender;
    if (maritalStatus !== undefined) updateData.maritalStatus = maritalStatus;
    if (bloodGroup !== undefined) updateData.bloodGroup = bloodGroup;
    if (address !== undefined) updateData.address = address;
    if (presentAddress !== undefined) updateData.presentAddress = presentAddress;
    if (permanentAddress !== undefined) updateData.permanentAddress = permanentAddress;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zipCode !== undefined) updateData.zipCode = zipCode;
    if (emergencyContact !== undefined) updateData.emergencyContact = emergencyContact;
    if (emergencyPhone !== undefined) updateData.emergencyPhone = emergencyPhone;
    if (emergencyRelation !== undefined) updateData.emergencyRelation = emergencyRelation;
    if (familyDetails !== undefined) updateData.familyDetails = familyDetails;
    
    // Work details - Only update if provided
    if (jobTitle !== undefined) updateData.jobTitle = jobTitle;
    if (payrollCompany !== undefined) updateData.payrollCompany = payrollCompany;
    if (location !== undefined) updateData.location = location;
    if (reportingManager !== undefined) updateData.reportingManager = reportingManager;
    if (joiningDate !== undefined) updateData.joiningDate = joiningDate;
    if (card_no !== undefined) updateData.card_no = card_no;
    if (emp_code !== undefined) updateData.emp_code = emp_code;
    
    // Bank & Insurance - Only update if provided
    if (bankAccount !== undefined) updateData.bankAccount = bankAccount;
    if (ifsc !== undefined) updateData.ifsc = ifsc;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankBranchName !== undefined) updateData.bankBranchName = bankBranchName;
    if (pan !== undefined) updateData.pan = pan;
    if (aadhaar !== undefined) updateData.aadhaar = aadhaar;
    if (rationNumber !== undefined) updateData.rationNumber = rationNumber;
    if (uan !== undefined) updateData.uan = uan;
    if (esiNo !== undefined) updateData.esiNo = esiNo;
    if (pfNo !== undefined) updateData.pfNo = pfNo;

    if (annualCtc !== undefined) {
      if (annualCtc === null || annualCtc === '') {
        updateData.annualCtc = null;
      } else {
        const n = Number(annualCtc);
        updateData.annualCtc =
          Number.isFinite(n) && n >= 0 ? encryptAnnualCtcForStorage(n) : null;
      }
    }
    if (pfRule !== undefined) {
      const r = String(pfRule || '').toUpperCase();
      updateData.pfRule = r === 'OLD' ? 'OLD' : 'NEW';
    }
    if (pfSlabId !== undefined) updateData.pfSlabId = pfSlabId === '' || pfSlabId == null ? null : String(pfSlabId);

    // Update user
    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    // Fetch updated user
    const updatedUser = await usersCol.findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: updatedUser._id?.toString(),
        _id: updatedUser._id?.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        password: '', // Don't send password
        active: updatedUser.isActive !== false,
        portals: updatedUser.portals || [],
        role: updatedUser.role || 'user',
        employeeId: updatedUser.employeeId || '',
        department: updatedUser.department || '',
        company: updatedUser.company || '',
        hasCredentialAccess: updatedUser.hasCredentialAccess !== false,
        hasSubscriptionAccess: updatedUser.hasSubscriptionAccess !== false,
        card_no: updatedUser.card_no || '',
        emp_code: updatedUser.emp_code || '',
        exitDate: updatedUser.exitDate || ''
      }
    });
  } catch (error) {
    console.error('[Admin Users PUT Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user'
    });
  }
}

// @route   DELETE /api/admin-users/:id
// @desc    Delete a user (hard delete - remove from database)
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')

async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollectionForRequest(req);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Hard delete - remove from database
    await usersCol.deleteOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('[Admin Users DELETE Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete user'
    });
  }
}

// @route   PATCH /api/admin-users/:id/toggle-active
// @desc    Toggle user active status
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')

async function toggleActive(req, res) {
  try {
    const { id } = req.params;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollectionForRequest(req);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Toggle isActive; record exit date when becoming inactive
    const newActiveStatus = !existingUser.isActive;
    const setFields = {
      isActive: newActiveStatus,
      updatedAt: new Date()
    };
    if (newActiveStatus === false) {
      setFields.exitDate = new Date().toISOString().slice(0, 10);
    } else {
      setFields.exitDate = null;
    }

    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: setFields }
    );

    res.json({
      success: true,
      message: 'User status updated successfully',
      active: newActiveStatus
    });
  } catch (error) {
    console.error('[Admin Users Toggle Active Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to toggle user status'
    });
  }
}

// @route   GET /api/admin-users/debug/info
// @desc    Get debug information about users database
// @access  Private/Admin

async function debugInfo(req, res) {
  try {
    const usersCol = await getUsersCollectionForRequest(req);
    
    // Get total count
    const totalCount = await usersCol.countDocuments({});
    
    // Get sample users (first 5)
    const sampleUsers = await usersCol.find({}).limit(5).toArray();
    
    // Get users with employeeId
    const usersWithEmployeeId = await usersCol.countDocuments({ employeeId: { $exists: true, $ne: null } });
    
    // Get active users
    const activeUsers = await usersCol.countDocuments({ isActive: { $ne: false } });
    
    res.json({
      success: true,
      database: LOGIN_DB_NAME,
      collection: 'users',
      stats: {
        totalUsers: totalCount,
        usersWithEmployeeId: usersWithEmployeeId,
        activeUsers: activeUsers,
        inactiveUsers: totalCount - activeUsers
      },
      sampleUsers: sampleUsers.map(user => ({
        _id: user._id?.toString(),
        name: user.name,
        email: user.email,
        employeeId: user.employeeId,
        isActive: user.isActive,
        role: user.role
      }))
    });
  } catch (error) {
    console.error('[Admin Users Debug Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get debug info'
    });
  }
}

// @route   PATCH /api/admin-users/:id/portals
// @desc    Update user portals
// @access  Private/Admin
// @query   company - Optional: company name to determine collection (e.g., 'Ecosoul Home', 'Thrive')

async function updatePortals(req, res) {
  try {
    const { id } = req.params;
    const { portals } = req.body;
    const { company } = req.query; // Get company from query parameter

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    if (!Array.isArray(portals)) {
      return res.status(400).json({
        success: false,
        error: 'Portals must be an array'
      });
    }

    // Get the appropriate collection based on company
    const usersCol = await getUsersCollectionForRequest(req);

    // Check if user exists
    const existingUser = await usersCol.findOne({ _id: new ObjectId(id) });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update portals
    await usersCol.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          portals: portals,
          updatedAt: new Date()
        } 
      }
    );

    // Fetch updated user
    const updatedUser = await usersCol.findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: 'User portals updated successfully',
      user: {
        id: updatedUser._id?.toString(),
        _id: updatedUser._id?.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        active: updatedUser.isActive !== false,
        portals: updatedUser.portals || [],
        role: updatedUser.role || 'user'
      }
    });
  } catch (error) {
    console.error('[Admin Users Update Portals Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update user portals'
    });
  }
}

// @route   GET /api/admin-users/ui/employees-columns
// @desc    Get global Employees table columns config for a company
// @access  Public (read-only)
// @query   company - Required
// @query   rosterTab - Optional: current|ex (default current)
async function getEmployeesColumnsConfig(req, res) {
  try {
    const { company, rosterTab } = req.query;
    const normalizedCompany = String(company || '').trim();
    if (!normalizedCompany) {
      return res.status(400).json({ success: false, error: 'Company is required.' });
    }
    const tab = String(rosterTab || 'current').trim();
    const col = await getUiSettingsCollection();
    const doc = await col.findOne({
      company: normalizedCompany,
      key: 'employees_columns',
      rosterTab: tab,
    });
    return res.json({
      success: true,
      company: normalizedCompany,
      rosterTab: tab,
      columns: doc?.columns || null,
      updatedAt: doc?.updatedAt || null,
    });
  } catch (error) {
    console.error('[Employees Columns GET Error]', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch config' });
  }
}

// @route   PUT /api/admin-users/ui/employees-columns
// @desc    Set global Employees table columns config for a company
// @access  Superadmin only (JWT required)
// @query   company - Required
// @body    { columns: Array<{id,label,visible,required,lockPosition}> , rosterTab?: 'current'|'ex' }
async function setEmployeesColumnsConfig(req, res) {
  try {
    const { company } = req.query;
    const { columns, rosterTab } = req.body || {};
    const normalizedCompany = String(company || '').trim();
    if (!normalizedCompany) {
      return res.status(400).json({ success: false, error: 'Company is required.' });
    }
    const tab = String(rosterTab || 'current').trim();
    if (!Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ success: false, error: 'columns must be a non-empty array.' });
    }

    // Basic validation: ids must exist
    for (const c of columns) {
      if (!c || !c.id) {
        return res.status(400).json({ success: false, error: 'Each column must have an id.' });
      }
    }

    const now = new Date();
    const updatedBy = req.auth?.email || req.auth?.userId || null;
    const col = await getUiSettingsCollection();
    await col.updateOne(
      { company: normalizedCompany, key: 'employees_columns', rosterTab: tab },
      {
        $set: {
          company: normalizedCompany,
          key: 'employees_columns',
          rosterTab: tab,
          columns,
          updatedAt: now,
          updatedBy,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    return res.json({
      success: true,
      company: normalizedCompany,
      rosterTab: tab,
      updatedAt: now,
    });
  } catch (error) {
    console.error('[Employees Columns PUT Error]', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to save config' });
  }
}

module.exports = {
  listUsers,
  listDepartments,
  listDepartmentManagers,
  setDepartmentManager,
  getEmployeesColumnsConfig,
  setEmployeesColumnsConfig,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  toggleActive,
  debugInfo,
  updatePortals,
};
