/**
 * One-time generator: split portals/admin-portal/routes/auth.js and admin-users.js
 * into controllers + thin route files.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const routesDir = path.join(ROOT, 'routes');
const controllersDir = path.join(ROOT, 'controllers');

fs.mkdirSync(controllersDir, { recursive: true });

function readLines(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/);
}
function slice(lines, start1, end1) {
  return lines.slice(start1 - 1, end1).join('\n');
}
function stripRouter(block, fnName) {
  let t = block.replace(
    /^router\.(get|post|put|delete|patch)\([^,]+,\s*async\s*\(req,\s*res\)\s*=>\s*\{/m,
    `async function ${fnName}(req, res) {`
  );
  t = t.trimEnd();
  if (t.endsWith('});')) t = t.slice(0, -2);
  return t.trim() + '\n';
}

// ---- auth.js ----
{
  const authPath = path.join(routesDir, 'auth.js');
  const lines = readLines(authPath);
  const header = slice(lines, 1, 9) + '\n\n';

  const parts = [
    { fn: 'signup', start: 10, end: 97 },
    { fn: 'login', start: 98, end: 217 },
    { fn: 'verify', start: 218, end: 292 },
  ];
  const bodies = parts.map((p) => stripRouter(slice(lines, p.start, p.end), p.fn)).join('\n');

  fs.writeFileSync(
    path.join(controllersDir, 'authController.js'),
    header + bodies + '\nmodule.exports = { signup, login, verify };\n'
  );

  fs.writeFileSync(
    authPath,
    `const express = require('express');\nconst router = express.Router();\n\nconst c = require('../controllers/authController');\n\nrouter.post('/signup', c.signup);\nrouter.post('/login', c.login);\nrouter.get('/verify', c.verify);\n\nmodule.exports = router;\n`
  );
}

// ---- admin-users.js ----
{
  const p = path.join(routesDir, 'admin-users.js');
  const lines = readLines(p);
  const header = slice(lines, 1, 63) + '\n\n';

  const parts = [
    { fn: 'listUsers', start: 64, end: 186 },
    { fn: 'listDepartments', start: 187, end: 275 },
    { fn: 'getUserById', start: 276, end: 327 },
    { fn: 'createUser', start: 328, end: 507 },
    { fn: 'updateUser', start: 508, end: 664 },
    { fn: 'deleteUser', start: 665, end: 708 },
    { fn: 'toggleActive', start: 709, end: 762 },
    { fn: 'debugInfo', start: 763, end: 810 },
    { fn: 'updatePortals', start: 811, end: 880 },
  ];

  const bodies = parts.map((p2) => stripRouter(slice(lines, p2.start, p2.end), p2.fn)).join('\n');

  fs.writeFileSync(
    path.join(controllersDir, 'adminUsersController.js'),
    header +
      bodies +
      '\nmodule.exports = {\n' +
      parts.map((p2) => `  ${p2.fn},`).join('\n') +
      '\n};\n'
  );

  fs.writeFileSync(
    p,
    `const express = require('express');\nconst router = express.Router();\n\nconst c = require('../controllers/adminUsersController');\n\nrouter.get('/', c.listUsers);\nrouter.get('/departments/list', c.listDepartments);\nrouter.get('/:id', c.getUserById);\nrouter.post('/', c.createUser);\nrouter.put('/:id', c.updateUser);\nrouter.delete('/:id', c.deleteUser);\nrouter.patch('/:id/toggle-active', c.toggleActive);\nrouter.get('/debug/info', c.debugInfo);\nrouter.patch('/:id/portals', c.updatePortals);\n\nmodule.exports = router;\n`
  );
}

console.log('Split admin-portal routes into controllers.');

