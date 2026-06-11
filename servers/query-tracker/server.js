const path = require('path');
const root = path.join(__dirname, '../..');
const { loadRootEnv, bootstrapMongo } = require(path.join(root, 'lib/bootstrapMongo'));
const { createServiceApp, attachErrorHandler } = require(path.join(root, 'lib/createServiceApp'));

loadRootEnv(root);
const { networkConfig, getBackendUrl } = require(path.join(root, 'config/network.config'));
const { getMongoUri } = require(path.join(root, 'config/app.config'));

const queryTrackerRoutes = require(path.join(root, 'portals/query-tracker/app'));

const app = createServiceApp();
const port = parseInt(process.env.BACKEND_PORT, 10);

app.get('/api/health', async (req, res) => {
  let mongoStatus = false;
  let mongoError = null;
  try {
    const { connectMongo } = require(path.join(root, 'config/mongo'));
    await connectMongo();
    mongoStatus = true;
  } catch (err) {
    mongoError = err.message;
  }
  res.json({
    service: 'query-tracker',
    status: 'OK',
    database: { connected: mongoStatus, error: mongoError, uri: getMongoUri() },
  });
});

app.use('/api/query-tracker', queryTrackerRoutes);
attachErrorHandler(app);

(async () => {
  await bootstrapMongo({ root, mongooseQueryTracker: true });
  app.listen(port, '0.0.0.0', () => {
    console.log(`Query Tracker service → ${getBackendUrl()} (port ${port})`);
    console.log(`   IP: ${networkConfig.serverIp}`);
  });
})();
