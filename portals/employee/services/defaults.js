const defaultDashboard = (employeeId = 'default') => ({
  employeeId,
  quickStats: {
    leaveBalance: 12,
    upcomingShift: '09:30 AM Tomorrow',
    pendingRequests: 1,
    lastPayout: 'Jan 5, 2025'
  },
  attendanceTrend: [
    { day: 'Mon', status: 'Present', hours: 8.2 },
    { day: 'Tue', status: 'Present', hours: 7.9 },
    { day: 'Wed', status: 'WFH', hours: 8.5 },
    { day: 'Thu', status: 'Present', hours: 8.1 },
    { day: 'Fri', status: 'Present', hours: 6.4 },
    { day: 'Sat', status: 'Weekend', hours: 0 },
    { day: 'Sun', status: 'Weekend', hours: 0 },
  ],
  announcements: [
    { id: 'ann1', title: 'FY25 Kickoff Townhall', date: '2025-01-21', type: 'event', audience: 'All employees' },
    { id: 'ann2', title: 'Cybersecurity Refresher Due Friday', date: '2025-01-17', type: 'reminder', audience: 'Product & Tech' },
    { id: 'ann3', title: 'People Pulse Survey Results', date: '2025-01-15', type: 'update', audience: 'Company-wide' },
  ],
  requestHistory: [
    { id: 'REQ-2831', type: 'Leave', status: 'Approved', submitted: 'Jan 12', details: '2 days - Personal errand' },
    { id: 'REQ-2842', type: 'WFH', status: 'Pending', submitted: 'Jan 15', details: 'Client calls from home' },
    { id: 'EXP-9921', type: 'Expense', status: 'Paid', submitted: 'Jan 08', details: 'Client dinner - ₹2,150' },
  ],
  assets: [
    { name: 'MacBook Pro 14"', tag: 'IT-45821', status: 'In Use' },
    { name: 'Access Card HQ-12F', tag: 'SEC-1893', status: 'In Use' },
  ],
  learningJourneys: [
    { id: 'lj1', title: 'AI for HR Leaders', progress: 68, due: 'Feb 28', badge: 'In progress' },
    { id: 'lj2', title: 'Advanced Presentation Storytelling', progress: 42, due: 'Mar 12', badge: 'New' },
    { id: 'lj3', title: 'Wellbeing Micro-habits', progress: 90, due: 'Feb 05', badge: 'Almost done' },
  ],
  kudos: [
    { id: 'k1', from: 'Priya S.', message: 'Thanks for stepping in on the West Coast client review!', date: 'Jan 17' },
    { id: 'k2', from: 'Rohit P.', message: 'Your demo deck helped us close the enterprise pilot.', date: 'Jan 14' },
  ],
  communityHighlights: [
    { id: 'ch1', title: 'Wellness Wednesday: Breathwork workshop', time: 'Jan 24 • 4:00 PM', location: 'Townhall' },
    { id: 'ch2', title: 'Product Jam: Ideas that shipped in Q4', time: 'Jan 27 • 11:30 AM', location: 'Zoom' },
  ],
});

const defaultAttendance = (employeeId = 'default') => ({
  employeeId,
  attendanceLast7Days: [
    { day: 'Mon', status: 'Present', hours: 8.2 },
    { day: 'Tue', status: 'Present', hours: 7.9 },
    { day: 'Wed', status: 'WFH', hours: 8.5 },
    { day: 'Thu', status: 'Present', hours: 8.1 },
    { day: 'Fri', status: 'Present', hours: 6.4 },
    { day: 'Sat', status: 'Weekend', hours: 0 },
    { day: 'Sun', status: 'Weekend', hours: 0 },
  ],
});

const defaultRequests = (employeeId = 'default') => ({
  employeeId,
  leaveBalances: [
    { type: 'Casual Leave', balance: 4 },
    { type: 'Sick Leave', balance: 3 },
    { type: 'Earned Leave', balance: 5 },
    { type: 'Work From Home', balance: 2 },
    { type: 'Compensatory Off', balance: 1 },
    { type: 'LOP', balance: 0 },
  ],
  recentRequests: [
    { id: 'REQ-2831', type: 'Leave', status: 'Approved', submitted: 'Jan 12', details: '2 days - Personal errand' },
    { id: 'REQ-2842', type: 'WFH', status: 'Pending', submitted: 'Jan 15', details: 'Client calls from home' },
    { id: 'EXP-9921', type: 'Expense', status: 'Paid', submitted: 'Jan 08', details: 'Client dinner - ₹2,150' },
  ]
});

const defaultOrg = () => ({
  departments: [
    {
      id: 'engineering',
      name: 'Engineering & Product',
      description: 'Responsible for building core platform capabilities, product experiences, and innovation initiatives.',
      headcount: 58,
      cxo: { name: 'Ananya Iyer', title: 'Chief Technology Officer' },
      directors: [
        { name: 'Rahul Verma', title: 'Director of Platform Engineering' },
        { name: 'Tanvi Kulkarni', title: 'Director of Product Engineering' },
      ],
      seniorManagers: [
        { name: 'Sneha Reddy', title: 'Senior Engineering Manager - Platform' },
        { name: 'Karthik Nayak', title: 'Senior Engineering Manager - Applications' },
      ],
      managers: [
        { name: 'Aditya Rao', title: 'Engineering Manager - Core APIs' },
        { name: 'Megha Sharma', title: 'Engineering Manager - Mobile Apps' },
      ],
      leads: [
        { name: 'Rohit Sinha', title: 'Tech Lead - Microservices' },
        { name: 'Neha Kapoor', title: 'Tech Lead - Frontend Guild' },
      ],
    },
    {
      id: 'people',
      name: 'People & Culture',
      description: 'Builds a people-first culture with focus on talent management, engagement, and compliance.',
      headcount: 24,
      cxo: { name: 'Leena Prakash', title: 'Chief People Officer' },
      directors: [{ name: 'Mansi Sheth', title: 'Director - Talent Success' }],
      seniorManagers: [
        { name: 'Arunima Bose', title: 'Senior HR Manager - Talent Development' },
        { name: 'Tarun Jha', title: 'Senior HR Manager - Total Rewards' },
      ],
      managers: [{ name: 'Shweta Purohit', title: 'HR Business Partner - Tech' }],
      leads: [{ name: 'Prerna Dixit', title: 'Lead - Culture & Engagement', focus: 'Programs' }],
    },
  ],
});

const defaultReports = () => ({
  reports: [
    { id: 'attendance', title: 'Attendance history', description: 'Daily presence, late marks, WFH logs.', formats: ['CSV', 'PDF'] },
    { id: 'expenses', title: 'Expense submissions', description: 'All non-advance and advance-based claims.', formats: ['CSV', 'XLSX'] },
    { id: 'requests', title: 'Leave & request log', description: 'Leaves, WFH, and support tickets filed.', formats: ['CSV'] },
  ],
});

module.exports = { defaultDashboard, defaultAttendance, defaultRequests, defaultOrg, defaultReports };
