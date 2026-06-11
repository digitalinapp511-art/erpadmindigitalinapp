require('dotenv').config();

/**
 * Network / public URL helpers — all from environment (no hardcoded LAN IPs).
 *
 * Live: set BACKEND_BASE_URL (and usually BACKEND_API_URL, FRONTEND_BASE_URL, CORS — see .env.example).
 * Local: omit BACKEND_BASE_URL and use BACKEND_PORT; optional SERVER_IP for phone/LAN testing.
 */

function trimEnv(name) {
  const v = process.env[name];
  if (v == null || !String(v).trim()) return '';
  return String(v).trim();
}

function parseHostFromBaseUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return u.hostname || null;
  } catch {
    return null;
  }
}

function resolvePublicHost() {
  const fromIp = trimEnv('SERVER_IP');
  if (fromIp) return fromIp;
  const fromBackend = parseHostFromBaseUrl(trimEnv('BACKEND_BASE_URL'));
  if (fromBackend) return fromBackend;
  return 'localhost';
}

if (!trimEnv('BACKEND_PORT')) {
  throw new Error('BACKEND_PORT must be set in .env file');
}
const backendPort = parseInt(process.env.BACKEND_PORT, 10);
if (Number.isNaN(backendPort)) {
  throw new Error('BACKEND_PORT must be a valid integer');
}

const networkConfig = {
  serverIp: resolvePublicHost(),
  backendPort,
};

function getBackendUrl() {
  const base = trimEnv('BACKEND_BASE_URL');
  if (base) {
    return base.replace(/\/+$/, '');
  }
  const host = networkConfig.serverIp === 'localhost' ? 'localhost' : networkConfig.serverIp;
  return `http://${host}:${networkConfig.backendPort}`;
}

function getApiUrl() {
  const api = trimEnv('BACKEND_API_URL');
  if (api) {
    return api.replace(/\/+$/, '');
  }
  return `${getBackendUrl()}/api`;
}

module.exports = {
  networkConfig,
  getBackendUrl,
  getApiUrl,
  resolvePublicHost,
  serverIp: networkConfig.serverIp,
  backendPort: networkConfig.backendPort,
};
