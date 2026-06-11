const XLSX = require('xlsx');
const { connectMongo } = require('../../../config/mongo');
const { getCompanyDatabaseName, getDatabaseName, getCollectionName } = require('../../../config/database.config');

/** Wrong slug used earlier (full "Ecosoul Home" → ecosoul_home_*); read that DB if canonical DB is empty */
function getLegacyMistakenEcosoulAssetDbName() {
  const base = getDatabaseName('assetTracker');
  return `ecosoul_home_${base}`;
}

async function fetchAssetsFromDbName(dbName, baseQuery) {
  const db = await connectMongo(dbName);
  const col = db.collection(getCollectionName('assets'));
  const q = Object.keys(baseQuery).length ? baseQuery : {};
  return col.find(q).sort({ createdAt: -1 }).toArray();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getAssetDb(company = null) {
  const dbName = company ? getCompanyDatabaseName('assetTracker', company) : getDatabaseName('assetTracker');
  return connectMongo(dbName);
}

async function getCollection(collectionKey, company = null) {
  const db = await getAssetDb(company);
  return db.collection(getCollectionName(collectionKey));
}

function buildCompanyFilter(companyName) {
  if (!companyName) return {};
  const normalized = companyName.trim().toLowerCase();
  if (normalized.includes('thrive')) {
    return { $or: [{ company: { $regex: /thrive/i } }, { company: { $regex: /thrivebrands/i } }] };
  }
  if (normalized.includes('ecosoul') || normalized.includes('eco soul')) {
    return { $or: [{ company: { $regex: /ecosoul/i } }, { company: { $regex: /eco\s*soul/i } }] };
  }
  const escaped = escapeRegex(companyName);
  const flexibleSpacing = escaped.replace(/\s+/g, '\\s*');
  return {
    $or: [
      { company: companyName },
      { company: { $regex: new RegExp(`^${flexibleSpacing}$`, 'i') } },
      { company: { $regex: new RegExp(flexibleSpacing, 'i') } },
    ],
  };
}

async function logAssetHistory(entry, company = null) {
  try {
    const historyCollection = await getCollection('asset_history', company);
    await historyCollection.insertOne({ ...entry, createdAt: new Date().toISOString() });
  } catch (err) {
    console.error('[asset-tracker] history write failed:', err.message);
  }
}

function defaultCategories() {
  return [
    {
      id: '1',
      name: 'Computer Assets',
      prefix: 'CA',
      subcategories: [
        { id: '1-1', name: 'Laptop', prefix: 'LAP', tagPrefix: 'CA-LAP' },
        { id: '1-2', name: 'Desktop', prefix: 'DESK', tagPrefix: 'CA-DESK' },
        { id: '1-3', name: 'Server', prefix: 'SRV', tagPrefix: 'CA-SRV' },
      ],
    },
    {
      id: '2',
      name: 'External Equipment',
      prefix: 'EE',
      subcategories: [
        { id: '2-1', name: 'Keyboard', prefix: 'KBD', tagPrefix: 'EE-KBD' },
        { id: '2-2', name: 'Mouse', prefix: 'MSE', tagPrefix: 'EE-MSE' },
        { id: '2-3', name: 'Charger', prefix: 'CHG', tagPrefix: 'EE-CHG' },
        { id: '2-4', name: 'LCD Monitor', prefix: 'LCD', tagPrefix: 'EE-LCD' },
        { id: '2-5', name: 'Bag', prefix: 'BAG', tagPrefix: 'EE-BAG' },
      ],
    },
    {
      id: '3',
      name: 'Office Supplies',
      prefix: 'OS',
      subcategories: [
        { id: '3-1', name: 'Printer', prefix: 'PRT', tagPrefix: 'OS-PRT' },
        { id: '3-2', name: 'Scanner', prefix: 'SCN', tagPrefix: 'OS-SCN' },
      ],
    },
  ];
}

function defaultLocations() {
  return [
    { id: '1', name: 'Head Office', type: 'Site', address: '', country: '', parentSite: '' },
    { id: '2', name: 'Branch Office', type: 'Site', address: '', country: '', parentSite: '' },
    { id: '3', name: 'Warehouse', type: 'Site', address: '', country: '', parentSite: '' },
    { id: '4', name: 'Floor 1', type: 'Location', address: '', country: '', parentSite: 'Head Office' },
    { id: '5', name: 'Floor 2', type: 'Location', address: '', country: '', parentSite: 'Head Office' },
    { id: '6', name: 'Floor 3', type: 'Location', address: '', country: '', parentSite: 'Head Office' },
  ];
}

async function getTemplate(_req, res) {
  const TEMPLATE_COLUMNS = [
    'category', 'subcategory', 'site', 'location', 'brand', 'model', 'serialNumber',
    'assetTag', 'status', 'company', 'description', 'processor', 'processorGeneration',
    'totalRAM', 'ram1Size', 'ram2Size', 'warrantyStart', 'warrantyMonths', 'warrantyExpire',
    'assignedTo', 'department', 'notes',
  ];
  const rows = [
    TEMPLATE_COLUMNS,
    [
      'Computer Assets', 'Laptop', 'Head Office', 'India', 'Dell', 'Latitude 5520', 'DL123456789',
      '', 'available', 'Thrive', 'Developer laptop', 'Intel Core i7', '11th Gen',
      '16GB', '8GB', '8GB', '2025-01-15', '36', '2028-01-15', '', 'IT Department', 'Optional notes',
    ],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Assets');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="asset-upload-template.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(buf);
}

module.exports = {
  getTemplate,
};
