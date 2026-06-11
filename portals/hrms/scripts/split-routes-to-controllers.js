/**
 * One-time generator: reads routes/index.js line ranges and writes controllers + thin routes.
 * Run from hrms_backend: node portals/hrms/scripts/split-routes-to-controllers.js
 */
const fs = require('fs');
const path = require('path');

const HRMS_ROOT = path.join(__dirname, '..');
const ROUTES_FILE = path.join(HRMS_ROOT, 'routes', 'index.js');
const lines = fs.readFileSync(ROUTES_FILE, 'utf8').split(/\r?\n/);

function sliceLines(start1, end1) {
  return lines.slice(start1 - 1, end1).join('\n');
}

function stripRouter(block, fnName) {
  let b = block.replace(
    /^router\.(get|post|put|delete|patch)\([^,]+,\s*async\s*\(req,\s*res\)\s*=>\s*\{/m,
    'async function ' + fnName + '(req, res) {'
  );
  b = b.trimEnd();
  // router.post(..., async () => { ... });  → keep closing `}` for async, drop `);` for .post(
  if (b.endsWith('});')) {
    b = b.slice(0, -2);
  }
  return b;
}

const HRMS_CTX =
  "const { connectMongo } = require('../../../config/mongo');\n" +
  "const {\n" +
  "  getCompanyFromRequest,\n" +
  "  normalizeCompany,\n" +
  "  requireCompany,\n" +
  "  getHrmsDb,\n" +
  "  getAllHrmsDbs,\n" +
  "  getEmployeeDbForHrms,\n" +
  "} = require('../utils/hrmsContext');\n\n";

const segments = [
  { ctrl: 'employeesController.js', fn: 'listEmployees', start: 13, end: 80 },
  { ctrl: 'attendanceController.js', fn: 'listAttendance', start: 83, end: 218 },
  { ctrl: 'attendanceController.js', fn: 'attendanceStats', start: 221, end: 587, append: true },
  { ctrl: 'leavesController.js', fn: 'listLeaves', start: 590, end: 605 },
  { ctrl: 'leavesController.js', fn: 'listAttendanceRequests', start: 608, end: 668, append: true },
  { ctrl: 'leavesController.js', fn: 'leaveOverviewStats', start: 671, end: 739, append: true },
  { ctrl: 'leavesController.js', fn: 'leaveUtilization', start: 742, end: 838, append: true },
  { ctrl: 'leavesController.js', fn: 'attendanceRequestStats', start: 841, end: 888, append: true },
  { ctrl: 'leavesController.js', fn: 'approveAttendanceRequest', start: 891, end: 1036, append: true },
  { ctrl: 'leavesController.js', fn: 'rejectAttendanceRequest', start: 1039, end: 1099, append: true },
  { ctrl: 'leavesController.js', fn: 'updateAttendanceRequest', start: 1102, end: 1183, append: true },
  { ctrl: 'leavesController.js', fn: 'deleteAttendanceRequest', start: 1186, end: 1229, append: true },
  { ctrl: 'leavesController.js', fn: 'createAttendanceRequest', start: 1232, end: 1316, append: true },
  { ctrl: 'leavePolicyController.js', fn: 'getLeavePolicy', start: 1319, end: 1387 },
  { ctrl: 'leavePolicyController.js', fn: 'putLeavePolicy', start: 1390, end: 1438, append: true },
  { ctrl: 'recruitmentController.js', fn: 'recruitmentAnalytics', start: 1441, end: 1718 },
  { ctrl: 'recruitmentController.js', fn: 'listCandidates', start: 1721, end: 1886, append: true },
  { ctrl: 'recruitmentController.js', fn: 'listHiring', start: 1889, end: 2004, append: true },
  { ctrl: 'recruitmentController.js', fn: 'listOnboarding', start: 2007, end: 2147, append: true },
  { ctrl: 'recruitmentController.js', fn: 'getCandidateById', start: 2150, end: 2228, append: true },
  { ctrl: 'recruitmentController.js', fn: 'createCandidate', start: 2231, end: 2286, append: true },
  { ctrl: 'recruitmentController.js', fn: 'bulkUploadCandidates', start: 2289, end: 2375, append: true },
  { ctrl: 'recruitmentController.js', fn: 'updateCandidate', start: 2376, end: 2518, append: true },
  { ctrl: 'recruitmentController.js', fn: 'deleteCandidate', start: 2519, end: 2586, append: true },
  { ctrl: 'recruitmentController.js', fn: 'bulkDeleteCandidates', start: 2587, end: 2652, append: true },
  { ctrl: 'recruitmentAdminController.js', fn: 'listRecruiters', start: 2655, end: 2720 },
  { ctrl: 'recruitmentAdminController.js', fn: 'createRecruiter', start: 2723, end: 2806, append: true },
  { ctrl: 'recruitmentAdminController.js', fn: 'updateRecruiter', start: 2807, end: 2899, append: true },
  { ctrl: 'recruitmentAdminController.js', fn: 'deleteRecruiter', start: 2900, end: 2969, append: true },
  { ctrl: 'recruitmentAdminController.js', fn: 'listInterviews', start: 2972, end: 3168, append: true },
];

const controllerDir = path.join(HRMS_ROOT, 'controllers');
const routesDir = path.join(HRMS_ROOT, 'routes');
fs.mkdirSync(controllerDir, { recursive: true });

const byFile = new Map();
for (const seg of segments) {
  const raw = sliceLines(seg.start, seg.end);
  const body = stripRouter(raw, seg.fn);
  if (!byFile.has(seg.ctrl)) byFile.set(seg.ctrl, { bodies: [], fns: [] });
  const entry = byFile.get(seg.ctrl);
  entry.bodies.push(body);
  entry.fns.push(seg.fn);
}

for (const [filename, { bodies, fns }] of byFile) {
  const out = HRMS_CTX + bodies.join('\n\n') + '\n\nmodule.exports = {\n' + fns.map((f) => `  ${f},`).join('\n') + '\n};\n';
  fs.writeFileSync(path.join(controllerDir, filename), out);
}

// Thin route files
const employeesRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const c = require('../controllers/employeesController');\n" +
  "router.get('/employees', c.listEmployees);\n" +
  "module.exports = router;\n";
fs.writeFileSync(path.join(routesDir, 'employees.routes.js'), employeesRoutes);

const attendanceRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const c = require('../controllers/attendanceController');\n" +
  "router.get('/attendance', c.listAttendance);\n" +
  "router.get('/attendance/stats', c.attendanceStats);\n" +
  "module.exports = router;\n";
fs.writeFileSync(path.join(routesDir, 'attendance.routes.js'), attendanceRoutes);

const leavesRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const c = require('../controllers/leavesController');\n" +
  "router.get('/leaves', c.listLeaves);\n" +
  "router.get('/attendance-requests', c.listAttendanceRequests);\n" +
  "router.get('/leaves/overview/stats', c.leaveOverviewStats);\n" +
  "router.get('/leaves/overview/utilization', c.leaveUtilization);\n" +
  "router.get('/attendance-requests/stats', c.attendanceRequestStats);\n" +
  "router.post('/attendance-requests/:requestId/approve', c.approveAttendanceRequest);\n" +
  "router.post('/attendance-requests/:requestId/reject', c.rejectAttendanceRequest);\n" +
  "router.put('/attendance-requests/:requestId', c.updateAttendanceRequest);\n" +
  "router.delete('/attendance-requests/:requestId', c.deleteAttendanceRequest);\n" +
  "router.post('/attendance-requests', c.createAttendanceRequest);\n" +
  "module.exports = router;\n";
fs.writeFileSync(path.join(routesDir, 'leaves.routes.js'), leavesRoutes);

const leavePolicyRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const c = require('../controllers/leavePolicyController');\n" +
  "router.get('/leave-policy', c.getLeavePolicy);\n" +
  "router.put('/leave-policy', c.putLeavePolicy);\n" +
  "module.exports = router;\n";
fs.writeFileSync(path.join(routesDir, 'leavePolicy.routes.js'), leavePolicyRoutes);

const recruitmentRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const c = require('../controllers/recruitmentController');\n" +
  "router.get('/recruitment/analytics', c.recruitmentAnalytics);\n" +
  "router.get('/recruitment/candidates', c.listCandidates);\n" +
  "router.get('/recruitment/hiring', c.listHiring);\n" +
  "router.get('/recruitment/onboarding', c.listOnboarding);\n" +
  "router.get('/recruitment/candidates/:id', c.getCandidateById);\n" +
  "router.post('/recruitment/candidates', c.createCandidate);\n" +
  "router.post('/recruitment/candidates/bulk-upload', c.bulkUploadCandidates);\n" +
  "router.put('/recruitment/candidates/:id', c.updateCandidate);\n" +
  "router.delete('/recruitment/candidates/:id', c.deleteCandidate);\n" +
  "router.delete('/recruitment/candidates', c.bulkDeleteCandidates);\n" +
  "module.exports = router;\n";
fs.writeFileSync(path.join(routesDir, 'recruitment.routes.js'), recruitmentRoutes);

const recruitmentAdminRoutes =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "const c = require('../controllers/recruitmentAdminController');\n" +
  "router.get('/recruitment/recruiters', c.listRecruiters);\n" +
  "router.post('/recruitment/recruiters', c.createRecruiter);\n" +
  "router.put('/recruitment/recruiters/:id', c.updateRecruiter);\n" +
  "router.delete('/recruitment/recruiters/:id', c.deleteRecruiter);\n" +
  "router.get('/recruitment/interviews', c.listInterviews);\n" +
  "module.exports = router;\n";
fs.writeFileSync(path.join(routesDir, 'recruitmentAdmin.routes.js'), recruitmentAdminRoutes);

const indexNew =
  "const express = require('express');\n" +
  "const router = express.Router();\n" +
  "router.use(require('./employees.routes'));\n" +
  "router.use(require('./attendance.routes'));\n" +
  "router.use(require('./leaves.routes'));\n" +
  "router.use(require('./leavePolicy.routes'));\n" +
  "router.use(require('./recruitment.routes'));\n" +
  "// recruitmentAdmin.routes mounted from portals/hrms-admin/app.js\n" +
  "module.exports = router;\n";

fs.renameSync(ROUTES_FILE, path.join(routesDir, 'index.legacy.js'));
fs.writeFileSync(ROUTES_FILE, indexNew);

console.log('Done. Controllers in controllers/, routes/*.routes.js, index.legacy.js backup.');
