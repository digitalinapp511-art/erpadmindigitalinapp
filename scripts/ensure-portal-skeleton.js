const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'portals');
const portals = ['hrms', 'hrms-admin', 'admin-portal', 'assets', 'finance', 'employee', 'query-tracker'];
const sub = ['controllers', 'middlewares', 'models', 'services', 'validations'];

for (const p of portals) {
  for (const s of sub) {
    const d = path.join(root, p, s);
    if (p === 'hrms' && s === 'utils') continue;
    fs.mkdirSync(d, { recursive: true });
    const gf = path.join(d, '.gitkeep');
    if (!fs.existsSync(gf)) fs.writeFileSync(gf, '');
  }
}
