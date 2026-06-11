const fs = require('fs');
const path = require('path');

function cpRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, name.name);
    const d = path.join(dest, name.name);
    if (name.isDirectory()) cpRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function replaceInFile(file, from, to) {
  let t = fs.readFileSync(file, 'utf8');
  if (!t.includes(from)) return;
  fs.writeFileSync(file, t.split(from).join(to));
}

const root = path.join(__dirname, '..');

// Admin portal
cpRecursive(path.join(root, 'shared', 'routes'), path.join(root, 'portals', 'admin-portal', 'routes'));
for (const f of ['auth.js', 'admin-users.js']) {
  const p = path.join(root, 'portals', 'admin-portal', 'routes', f);
  if (fs.existsSync(p)) {
    replaceInFile(p, "require('../../config/", "require('../../../config/");
  }
}

// Assets, finance, employee (single routes/index.js each)
for (const { from, to } of [
  { from: 'asset-tracker-portal', to: 'portals/assets' },
  { from: 'finance-portal', to: 'portals/finance' },
  { from: 'employee-portal', to: 'portals/employee' },
]) {
  const srcDir = path.join(root, from);
  if (!fs.existsSync(srcDir)) continue;
  cpRecursive(srcDir, path.join(root, to));
  const idx = path.join(root, to, 'routes', 'index.js');
  if (fs.existsSync(idx)) {
    replaceInFile(idx, "require('../../config/", "require('../../../config/");
  }
}

// Query tracker (full subtree)
const qtSrc = path.join(root, 'query-tracker-portal');
const qtDest = path.join(root, 'portals', 'query-tracker');
if (fs.existsSync(qtSrc)) {
  cpRecursive(qtSrc, qtDest);
  const fixes = [
    path.join(qtDest, 'config', 'database.js'),
    path.join(qtDest, 'middleware', 'auth.js'),
    path.join(qtDest, 'scripts', 'seed.js'),
  ];
  for (const p of fixes) {
    if (fs.existsSync(p)) replaceInFile(p, "require('../../config/", "require('../../../config/");
  }
}

console.log('copy-portals done');
