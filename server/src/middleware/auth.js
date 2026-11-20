const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Muat file server/.env secara otomatis jika tersedia (tanpa perlu paket dotenv)
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const AUTH_USER = process.env.WEBYOG_USER || 'admin';
const AUTH_PASS = process.env.WEBYOG_PASS || 'webyog123';
const AUTH_SECRET = process.env.WEBYOG_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = Number(process.env.WEBYOG_SESSION_HOURS || 24) * 60 * 60 * 1000;
const COOKIE_NAME = 'webyog_auth';

function safeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function verifyCredentials(username, password) {
  if (!username || !password) return false;
  const userOk = safeCompare(username, AUTH_USER);
  const passOk = safeCompare(password, AUTH_PASS);
  return userOk && passOk;
}

function createAuthToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      exp: Date.now() + SESSION_TTL_MS,
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url');

  if (!safeCompare(signature, expectedSig)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return { username: data.u, exp: data.exp };
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      cookies[k] = decodeURIComponent(v);
    }
  });
  return cookies;
}

function extractSessionUser(req) {
  const cookies = parseCookies(req);
  let token = cookies[COOKIE_NAME];

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  return verifyAuthToken(token);
}

function requireAuth(req, res, next) {
  const user = extractSessionUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.',
      code: 'AUTH_REQUIRED',
    });
  }
  req.authUser = user;
  next();
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  verifyCredentials,
  createAuthToken,
  extractSessionUser,
  requireAuth,
};
