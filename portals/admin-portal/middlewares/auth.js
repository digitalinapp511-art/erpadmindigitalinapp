const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing auth token' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    req.auth = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

function requireSuperAdmin(req, res, next) {
  const role = req.auth?.role;
  if (role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Superadmin access required' });
  }
  return next();
}

module.exports = { requireAuth, requireSuperAdmin };

