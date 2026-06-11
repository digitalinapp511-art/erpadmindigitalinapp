const fs = require('fs');
const path = require('path');

function rewriteController(filePath, replacements, header, footer) {
  let t = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    t = t.split(from).join(to);
  }
  // Convert route closers `});` into `}` after conversion.
  t = t.replace(/\n\}\);\s*/g, '\n}\n');
  fs.writeFileSync(filePath, header + t.trim() + '\n' + footer);
}

const root = path.join(__dirname, '..');

rewriteController(
  path.join(root, 'controllers', 'portalDataController.js'),
  [
    ["router.get('/dashboard', async (req, res) => {", 'async function getDashboard(req, res) {'],
    ["router.get('/attendance', async (req, res) => {", 'async function getAttendance(req, res) {'],
    ["router.get('/requests', async (req, res) => {", 'async function getRequests(req, res) {'],
    ["router.get('/org', async (req, res) => {", 'async function getOrg(req, res) {'],
    ["router.get('/reports', async (req, res) => {", 'async function getReports(req, res) {'],
  ],
  `const { connectMongo } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');
const { getOrCreateDoc } = require('../services/getOrCreateDoc');
const { defaultDashboard, defaultAttendance, defaultRequests, defaultOrg, defaultReports } = require('../services/defaults');

`,
  `
module.exports = { getDashboard, getAttendance, getRequests, getOrg, getReports };
`
);

rewriteController(
  path.join(root, 'controllers', 'checkinController.js'),
  [
    ["router.post('/checkin', async (req, res) => {", 'async function checkin(req, res) {'],
    ["router.post('/checkout', async (req, res) => {", 'async function checkout(req, res) {'],
    ["router.get('/checkin/status', async (req, res) => {", 'async function getCheckinStatus(req, res) {'],
    ["router.get('/checkin/history', async (req, res) => {", 'async function getCheckinHistory(req, res) {'],
  ],
  `const { connectMongo, getDb, getEmployeePortalDb } = require('../../../config/mongo');
const { getCompanyFromRequest, checkinStatusCache, CHECKIN_STATUS_CACHE_TTL_MS } = require('../utils/employeeContext');

`,
  `
module.exports = { checkin, checkout, getCheckinStatus, getCheckinHistory };
`
);

rewriteController(
  path.join(root, 'controllers', 'attendanceRequestsController.js'),
  [
    ["router.post('/attendance-request', async (req, res) => {", 'async function submitAttendanceRequest(req, res) {'],
    ["router.get('/attendance-requests', async (req, res) => {", 'async function listAttendanceRequests(req, res) {'],
  ],
  `const { connectMongo, getDb, getEmployeePortalDb } = require('../../../config/mongo');
const { getCompanyFromRequest } = require('../utils/employeeContext');

`,
  `
module.exports = { submitAttendanceRequest, listAttendanceRequests };
`
);

console.log('Normalized employee portal controllers.');

