/**
 * admin-auth.js — Admin authentication middleware.
 *
 * Admin credentials come from env:
 *   ADMIN_USERNAME (default: ASY404)
 *   ADMIN_PASSWORD (REQUIRED — set in Render env)
 *
 * Two auth modes supported:
 *   1. Session-based (admin panel login via /admin/login → cookie)
 *   2. API token (for programmatic admin calls): /admin/api/* with
 *      header  X-Admin-Auth: base64(user:pass)
 *
 * For simplicity we use a signed session token (HMAC of username + timestamp)
 * stored in a cookie. Valid for 7 days.
 */

const crypto = require('crypto');
const config = require('./config');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'ASY404';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

if (!ADMIN_PASSWORD) {
  console.warn('[admin-auth] WARNING: ADMIN_PASSWORD not set. Admin panel will be locked. Set ADMIN_PASSWORD env var.');
}

/**
 * Create a signed session token: base64(user|exp).hmac
 */
function createSessionToken(username) {
  const exp = Date.now() + SESSION_TTL;
  const payload = `${username}|${exp}`;
  const b64 = Buffer.from(payload).toString('base64');
  const sig = crypto.createHmac('sha256', config.signingSecret || 'fallback-admin-secret')
    .update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', config.signingSecret || 'fallback-admin-secret')
    .update(b64).digest('hex');
  // constant-time compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = Buffer.from(b64, 'base64').toString('utf8');
    const [user, expStr] = payload.split('|');
    const exp = parseInt(expStr, 10);
    if (Date.now() > exp) return null;
    if (user !== ADMIN_USERNAME) return null;
    return { user, exp };
  } catch {
    return null;
  }
}

/**
 * Basic-auth check for API calls (header X-Admin-Auth: base64(user:pass))
 */
function checkBasicAuth(headerValue) {
  if (!headerValue) return false;
  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    return user === ADMIN_USERNAME && pass === ADMIN_PASSWORD && ADMIN_PASSWORD !== '';
  } catch {
    return false;
  }
}

/**
 * Express middleware — protects /admin/* routes (except /admin/login).
 * Accepts either session cookie OR X-Admin-Auth header.
 */
function requireAdmin(req, res, next) {
  // session cookie
  const cookieToken = parseCookie(req.headers.cookie, 'admin_session');
  if (cookieToken) {
    const session = verifySessionToken(cookieToken);
    if (session) {
      req.admin = session;
      return next();
    }
  }
  // header auth
  const headerAuth = req.headers['x-admin-auth'];
  if (checkBasicAuth(headerAuth)) {
    req.admin = { user: ADMIN_USERNAME };
    return next();
  }
  // if API call (json expected) → 401 json
  if (req.path.startsWith('/admin/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ status: 'error', code: 'unauthorized', message: 'Admin auth required' });
  }
  // browser → redirect to login
  return res.redirect('/admin/login');
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

module.exports = {
  ADMIN_USERNAME,
  createSessionToken,
  verifySessionToken,
  checkBasicAuth,
  requireAdmin,
  parseCookie,
};
