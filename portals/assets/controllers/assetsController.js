const XLSX = require('xlsx');
const { connectMongo } = require('../../../config/mongo');
const { getCollectionName } = require('../../../config/database.config');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getAssetDb(company) {
  if (!company) {
    throw new Error('company is required');
  }
  // Company DB lives on company-specific Mongo server
  return connectMongo(company);
}

async function getCollection(collectionKey, company) {
  const db = await getAssetDb(company);
  return db.collection(getCollectionName(collectionKey));
}

// buildCompanyFilter was used for shared-db fallbacks. Company DB is now required.

async function logAssetHistory(entry, company = null) {
  try {
    if (!company) return;
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

async function getAssets(req, res) {
  try {
    const companyId = req.query.companyId;
    const company = String(req.query.company || '').trim();
    const id = req.query.id;

    if (!company) {
      return res.status(400).json({ success: false, error: 'company is required' });
    }
    const collection = await getCollection('assets', company);

    if (id) {
      const deleted = await collection.deleteOne({ id: String(id) });
      if (!deleted.deletedCount) {
        return res.status(404).json({ success: false, error: 'Asset not found' });
      }
      return res.json({ success: true, message: 'Asset deleted successfully' });
    }

    const baseQuery = {};
    if (companyId) baseQuery.companyId = companyId;

    const assets = await collection.find(baseQuery).sort({ createdAt: -1 }).toArray();

    return res.json({ success: true, data: assets, count: assets.length });
  } catch (error) {
    console.error('[asset-tracker] get assets failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch assets' });
  }
}

async function createAsset(req, res) {
  try {
    const body = req.body || {};
    const company = body.company || '';
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const collection = await getCollection('assets', company);
    const asset = {
      ...body,
      status: body.status && String(body.status).trim() ? body.status : 'available',
      company,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await collection.insertOne(asset);
    await logAssetHistory({
      type: 'created',
      action: 'created',
      companyId: asset.companyId,
      company: asset.company,
      assetId: asset.id,
      assetTag: asset.assetTag,
      description: asset.model || asset.category || '',
    }, company || null);

    return res.json({ success: true, data: { ...asset, _id: result.insertedId }, message: 'Asset created successfully' });
  } catch (error) {
    console.error('[asset-tracker] create asset failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create asset' });
  }
}

async function updateAsset(req, res) {
  try {
    const body = req.body || {};
    const id = body.id;
    const updateData = { ...body };
    delete updateData.id;
    const company = updateData.company || body.company || '';

    if (!id) return res.status(400).json({ success: false, error: 'Asset ID is required' });
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });
    const collection = await getCollection('assets', company);
    const prev = await collection.findOne({ id: String(id) });

    const result = await collection.updateOne(
      { id: String(id) },
      { $set: { ...updateData, updatedAt: new Date().toISOString() } }
    );
    if (!result.matchedCount) return res.status(404).json({ success: false, error: 'Asset not found' });

    const prevAssignedTo = prev?.assignedTo || null;
    const nextAssignedTo = updateData.assignedTo ?? prevAssignedTo;
    const prevStatus = (prev?.status || '').toLowerCase();
    const nextStatus = String((updateData.status ?? prevStatus) || '').toLowerCase();

    let type = 'updated';
    let action = 'updated';
    if (!prevAssignedTo && nextAssignedTo) { type = 'checkout'; action = 'checked out'; }
    else if (prevAssignedTo && !nextAssignedTo) { type = 'checkin'; action = 'checked in'; }
    else if (prevAssignedTo && nextAssignedTo && prevAssignedTo !== nextAssignedTo) { type = 'checkout'; action = 're-assigned'; }
    else if (prevStatus !== nextStatus && nextStatus === 'maintenance') { type = 'maintenance'; action = 'moved to maintenance'; }
    else if (prevStatus !== nextStatus && nextStatus === 'broken') { type = 'broken'; action = 'marked broken'; }

    await logAssetHistory({
      type,
      action,
      companyId: updateData.companyId || prev?.companyId,
      company: updateData.company || prev?.company,
      assetId: id,
      assetTag: prev?.assetTag,
      description: prev?.model || prev?.category || '',
      assignedTo: nextAssignedTo,
      assignedFrom: prevAssignedTo,
      status: nextStatus,
      department: updateData.department ?? prev?.department ?? null,
    }, company || prev?.company || null);

    return res.json({ success: true, message: 'Asset updated successfully' });
  } catch (error) {
    console.error('[asset-tracker] update asset failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to update asset' });
  }
}

async function deleteAsset(req, res) {
  try {
    const id = req.query.id;
    const company = req.query.company || '';
    if (!id) return res.status(400).json({ success: false, error: 'Asset ID is required' });
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const collection = await getCollection('assets', company);
    const prev = await collection.findOne({ id: String(id) });
    const result = await collection.deleteOne({ id: String(id) });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Asset not found' });

    await logAssetHistory({
      type: 'deleted',
      action: 'deleted',
      companyId: prev?.companyId,
      company: prev?.company,
      assetId: id,
      assetTag: prev?.assetTag,
      description: prev?.model || prev?.category || '',
      assignedTo: prev?.assignedTo || null,
      status: (prev?.status || '').toLowerCase(),
      department: prev?.department || null,
    }, company || prev?.company || null);

    return res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('[asset-tracker] delete asset failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to delete asset' });
  }
}

async function getAssetDetail(req, res) {
  try {
    const assetId = req.params.assetId;
    const companyId = req.query.companyId;
    const company = req.query.company;
    if (!assetId) return res.status(400).json({ success: false, error: 'Asset ID is required' });
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const collection = await getCollection('assets', company);
    const query = {
      $or: [
        { id: String(assetId) },
        { _id: String(assetId) },
        { assetTag: String(assetId) },
        { assetTag: { $regex: new RegExp(`^${escapeRegex(String(assetId))}$`, 'i') } },
      ],
    };
    if (companyId) query.companyId = companyId;
    if (company) query.company = { $regex: new RegExp(`^${escapeRegex(company)}$`, 'i') };

    const asset = await collection.findOne(query);
    if (!asset) return res.status(404).json({ success: false, error: 'Asset not found' });
    return res.json({ success: true, data: asset });
  } catch (error) {
    console.error('[asset-tracker] get asset detail failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch asset' });
  }
}

module.exports = {
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  getAssetDetail,
};
