const { connectMongo, initializeCompanyPortals } = require('../../../config/mongo');
const {
  getCompanyFromRequest,
  normalizeCompany,
  requireCompany,
  getHrmsDb,
  getAllHrmsDbs,
  getEmployeeDbForHrms,
} = require('../utils/hrmsContext');

/** Avoid RangeError from Invalid Date when calling toISOString() */
function toYmdUTC(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function recruitmentAnalytics(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { month, hr, department } = req.query;
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    // Build query filters
    const query = {};
    if (hr && hr !== 'All HRs') {
      query.assignedTo = hr;
    }
    if (department && department !== 'All Departments') {
      query.department = department;
    }
    
    // Get all recruitment records
    const allRecords = await recruitmentCol.find(query).toArray();
    
    // Calculate date range based on month filter
    const now = new Date();
    let startDate, endDate;
    
    switch (month) {
      case 'Last Month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'Last 3 Months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'Last 6 Months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'This Year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      default: // This Month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    // Filter records by date if assignDate exists
    const filteredRecords = allRecords.filter(record => {
      if (!record.assignDate) return true;
      const recordDate = new Date(record.assignDate);
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    // Calculate KPIs
    const totalActiveJobs = new Set(filteredRecords.map(r => r.position || r.jobTitle).filter(Boolean)).size;
    const totalApplications = filteredRecords.length;
    const shortlisted = filteredRecords.filter(r => r.status === 'Shortlisted' || r.status === 'shortlisted').length;
    const interviewsScheduled = filteredRecords.filter(r => r.status === 'Interview Scheduled' || r.status === 'Interview Aligned' || r.status === 'interview_scheduled').length;
    const offersSent = filteredRecords.filter(r => r.status === 'Offer Sent' || r.status === 'Finalized' || r.status === 'offer_sent').length;
    const hired = filteredRecords.filter(r => r.status === 'Hired' || r.hiringStatus === 'Hired' || r.status === 'hired').length;
    
    // Calculate averages (simplified - would need more data for accurate calculations)
    const avgTimeToHire = hired > 0 ? (totalApplications / hired).toFixed(1) + '%' : '0%';
    const avgInterviewTime = interviewsScheduled > 0 ? Math.round(totalApplications / interviewsScheduled) + ' Days' : '0 Days';
    const avgOfferAcceptanceRate = offersSent > 0 ? Math.round((hired / offersSent) * 100) + '%' : '0%';
    const offerRejectionRate = offersSent > 0 ? ((offersSent - hired) / offersSent * 100).toFixed(1) + '%' : '0%';
    
    // Get HR list for filters
    const { getUsersCollection } = require('../../../config/mongo');
    let companyName = company;
    if (!companyName || companyName === '1' || companyName === 'undefined') {
      companyName = 'Ecosoul Home';
    }
    
    let hrList = [];
    try {
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      hrList = employees.map(emp => emp.name || emp.firstName || 'Unknown').filter(Boolean);
    } catch (err) {
      console.error('Error fetching HR list:', err);
    }
    
    // Candidate for Interview in Pipeline by HR
    const pipelineByHR = {};
    filteredRecords.forEach(record => {
      if (record.status === 'Interview Scheduled' || record.status === 'Interview Aligned' || record.status === 'interview_scheduled') {
        const hrName = record.assignedTo || 'Unknown';
        if (!pipelineByHR[hrName]) {
          pipelineByHR[hrName] = 0;
        }
        pipelineByHR[hrName]++;
      }
    });
    
    const pipelineByHRArray = Object.entries(pipelineByHR).map(([name, candidates]) => ({
      name,
      candidates,
      percentage: totalApplications > 0 ? ((candidates / totalApplications) * 100).toFixed(1) : 0
    }));
    
    // Recruitment Funnel (status distribution)
    const statusCounts = {};
    filteredRecords.forEach(record => {
      const status = record.status || 'New';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    const recruitmentFunnel = [
      { stage: 'New', candidates: statusCounts['New'] || 0, percentage: totalApplications > 0 ? (((statusCounts['New'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Shortlisted', candidates: statusCounts['Shortlisted'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Shortlisted'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Screening', candidates: statusCounts['Screening'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Screening'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Interview Aligned', candidates: statusCounts['Interview Aligned'] || statusCounts['Interview Scheduled'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Interview Aligned'] || statusCounts['Interview Scheduled'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Feedback Call', candidates: statusCounts['Feedback Call'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Feedback Call'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Finalized', candidates: statusCounts['Finalized'] || statusCounts['Offer Sent'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Finalized'] || statusCounts['Offer Sent'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'Hired', candidates: statusCounts['Hired'] || 0, percentage: totalApplications > 0 ? (((statusCounts['Hired'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
      { stage: 'On Hold', candidates: statusCounts['On Hold'] || 0, percentage: totalApplications > 0 ? (((statusCounts['On Hold'] || 0) / totalApplications) * 100).toFixed(1) : 0 },
    ];
    
    // Today's Calls by HR (using callingDate or assignDate)
    const today = new Date().toISOString().split('T')[0];
    const todayCalls = {};
    filteredRecords.forEach(record => {
      const callDate = toYmdUTC(record.callingDate) || toYmdUTC(record.assignDate);
      if (callDate === today) {
        const hrName = record.assignedTo || 'Unknown';
        todayCalls[hrName] = (todayCalls[hrName] || 0) + 1;
      }
    });
    
    const todaysCallsData = Object.entries(todayCalls).map(([name, calls]) => ({ name, calls }));
    
    // HR Performance Comparison
    const hrPerformance = {};
    filteredRecords.forEach(record => {
      const hrName = record.assignedTo || 'Unknown';
      if (!hrPerformance[hrName]) {
        hrPerformance[hrName] = { shortlisted: 0, positioned: 0 };
      }
      if (record.status === 'Shortlisted' || record.status === 'shortlisted') {
        hrPerformance[hrName].shortlisted++;
      }
      if (record.status === 'Finalized' || record.status === 'Offer Sent' || record.status === 'Hired') {
        hrPerformance[hrName].positioned++;
      }
    });
    
    const hrPerformanceData = Object.entries(hrPerformance).map(([name, data]) => ({
      name,
      shortlisted: data.shortlisted,
      positioned: data.positioned
    }));
    
    // Location Based Hiring Distribution
    const locationCounts = {};
    filteredRecords.forEach(record => {
      if (record.status === 'Hired' || record.hiringStatus === 'Hired') {
        const location = record.currentLocation || record.location || 'Unknown';
        locationCounts[location] = (locationCounts[location] || 0) + 1;
      }
    });
    
    const locationData = Object.entries(locationCounts).map(([name, value]) => ({ name, value }));
    
    // HR Activity Table
    const hrActivity = {};
    filteredRecords.forEach(record => {
      const hrName = record.assignedTo || 'Unknown';
      if (!hrActivity[hrName]) {
        hrActivity[hrName] = {
          totalCalls: 0,
          shortlisted: 0,
          interviewsScheduled: 0,
          offersSent: 0,
          hiresClosed: 0
        };
      }
      
      // Count calls (records with callingDate or assignDate)
      if (record.callingDate || record.assignDate) {
        hrActivity[hrName].totalCalls++;
      }
      
      if (record.status === 'Shortlisted' || record.status === 'shortlisted') {
        hrActivity[hrName].shortlisted++;
      }
      if (record.status === 'Interview Scheduled' || record.status === 'Interview Aligned') {
        hrActivity[hrName].interviewsScheduled++;
      }
      if (record.status === 'Offer Sent' || record.status === 'Finalized') {
        hrActivity[hrName].offersSent++;
      }
      if (record.status === 'Hired' || record.hiringStatus === 'Hired') {
        hrActivity[hrName].hiresClosed++;
      }
    });
    
    const hrActivityData = Object.entries(hrActivity).map(([hrName, data]) => {
      const conversion = data.totalCalls > 0 ? ((data.hiresClosed / data.totalCalls) * 100).toFixed(1) : 0;
      return {
        hrName,
        totalCalls: data.totalCalls,
        shortlisted: data.shortlisted,
        interviewsScheduled: data.interviewsScheduled,
        offersSent: data.offersSent,
        hiresClosed: data.hiresClosed,
        conversion: parseFloat(conversion),
        avgResponseTime: '2.5 hrs' // Would need additional data to calculate
      };
    });
    
    // Recent Activity Log (last 10 activities)
    const recentActivities = filteredRecords
      .sort((a, b) => {
        const dateA = new Date(a.assignDate || a.callingDate || a.createdAt || 0);
        const dateB = new Date(b.assignDate || b.callingDate || b.createdAt || 0);
        return dateB - dateA;
      })
      .slice(0, 10)
      .map(record => {
        let status = 'Pending';
        let statusColor = 'bg-yellow-500';
        
        if (record.status === 'Hired' || record.hiringStatus === 'Hired') {
          status = 'Approved';
          statusColor = 'bg-green-500';
        } else if (record.status === 'Rejected' || record.hiringStatus === 'Rejected') {
          status = 'Failed';
          statusColor = 'bg-red-500';
        } else if (record.status === 'Shortlisted' || record.status === 'Interview Scheduled') {
          status = 'Approved';
          statusColor = 'bg-green-500';
        }
        
        return {
          hr: record.assignedTo || 'Unknown',
          activity: record.status || 'Activity',
          status,
          statusColor
        };
      });
    
    res.json({
      success: true,
      data: {
        kpiCards: {
          totalActiveJobs,
          totalApplications,
          shortlisted,
          interviewsScheduled,
          offersSent,
          hired,
          avgTimeToHire,
          avgInterviewTime,
          avgOfferAcceptanceRate,
          offerRejectionRate
        },
        pipelineByHR: pipelineByHRArray,
        recruitmentFunnel,
        todaysCallsData,
        hrPerformanceData,
        locationData,
        hrActivityData,
        recentActivities,
        hrList,
        departments: ['Engineering', 'Sales', 'Marketing', 'HR', 'Operations'] // Would come from departments collection
      }
    });
  } catch (error) {
    console.error('HRMS recruitment analytics error:', error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function listCandidates(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { status, recruiter, experience, search, year } = req.query;
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    // Base query for status / recruiter / search (used for both year list and filtered results)
    const baseQuery = {};
    if (status && status !== 'All Status') {
      baseQuery.status = status;
    }
    if (recruiter && recruiter !== 'All Recruiters') {
      baseQuery.assignedTo = new RegExp(`^${escapeRegExp(recruiter)}$`, 'i');
    }
    if (search) {
      const safe = escapeRegExp(search);
      baseQuery.$or = [
        { candidateName: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
        { contactNumber: { $regex: safe, $options: 'i' } },
        { currentOrganisation: { $regex: safe, $options: 'i' } },
        { folderName: { $regex: safe, $options: 'i' } },
        { assignedTo: { $regex: safe, $options: 'i' } },
        { status: { $regex: safe, $options: 'i' } }
      ];
    }

    // First, fetch all matching candidates (without year constraint) to derive available years
    const allCandidates = await recruitmentCol.find(baseQuery).toArray();

    // Derive available years strictly from callingDate (HR wants year of callingDate column)
    const getCandidateYear = (candidate) => {
      const value = candidate.callingDate;
      if (!value) return null;
      const dateObj = value instanceof Date ? value : new Date(value);
      if (isNaN(dateObj)) return null;
      return dateObj.getFullYear();
    };

    const yearSet = new Set();
    allCandidates.forEach(candidate => {
      const candidateYear = getCandidateYear(candidate);
      if (candidateYear) {
        yearSet.add(candidateYear);
      }
    });
    const years = Array.from(yearSet).sort((a, b) => b - a).map(String);

    // Build final query including optional year range on callingDate
    const query = { ...baseQuery };
    if (year && year !== 'All Years') {
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum)) {
        const start = new Date(`${yearNum}-01-01T00:00:00.000Z`);
        const end = new Date(`${yearNum + 1}-01-01T00:00:00.000Z`);
        query.callingDate = { $gte: start, $lt: end };
      }
    }

    const candidates = await recruitmentCol.find(query).toArray();
    
    // Filter by experience if provided (applied on the year-filtered result set)
    let filteredCandidates = candidates;
    if (experience && experience !== 'All Experience') {
      filteredCandidates = filteredCandidates.filter(candidate => {
        const exp = candidate.totalExperience || '';
        const expYears = parseFloat(exp) || 0;
        
        if (experience === '0-2 Years') return expYears >= 0 && expYears < 2;
        if (experience === '2-5 Years') return expYears >= 2 && expYears < 5;
        if (experience === '5-10 Years') return expYears >= 5 && expYears < 10;
        if (experience === '10+ Years') return expYears >= 10;
        return true;
      });
    }
    
    // Transform candidates to match frontend format
    // Filter out candidates without valid _id (they're not properly saved)
    const transformedCandidates = filteredCandidates
      .filter(candidate => candidate._id) // Only include candidates with valid _id
      .map((candidate) => {
        const statusColors = {
          'New': 'bg-blue-100 text-blue-700',
          'Shortlisted': 'bg-purple-100 text-purple-700',
          'In Interview': 'bg-yellow-100 text-yellow-700',
          'Interview Scheduled': 'bg-yellow-100 text-yellow-700',
          'Interview Aligned': 'bg-yellow-100 text-yellow-700',
          'Feedback Call': 'bg-orange-100 text-orange-700',
          'Finalized': 'bg-indigo-100 text-indigo-700',
          'Hired': 'bg-green-100 text-green-700',
          'On Hold': 'bg-slate-100 text-slate-700',
        };
        
        const status = candidate.status || 'New';
        const assignDate =
          toYmdUTC(candidate.assignDate)
            ? new Date(candidate.assignDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'N/A';
        
        return {
          id: candidate._id.toString(), // Always use _id.toString() - no fallback
          name: candidate.candidateName || 'Unknown',
          contact: candidate.contactNumber || 'N/A',
          email: candidate.email || 'N/A',
          organisation: candidate.currentOrganisation || 'N/A',
          education: candidate.education || 'N/A',
          experience: candidate.totalExperience || 'N/A',
          assignedTo: candidate.assignedTo || 'Unassigned',
          assignDate: assignDate,
          status: status,
          statusColor: statusColors[status] || 'bg-slate-100 text-slate-700',
          folderName: candidate.folderName || 'N/A'
        };
      });
    
    // Calculate KPIs
    const totalCandidates = transformedCandidates.length;
    const shortlisted = transformedCandidates.filter(c => c.status === 'Shortlisted').length;
    const inInterview = transformedCandidates.filter(c => c.status === 'In Interview' || c.status === 'Interview Scheduled' || c.status === 'Interview Aligned').length;
    const hired = transformedCandidates.filter(c => c.status === 'Hired').length;
    const onHold = transformedCandidates.filter(c => c.status === 'On Hold').length;

    // Recruiter dropdown: dynamic list from HR/recruiter users
    let hrList = ['All Recruiters'];
    try {
      const { getUsersCollection } = require('../../../config/mongo');
      let companyName = company;
      if (!companyName || companyName === '1' || companyName === 'undefined') {
        companyName = 'Ecosoul Home';
      }
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      const names = employees
        .map(emp => emp.name || emp.firstName || 'Unknown')
        .filter(name => name && name !== 'Unknown');
      hrList = ['All Recruiters', ...Array.from(new Set(names))];
    } catch (err) {
      console.error('Error fetching HR list for recruitment candidates:', err);
    }
    
    res.json({
      success: true,
      data: {
        candidates: transformedCandidates,
        kpis: {
          totalCandidates,
          shortlisted,
          inInterview,
          hired,
          onHold
        },
        hrList,
        years
      }
    });
  } catch (error) {
    console.error('HRMS recruitment candidates error:', error);
    res.status(500).json({
      success: false,
      error:
        process.env.NODE_ENV === 'development' ? error.message || 'Internal server error' : 'Internal server error',
    });
  }
}

async function listHiring(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { status, recruiter, search } = req.query;
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    const query = {
      $or: [
        { status: 'Finalized' },
        { interviewStatus: 'Finalized' },
        { status: 'Offer Sent' },
        { hiringStatus: { $exists: true, $ne: null } },
        { status: 'Rejected' },
        { status: 'Hired' }
      ]
    };
    if (status && status !== 'All Status') {
      if (status === 'Finalized') {
        query.$or = [{ status: 'Finalized' }, { interviewStatus: 'Finalized' }];
      } else {
        query.status = status;
      }
    }
    if (recruiter && recruiter !== 'All Recruiters') {
      query.assignedTo = new RegExp(`^${escapeRegExp(recruiter)}$`, 'i');
    }
    if (search) {
      const safe = escapeRegExp(search);
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { candidateName: { $regex: safe, $options: 'i' } },
          { email: { $regex: safe, $options: 'i' } },
          { contactNumber: { $regex: safe, $options: 'i' } },
          { currentOrganisation: { $regex: safe, $options: 'i' } }
        ]
      });
    }
    
    const candidates = await recruitmentCol.find(query).toArray();
    
    // Transform candidates - filter out candidates without valid _id
    const transformedCandidates = candidates
      .filter(candidate => candidate._id) // Only include candidates with valid _id
      .map((candidate) => {
        const hiringStatus = candidate.hiringStatus || 'Awaiting';
        const hiringStatusColors = {
          'Hired': 'bg-green-100 text-green-700',
          'Rejected': 'bg-red-100 text-red-700',
          'Awaiting': 'bg-orange-100 text-orange-700'
        };
        
        return {
          id: candidate._id.toString(), // Always use _id.toString() - no fallback
          name: candidate.candidateName || 'Unknown',
          email: candidate.email || 'N/A',
          contact: candidate.contactNumber || 'N/A',
          organisation: candidate.currentOrganisation || 'N/A',
          assignedTo: candidate.assignedTo || 'Unassigned',
          interviewStatus: 'Finalized',
          interviewStatusColor: 'bg-green-100 text-green-700',
          hiringStatus: hiringStatus,
          hiringStatusColor: hiringStatusColors[hiringStatus] || 'bg-orange-100 text-orange-700',
          activeAction: hiringStatus.toLowerCase()
        };
      });
    
    // Calculate KPIs
    const totalCandidates = transformedCandidates.length;
    const hired = transformedCandidates.filter(c => c.hiringStatus === 'Hired').length;
    const rejected = transformedCandidates.filter(c => c.hiringStatus === 'Rejected').length;
    const awaiting = transformedCandidates.filter(c => c.hiringStatus === 'Awaiting').length;

    // Recruiter dropdown: dynamic list from HR/recruiter users
    let hrList = ['All Recruiters'];
    try {
      const { getUsersCollection } = require('../../../config/mongo');
      let companyName = company;
      if (!companyName || companyName === '1' || companyName === 'undefined') {
        companyName = 'Ecosoul Home';
      }
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      const names = employees
        .map(emp => emp.name || emp.firstName || 'Unknown')
        .filter(name => name && name !== 'Unknown');
      hrList = ['All Recruiters', ...Array.from(new Set(names))];
    } catch (err) {
      console.error('Error fetching HR list for recruitment hiring:', err);
    }
    
    res.json({
      success: true,
      data: {
        candidates: transformedCandidates,
        kpis: {
          totalCandidates,
          hired,
          rejected,
          awaiting
        },
        hrList
      }
    });
  } catch (error) {
    console.error('HRMS recruitment hiring error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function listOnboarding(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const { status, stage, recruiter, search } = req.query;
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    const query = {
      $or: [
        { hiringStatus: 'Hired' },
        { offerStatus: 'Accepted' },
        { status: 'Hired' }
      ]
    };
    if (status && status !== 'All Status') {
      if (status === 'Accepted') {
        query.$or = [{ offerStatus: 'Accepted' }, { hiringStatus: 'Hired' }];
      } else {
        query.offerStatus = status;
      }
    }
    if (stage && stage !== 'All Stages') {
      query.onboardingStage = stage;
    }
    if (recruiter && recruiter !== 'All Recruiters') {
      query.assignedTo = new RegExp(`^${escapeRegExp(recruiter)}$`, 'i');
    }
    if (search) {
      const safe = escapeRegExp(search);
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { candidateName: { $regex: safe, $options: 'i' } },
          { email: { $regex: safe, $options: 'i' } },
          { contactNumber: { $regex: safe, $options: 'i' } },
          { position: { $regex: safe, $options: 'i' } }
        ]
      });
    }
    
    const candidates = await recruitmentCol.find(query).toArray();
    
    // Transform candidates - filter out candidates without valid _id
    const transformedCandidates = candidates
      .filter(candidate => candidate._id) // Only include candidates with valid _id
      .map((candidate) => {
        const offerStatus = candidate.offerStatus || (candidate.hiringStatus === 'Hired' ? 'Accepted' : 'Sent');
        const offerStatusColors = {
          'Accepted': 'bg-green-100 text-green-700',
          'Sent': 'bg-blue-100 text-blue-700',
          'Pending': 'bg-yellow-100 text-yellow-700',
          'Declined': 'bg-red-100 text-red-700'
        };
        
        const onboardingStage = candidate.onboardingStage || 'Offer';
        const onboardingStageColors = {
          'Offer': 'bg-blue-100 text-blue-700',
          'Form': 'bg-yellow-100 text-yellow-700',
          'Verification': 'bg-orange-100 text-orange-700',
          'Policy': 'bg-purple-100 text-purple-700',
          'Asset': 'bg-green-100 text-green-700'
        };
        
        const joiningDate = candidate.joiningDate ? new Date(candidate.joiningDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
        
        // Calculate progress based on stage
        const progressMap = {
          'Offer': 0,
          'Form': 15,
          'Verification': 65,
          'Policy': 15,
          'Asset': 100
        };
        const progress = candidate.progress || progressMap[onboardingStage] || 0;
        
        return {
          id: candidate._id.toString(), // Always use _id.toString() - no fallback
          name: candidate.candidateName || 'Unknown',
          email: candidate.email || 'N/A',
          contact: candidate.contactNumber || 'N/A',
          position: candidate.position || candidate.jobTitle || 'N/A',
          recruiter: candidate.assignedTo || 'Unassigned',
          offerStatus: offerStatus,
          offerStatusColor: offerStatusColors[offerStatus] || 'bg-slate-100 text-slate-700',
          joiningDate: joiningDate,
          onboardingStage: onboardingStage,
          onboardingStageColor: onboardingStageColors[onboardingStage] || 'bg-slate-100 text-slate-700',
          progress: progress
        };
      });
    
    // Calculate KPIs
    const totalOnboardings = transformedCandidates.length;
    const pendingOffers = transformedCandidates.filter(c => c.offerStatus === 'Sent' || c.offerStatus === 'Pending').length;
    const offersAccepted = transformedCandidates.filter(c => c.offerStatus === 'Accepted').length;
    const offersDeclined = transformedCandidates.filter(c => c.offerStatus === 'Declined').length;
    const completedOnboardings = transformedCandidates.filter(c => c.onboardingStage === 'Asset' && c.progress === 100).length;

    // Recruiter dropdown: dynamic list from HR/recruiter users
    let hrList = ['All Recruiters'];
    try {
      const { getUsersCollection } = require('../../../config/mongo');
      let companyName = company;
      if (!companyName || companyName === '1' || companyName === 'undefined') {
        companyName = 'Ecosoul Home';
      }
      const usersCol = await getUsersCollection(null, companyName);
      const employees = await usersCol.find({ role: { $in: ['hr', 'HR', 'recruiter', 'Recruiter'] } }).toArray();
      const names = employees
        .map(emp => emp.name || emp.firstName || 'Unknown')
        .filter(name => name && name !== 'Unknown');
      hrList = ['All Recruiters', ...Array.from(new Set(names))];
    } catch (err) {
      console.error('Error fetching HR list for onboarding:', err);
    }
    
    res.json({
      success: true,
      data: {
        candidates: transformedCandidates,
        kpis: {
          totalOnboardings,
          pendingOffers,
          offersAccepted,
          offersDeclined,
          completedOnboardings
        },
        hrList
      }
    });
  } catch (error) {
    console.error('HRMS recruitment onboarding error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function getCandidateById(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const candidateId = req.params.id;
    
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID is required'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    if (!ObjectId.isValid(candidateId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate ID format'
      });
    }
    
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    const candidate = await recruitmentCol.findOne({ _id: new ObjectId(candidateId) });
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    // Format dates for frontend
    const formatDate = (date) => toYmdUTC(date);

    // Return all candidate fields
    res.json({
      success: true,
      data: {
        id: candidate._id?.toString(),
        candidateName: candidate.candidateName || '',
        contactNumber: candidate.contactNumber || '',
        email: candidate.email || '',
        currentLocation: candidate.currentLocation || '',
        callingDate: formatDate(candidate.callingDate),
        assignDate: formatDate(candidate.assignDate),
        currentOrganisation: candidate.currentOrganisation || '',
        education: candidate.education || '',
        totalExperience: candidate.totalExperience || '',
        assignedTo: candidate.assignedTo || '',
        status: candidate.status || 'New',
        currentCTCFixed: candidate.currentCTCFixed || 0,
        currentCTCInHand: candidate.currentCTCInHand || 0,
        expectedCTC: candidate.expectedCTC || 0,
        noticePeriod: candidate.noticePeriod || '',
        willingToWorkInStartup: candidate.willingToWorkInStartup || 'Yes',
        communicationSkills: candidate.communicationSkills || '',
        recruiterFeedback: candidate.recruiterFeedback || '',
        interviewerFeedback: candidate.interviewerFeedback || '',
        remark: candidate.remark || '',
        company: candidate.company || null,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt
      }
    });
  } catch (error) {
    console.error('HRMS get candidate by ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

async function createCandidate(req, res) {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    try {
      await initializeCompanyPortals(company);
    } catch (e) {
      console.warn('[recruitment] initializeCompanyPortals (create):', e.message);
    }
    const candidateData = req.body;
    const db = await getHrmsDb(company);
    const recruitmentCol = db.collection('recruitment');
    
    // Prepare candidate document
    const candidate = {
      candidateName: candidateData.candidateName || '',
      contactNumber: candidateData.contactNumber || '',
      email: candidateData.email || '',
      currentLocation: candidateData.currentLocation || '',
      callingDate: candidateData.callingDate ? new Date(candidateData.callingDate) : new Date(),
      assignDate: candidateData.assignDate ? new Date(candidateData.assignDate) : new Date(),
      currentOrganisation: candidateData.currentOrganisation || '',
      education: candidateData.education || '',
      totalExperience: candidateData.totalExperience || '',
      assignedTo: candidateData.assignedTo || '',
      status: candidateData.status || 'New',
      currentCTCFixed: candidateData.currentCTCFixed || 0,
      currentCTCInHand: candidateData.currentCTCInHand || 0,
      expectedCTC: candidateData.expectedCTC || 0,
      noticePeriod: candidateData.noticePeriod || '',
      willingToWorkInStartup: candidateData.willingToWorkInStartup || 'Yes',
      communicationSkills: candidateData.communicationSkills || '',
      recruiterFeedback: candidateData.recruiterFeedback || '',
      interviewerFeedback: candidateData.interviewerFeedback || '',
      remark: candidateData.remark || '',
      folderName: candidateData.folderName || '',
      company: candidateData.company || company || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Insert candidate
    const result = await recruitmentCol.insertOne(candidate);
    
    res.json({
      success: true,
      message: 'Candidate added successfully',
      data: {
        id: result.insertedId.toString(),
        ...candidate
      }
    });
  } catch (error) {
    console.error('HRMS add candidate error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function bulkUploadCandidates(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { candidates, company: candidateCompany } = req.body;
    
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No candidates provided'
      });
    }

    const effectiveCompany = company || candidateCompany;
    if (!effectiveCompany) {
      return res.status(400).json({
        success: false,
        error: 'Company is required for bulk upload (body, query, header, or JWT).',
      });
    }
    try {
      await initializeCompanyPortals(effectiveCompany);
    } catch (e) {
      console.warn('[recruitment] initializeCompanyPortals:', e.message);
    }

    const db = await getHrmsDb(effectiveCompany);
    const recruitmentCol = db.collection('recruitment');
    
    const insertedCandidates = [];
    const errors = [];
    
    // Process each candidate
    for (let i = 0; i < candidates.length; i++) {
      const candidateData = candidates[i];
      
      try {
        // Prepare candidate document
        const candidate = {
          candidateName: candidateData.candidateName || '',
          contactNumber: candidateData.contactNumber || '',
          email: candidateData.email || '',
          currentLocation: candidateData.currentLocation || '',
          callingDate: candidateData.callingDate ? new Date(candidateData.callingDate) : new Date(),
          assignDate: candidateData.assignDate ? new Date(candidateData.assignDate) : new Date(),
          currentOrganisation: candidateData.currentOrganisation || '',
          education: candidateData.education || '',
          totalExperience: candidateData.totalExperience || '',
          assignedTo: candidateData.assignedTo || '',
          status: candidateData.status || 'New',
          currentCTCFixed: parseFloat(candidateData.currentCTCFixed) || 0,
          currentCTCInHand: parseFloat(candidateData.currentCTCInHand) || 0,
          expectedCTC: parseFloat(candidateData.expectedCTC) || 0,
          noticePeriod: candidateData.noticePeriod || '',
          willingToWorkInStartup: candidateData.willingToWorkInStartup || 'Yes',
          communicationSkills: candidateData.communicationSkills || '',
          recruiterFeedback: candidateData.recruiterFeedback || '',
          interviewerFeedback: candidateData.interviewerFeedback || '',
          remark: candidateData.remark || '',
          folderName: candidateData.folderName || '',
          company: candidateData.company || effectiveCompany || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Insert candidate
        const result = await recruitmentCol.insertOne(candidate);
        insertedCandidates.push({
          id: result.insertedId.toString(),
          ...candidate
        });
      } catch (error) {
        console.error(`Error inserting candidate ${i + 1}:`, error);
        errors.push({
          row: i + 2, // +2 because header is row 1 and index is 0-based
          errors: [error.message || 'Failed to insert candidate']
        });
      }
    }
    
    res.json({
      success: true,
      message: `Successfully imported ${insertedCandidates.length} candidate(s)${errors.length > 0 ? `. ${errors.length} candidate(s) had errors.` : ''}`,
      data: {
        created: insertedCandidates.length,
        candidates: insertedCandidates,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('HRMS bulk upload candidates error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

async function updateCandidate(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const candidateId = req.params.id;
    const candidateData = req.body;
    
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID is required'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    // Validate ObjectId format
    if (!ObjectId.isValid(candidateId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate ID format'
      });
    }
    
    // Prepare update document
    const updateData = {
      ...candidateData,
      updatedAt: new Date()
    };
    
    // Convert date strings to Date objects if present
    if (updateData.callingDate && typeof updateData.callingDate === 'string') {
      updateData.callingDate = new Date(updateData.callingDate);
    }
    if (updateData.assignDate && typeof updateData.assignDate === 'string') {
      updateData.assignDate = new Date(updateData.assignDate);
    }
    if (updateData.joiningDate && typeof updateData.joiningDate === 'string') {
      updateData.joiningDate = new Date(updateData.joiningDate);
    }
    if (updateData.interviewDate && typeof updateData.interviewDate === 'string') {
      updateData.interviewDate = new Date(updateData.interviewDate);
    }
    if (updateData.interviewScheduledAt && typeof updateData.interviewScheduledAt === 'string') {
      updateData.interviewScheduledAt = new Date(updateData.interviewScheduledAt);
    }
    
    // If company is not specified, search across all databases
    let result = null;
    if (!company || company === 'all' || company === 'undefined') {
      const dbs = await getAllHrmsDbs();
      for (const db of dbs) {
        const recruitmentCol = db.collection('recruitment');
        result = await recruitmentCol.updateOne(
          { _id: new ObjectId(candidateId) },
          { $set: updateData }
        );
        if (result.matchedCount > 0) {
          break; // Found and updated, exit loop
        }
      }
    } else {
      // Get HRMS database for specific company
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      result = await recruitmentCol.updateOne(
        { _id: new ObjectId(candidateId) },
        { $set: updateData }
      );
    }
    
    if (!result || result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    // Fetch the updated candidate to return all fields
    let updatedCandidate = null;
    if (!company || company === 'all' || company === 'undefined') {
      const dbs = await getAllHrmsDbs();
      for (const db of dbs) {
        const recruitmentCol = db.collection('recruitment');
        updatedCandidate = await recruitmentCol.findOne({ _id: new ObjectId(candidateId) });
        if (updatedCandidate) {
          break;
        }
      }
    } else {
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      updatedCandidate = await recruitmentCol.findOne({ _id: new ObjectId(candidateId) });
    }
    
    const formatDate = (date) => toYmdUTC(date);

    // Return all candidate fields
    res.json({
      success: true,
      message: 'Candidate updated successfully',
      data: {
        id: updatedCandidate._id?.toString(),
        candidateName: updatedCandidate.candidateName || '',
        contactNumber: updatedCandidate.contactNumber || '',
        email: updatedCandidate.email || '',
        currentLocation: updatedCandidate.currentLocation || '',
        callingDate: formatDate(updatedCandidate.callingDate),
        assignDate: formatDate(updatedCandidate.assignDate),
        currentOrganisation: updatedCandidate.currentOrganisation || '',
        education: updatedCandidate.education || '',
        totalExperience: updatedCandidate.totalExperience || '',
        assignedTo: updatedCandidate.assignedTo || '',
        status: updatedCandidate.status || 'New',
        currentCTCFixed: updatedCandidate.currentCTCFixed || 0,
        currentCTCInHand: updatedCandidate.currentCTCInHand || 0,
        expectedCTC: updatedCandidate.expectedCTC || 0,
        noticePeriod: updatedCandidate.noticePeriod || '',
        willingToWorkInStartup: updatedCandidate.willingToWorkInStartup || 'Yes',
        communicationSkills: updatedCandidate.communicationSkills || '',
        recruiterFeedback: updatedCandidate.recruiterFeedback || '',
        interviewerFeedback: updatedCandidate.interviewerFeedback || '',
        remark: updatedCandidate.remark || '',
        company: updatedCandidate.company || null,
        createdAt: updatedCandidate.createdAt,
        updatedAt: updatedCandidate.updatedAt
      }
    });
  } catch (error) {
    console.error('HRMS update candidate error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

async function deleteCandidate(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const candidateId = req.params.id;
    
    // Validate candidateId exists
    if (!candidateId || candidateId === 'undefined' || candidateId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Candidate ID is required'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    // If company is not specified, search across all databases
    let result = null;
    
    // Check if candidateId is a valid ObjectId
    if (ObjectId.isValid(candidateId)) {
      // Try to delete by ObjectId
      if (!company || company === 'all' || company === 'undefined') {
        const dbs = await getAllHrmsDbs();
        for (const db of dbs) {
          const recruitmentCol = db.collection('recruitment');
          result = await recruitmentCol.deleteOne({ _id: new ObjectId(candidateId) });
          if (result.deletedCount > 0) {
            break; // Found and deleted, exit loop
          }
        }
      } else {
        // Get HRMS database for specific company
        const db = await getHrmsDb(company);
        const recruitmentCol = db.collection('recruitment');
        result = await recruitmentCol.deleteOne({ _id: new ObjectId(candidateId) });
      }
    } else {
      // If not a valid ObjectId, it might be a numeric fallback ID from frontend
      // In this case, we can't reliably delete it as it's not a real database ID
      // Return a helpful error message
      return res.status(400).json({
        success: false,
        error: 'Invalid candidate ID. This candidate may not be properly saved in the database. Please refresh the page and try again.'
      });
    }
    
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Candidate deleted successfully'
    });
  } catch (error) {
    console.error('HRMS delete candidate error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

async function bulkDeleteCandidates(req, res) {
  try {
    await connectMongo();
    const company = getCompanyFromRequest(req);
    const { ids } = req.body; // Array of candidate IDs
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide an array of candidate IDs to delete'
      });
    }
    
    const { ObjectId } = require('mongodb');
    
    // Filter out invalid ObjectIds
    const validIds = ids.filter(id => ObjectId.isValid(id));
    
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid candidate IDs provided'
      });
    }
    
    // Convert to ObjectIds
    const objectIds = validIds.map(id => new ObjectId(id));
    
    let totalDeleted = 0;
    
    // If company is not specified, search across all databases
    if (!company || company === 'all' || company === 'undefined') {
      const dbs = await getAllHrmsDbs();
      for (const db of dbs) {
        const recruitmentCol = db.collection('recruitment');
        const result = await recruitmentCol.deleteMany({ _id: { $in: objectIds } });
        totalDeleted += result.deletedCount;
      }
    } else {
      try {
        await initializeCompanyPortals(company);
      } catch (e) {
        console.warn('[recruitment] initializeCompanyPortals (bulk delete):', e.message);
      }
      const db = await getHrmsDb(company);
      const recruitmentCol = db.collection('recruitment');
      const result = await recruitmentCol.deleteMany({ _id: { $in: objectIds } });
      totalDeleted = result.deletedCount;
    }
    
    if (totalDeleted === 0) {
      return res.status(404).json({
        success: false,
        error: 'No candidates found to delete'
      });
    }
    
    res.json({
      success: true,
      message: `Successfully deleted ${totalDeleted} candidate(s)`,
      deletedCount: totalDeleted
    });
  } catch (error) {
    console.error('HRMS bulk delete candidates error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

module.exports = {
  recruitmentAnalytics,
  listCandidates,
  listHiring,
  listOnboarding,
  getCandidateById,
  createCandidate,
  bulkUploadCandidates,
  updateCandidate,
  deleteCandidate,
  bulkDeleteCandidates,
};
