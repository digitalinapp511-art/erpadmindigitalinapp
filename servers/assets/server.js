const path = require('path');
const root = path.join(__dirname, '../..');
const { loadRootEnv, bootstrapMongo } = require(path.join(root, 'lib/bootstrapMongo'));
const { createServiceApp, attachErrorHandler } = require(path.join(root, 'lib/createServiceApp'));

loadRootEnv(root);
if (process.env.ASSET_SERVICE_PORT) {
  process.env.BACKEND_PORT = String(parseInt(process.env.ASSET_SERVICE_PORT, 10));
}
const { networkConfig, getBackendUrl } = require(path.join(root, 'config/network.config'));
const { getMongoUri } = require(path.join(root, 'config/app.config'));

const assetRoutes = require(path.join(root, 'portals/assets/app'));

const app = createServiceApp();
const port = parseInt(process.env.ASSET_SERVICE_PORT || process.env.BACKEND_PORT, 10);

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
    service: 'asset-tracker',
    status: 'OK',
    database: { connected: mongoStatus, error: mongoError, uri: getMongoUri() },
  });
});

app.use('/api/asset-tracker', assetRoutes);
attachErrorHandler(app);

(async () => {
  await bootstrapMongo({ root });
  app.listen(port, '0.0.0.0', () => {
    console.log(`Asset Tracker service → ${getBackendUrl()} (port ${port})`);
    console.log(`   IP: ${networkConfig.serverIp}`);
  });
})();
