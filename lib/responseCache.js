/**
 * Response cache: in-memory LRU + optional Redis (REDIS_URL).
 * Falls back to memory when Redis is unset or unavailable.
 */

const DEFAULT_MAX_ENTRIES = 500;

const memory = new Map();
const memoryOrder = [];

let redisClient = null;
let redisInitAttempted = false;

function pruneMemory() {
  while (memory.size > DEFAULT_MAX_ENTRIES && memoryOrder.length > 0) {
    const old = memoryOrder.shift();
    memory.delete(old);
  }
}

async function initRedis() {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;
  const url = process.env.REDIS_URL && String(process.env.REDIS_URL).trim();
  if (!url) return null;
  try {
    const Redis = require('ioredis');
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 3000,
    });
    await redisClient.connect();
    console.log('[responseCache] Redis connected');
    return redisClient;
  } catch (e) {
    console.warn('[responseCache] Redis unavailable, using in-memory cache:', e.message);
    redisClient = null;
    return null;
  }
}

function memoryGet(key) {
  const row = memory.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return row.value;
}

function memorySet(key, value, ttlMs) {
  if (!memory.has(key)) memoryOrder.push(key);
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  pruneMemory();
}

async function get(key) {
  await initRedis();
  if (redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw);
    } catch {
      // fall through to memory
    }
  }
  return memoryGet(key);
}

async function set(key, value, ttlMs) {
  await initRedis();
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch {
      // ignore
    }
  }
  memorySet(key, value, ttlMs);
}

async function wrap(key, ttlMs, fn) {
  const hit = await get(key);
  if (hit !== null && hit !== undefined) return hit;
  const value = await fn();
  await set(key, value, ttlMs);
  return value;
}

function cacheEnabled() {
  return process.env.DISABLE_RESPONSE_CACHE !== 'true';
}

async function del(key) {
  memory.delete(key);
  const idx = memoryOrder.indexOf(key);
  if (idx >= 0) memoryOrder.splice(idx, 1);
  await initRedis();
  if (redisClient) {
    try {
      await redisClient.del(key);
    } catch {
      // ignore
    }
  }
}

async function invalidatePrefix(prefix) {
  if (!prefix) return;
  for (const key of [...memory.keys()]) {
    if (String(key).startsWith(prefix)) {
      memory.delete(key);
      const idx = memoryOrder.indexOf(key);
      if (idx >= 0) memoryOrder.splice(idx, 1);
    }
  }
  await initRedis();
  if (redisClient) {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redisClient.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) await redisClient.del(...keys);
      } while (cursor !== '0');
    } catch {
      // ignore
    }
  }
}

module.exports = {
  initRedis,
  get,
  set,
  wrap,
  del,
  invalidatePrefix,
  cacheEnabled,
};
