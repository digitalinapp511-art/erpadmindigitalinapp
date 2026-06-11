const path = require('path');
const root = path.join(__dirname, '../..');
const { loadRootEnv, bootstrapMongo } = require(path.join(root, 'lib/bootstrapMongo'));
const { createServiceApp, attachErrorHandler } = require(path.join(root, 'lib/createServiceApp'));

loadRootEnv(root);
if (process.env.HRMS_SERVICE_PORT) {
  process.env.BACKEND_PORT = String(parseInt(process.env.HRMS_SERVICE_PORT, 10));
}
const { networkConfig, getBackendUrl } = require(path.join(root, 'config/network.config'));
const { getMongoUri } = require(path.join(root, 'config/app.config'));

const hrmsAdminRoutes = require(path.join(root, 'portals/hrms-admin/app'));
const hrmsRoutes = require(path.join(root, 'portals/hrms/app'));

const app = createServiceApp();
const port = parseInt(process.env.HRMS_SERVICE_PORT || process.env.BACKEND_PORT, 10);

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
    service: 'hrms',
    status: 'OK',
    database: { connected: mongoStatus, error: mongoError, uri: getMongoUri() },
  });
});

app.use('/api/hrms', hrmsAdminRoutes);
app.use('/api/hrms', hrmsRoutes);
app.use('/api/hrms-portal', hrmsAdminRoutes);
app.use('/api/hrms-portal', hrmsRoutes);
attachErrorHandler(app);

(async () => {
  await bootstrapMongo({ root });
  app.listen(port, '0.0.0.0', () => {
    console.log(`HRMS service → ${getBackendUrl()} (port ${port})`);
    console.log(`   IP: ${networkConfig.serverIp}`);
  });
})();
