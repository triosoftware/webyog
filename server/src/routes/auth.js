const express = require('express');
const {
  COOKIE_NAME,
  SESSION_TTL_MS,
  verifyCredentials,
  createAuthToken,
  extractSessionUser,
} = require('../middleware/auth');

const router = express.Router();

// Pelacak sederhana percobaan login gagal per IP (anti brute-force di LAN)
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60 * 1000;

router.get('/me', (req, res) => {
  const user = extractSessionUser(req);
  if (!user) {
    return res.json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: user.username });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const record = failedAttempts.get(ip);

  if (record && record.count >= MAX_ATTEMPTS && Date.now() < record.resetAt) {
    const waitSec = Math.ceil((record.resetAt - Date.now()) / 1000);
    return res.status(429).json({
      error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${waitSec} detik.`,
    });
  }

  const { username, password } = req.body || {};

  if (!verifyCredentials(username, password)) {
    const currentCount = record && Date.now() < record.resetAt ? record.count + 1 : 1;
    failedAttempts.set(ip, {
      count: currentCount,
      resetAt: Date.now() + LOCK_WINDOW_MS,
    });
    await new Promise((r) => setTimeout(r, 400));
    return res.status(401).json({ error: 'Username atau password salah.' });
  }

  failedAttempts.delete(ip);

  const token = createAuthToken(username.trim());
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}`
  );

  return res.json({ success: true, user: username.trim() });
});

router.post('/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
  return res.json({ success: true });
});

module.exports = router;
