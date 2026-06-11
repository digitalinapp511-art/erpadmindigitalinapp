const { getDb, getEmployeePortalDb } = require('../../../config/mongo');

// Helper: ensure a single doc exists per employeeId/type
async function getOrCreateDoc(collectionName, filter, defaultDoc, company = null) {
  const db = company ? await getEmployeePortalDb(company) : await getDb();
  const col = db.collection(collectionName);
  const now = new Date();

  // Atomic upsert to avoid duplicate inserts under concurrency,
  // and reduce calls from (find -> insert -> find) to a single round-trip.
  const result = await col.findOneAndUpdate(
    filter,
    {
      $setOnInsert: { ...filter, ...defaultDoc, createdAt: now, updatedAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return result?.value || (await col.findOne(filter));
}

module.exports = { getOrCreateDoc };
