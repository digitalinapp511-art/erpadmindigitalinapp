/**
 * Reversible encryption for annual CTC at rest in MongoDB.
 * Passwords use bcrypt (one-way); CTC must be decryptable for payroll and HR UI.
 *
 * Stored format: "ctc1:" + base64(iv || ciphertext || gcmTag)
 * Legacy plain numbers in DB are still read via decryptAnnualCtcStored.
 */
const crypto = require('crypto');

const PREFIX = 'ctc1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function encryptionKeyBuffer() {
  const raw =
    process.env.CTC_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'your-secret-key-change-in-production';
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

/**
 * @param {unknown} value — rupees (number from API); null/empty skips
 * @returns {string|null} ciphertext string for DB, or null
 */
function encryptAnnualCtcForStorage(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;

  const key = encryptionKeyBuffer();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify({ n }), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, enc, tag]);
  return PREFIX + payload.toString('base64');
}

/**
 * @param {unknown} stored — encrypted string, legacy number, or numeric string
 * @returns {number|null}
 */
function decryptAnnualCtcStored(stored) {
  if (stored === null || stored === undefined || stored === '') return null;

  if (typeof stored === 'number') {
    return Number.isFinite(stored) && stored >= 0 ? stored : null;
  }

  const s = String(stored).trim();
  if (!s.startsWith(PREFIX)) {
    const legacy = Number(s);
    return Number.isFinite(legacy) && legacy >= 0 ? legacy : null;
  }

  try {
    const key = encryptionKeyBuffer();
    const buf = Buffer.from(s.slice(PREFIX.length), 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(enc), decipher.final()]);
    const obj = JSON.parse(pt.toString('utf8'));
    const n = Number(obj && obj.n);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

module.exports = {
  encryptAnnualCtcForStorage,
  decryptAnnualCtcStored,
};
