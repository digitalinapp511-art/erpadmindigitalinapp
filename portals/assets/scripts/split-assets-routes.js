/**
 * One-time generator: split portals/assets/routes/index.js into controllers + route modules.
 * Creates routes/index.legacy.js backup (already created) and overwrites routes/index.js with a thin router.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES_FILE = path.join(ROOT, 'routes', 'index.js');
const LEGACY_FILE = path.join(ROOT, 'routes', 'index.legacy.js');

const src = fs.readFileSync(ROUTES_FILE, 'utf8');
const lines = src.split(/\r?\n/);

function slice(start1, end1) {
  return lines.slice(start1 - 1, end1).join('\n');
}

function stripRouter(block, fnName) {
  // Replace first line `router.get('..', async (req,res)=>{` to `async function fn(req,res){`
  let t = block.replace(
    /^router\.(get|post|put|delete|patch)\([^,]+,\s*async\s*\(req,\s*res\)\s*=>\s*\{/m,
    `async function ${fnName}(req, res) {`
  );
  // Drop final `});`
  t = t.trimEnd();
  if (t.endsWith('});')) t = t.slice(0, -2);
  return t.trim() + '\n';
}

const sharedHeader = `const XLSX = require('xlsx');\nconst { connectMongo } = require('../../../config/mongo');\nconst { getCompanyDatabaseName, getDatabaseName, getCollectionName } = require('../../../config/database.config');\n\n` + slice(7, 109) + '\n';
// slice(7,109) includes helpers + defaultCategories/defaultLocations

const controllersDir = path.join(ROOT, 'controllers');
fs.mkdirSync(controllersDir, { recursive: true });

const segments = [
  { file: 'assetsController.js', fn: 'getAssets', start: 110, end: 164 },
  { file: 'assetsController.js', fn: 'createAsset', start: 165, end: 195 },
  { file: 'assetsController.js', fn: 'updateAsset', start: 196, end: 247 },
  { file: 'assetsController.js', fn: 'deleteAsset', start: 248, end: 278 },
  { file: 'assetsController.js', fn: 'getAssetDetail', start: 279, end: 306 },
  { file: 'historyController.js', fn: 'getHistory', start: 307, end: 346 },
  { file: 'historyController.js', fn: 'addHistory', start: 347, end: 359 },
  { file: 'settingsController.js', fn: 'getCategories', start: 360, end: 376 },
  { file: 'settingsController.js', fn: 'putCategories', start: 377, end: 394 },
  { file: 'settingsController.js', fn: 'getLocations', start: 395, end: 411 },
  { file: 'settingsController.js', fn: 'putLocations', start: 412, end: 429 },
  { file: 'statsController.js', fn: 'getCategoryCounts', start: 430, end: 465 },
  { file: 'bulkController.js', fn: 'bulkUpsertAssets', start: 466, end: 491 },
  { file: 'templateController.js', fn: 'getTemplate', start: 492, end: 520 },
];

const byFile = new Map();
for (const seg of segments) {
  const raw = slice(seg.start, seg.end);
  const body = stripRouter(raw, seg.fn);
  if (!byFile.has(seg.file)) byFile.set(seg.file, { bodies: [], fns: [] });
  byFile.get(seg.file).bodies.push(body);
  byFile.get(seg.file).fns.push(seg.fn);
}

for (const [file, { bodies, fns }] of byFile) {
  const out =
    sharedHeader +
    bodies.join('\n') +
    '\nmodule.exports = {\n' +
    fns.map((f) => `  ${f},`).join('\n') +
    '\n};\n';
  fs.writeFileSync(path.join(controllersDir, file), out);
}

// Route modules
const routesDir = path.join(ROOT, 'routes');
function w(name, content) {
  fs.writeFileSync(path.join(routesDir, name), content);
}

w(
  'assets.routes.js',
  `const express = require('express');\nconst router = express.Router();\nconst c = require('../controllers/assetsController');\n\nrouter.get('/assets', c.getAssets);\nrouter.post('/assets', c.createAsset);\nrouter.put('/assets', c.updateAsset);\nrouter.delete('/assets', c.deleteAsset);\nrouter.get('/assets/:assetId', c.getAssetDetail);\n\nmodule.exports = router;\n`
);
w(
  'history.routes.js',
  `const express = require('express');\nconst router = express.Router();\nconst c = require('../controllers/historyController');\n\nrouter.get('/history', c.getHistory);\nrouter.post('/history', c.addHistory);\n\nmodule.exports = router;\n`
);
w(
  'settings.routes.js',
  `const express = require('express');\nconst router = express.Router();\nconst c = require('../controllers/settingsController');\n\nrouter.get('/settings/categories', c.getCategories);\nrouter.put('/settings/categories', c.putCategories);\nrouter.get('/settings/locations', c.getLocations);\nrouter.put('/settings/locations', c.putLocations);\n\nmodule.exports = router;\n`
);
w(
  'stats.routes.js',
  `const express = require('express');\nconst router = express.Router();\nconst c = require('../controllers/statsController');\n\nrouter.get('/category-counts', c.getCategoryCounts);\n\nmodule.exports = router;\n`
);
w(
  'bulk.routes.js',
  `const express = require('express');\nconst router = express.Router();\nconst c = require('../controllers/bulkController');\n\nrouter.post('/assets/bulk', c.bulkUpsertAssets);\n\nmodule.exports = router;\n`
);
w(
  'template.routes.js',
  `const express = require('express');\nconst router = express.Router();\nconst c = require('../controllers/templateController');\n\nrouter.get('/template', c.getTemplate);\n\nmodule.exports = router;\n`
);

// New index.js
const indexNew =
  `const express = require('express');\n` +
  `const router = express.Router();\n\n` +
  `router.use(require('./assets.routes'));\n` +
  `router.use(require('./history.routes'));\n` +
  `router.use(require('./settings.routes'));\n` +
  `router.use(require('./stats.routes'));\n` +
  `router.use(require('./bulk.routes'));\n` +
  `router.use(require('./template.routes'));\n\n` +
  `module.exports = router;\n`;

if (!fs.existsSync(LEGACY_FILE)) {
  fs.writeFileSync(LEGACY_FILE, src);
}
fs.writeFileSync(ROUTES_FILE, indexNew);

console.log('Split assets routes into controllers + route modules.');

