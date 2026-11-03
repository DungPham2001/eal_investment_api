const crypto = require('crypto');
const config = require('../config');
const { AppError } = require('../utils/AppError');

const equal = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const bearer = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];

/** When API_KEY is set every /v1 call needs `Authorization: Bearer <API_KEY>` (or `X-Api-Key`). */
function apiKey(req, _res, next) {
  if (!config.apiKey) return next();
  const key = bearer(req) || req.headers['x-api-key'];
  if (key && equal(key, config.apiKey)) return next();
  return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid API key.'));
}

/** Content / period-close endpoints: X-Admin-Key must match ADMIN_KEY; disabled when ADMIN_KEY is empty. */
function adminOnly(req, _res, next) {
  if (!config.adminKey) return next(new AppError(403, 'ADMIN_DISABLED', 'Admin features are not enabled on the server (ADMIN_KEY).'));
  const key = req.headers['x-admin-key'];
  if (key && equal(key, config.adminKey)) return next();
  return next(new AppError(403, 'FORBIDDEN', 'You are not allowed to perform this action.'));
}

/** Daily job: Vercel Cron (Bearer CRON_SECRET) or an admin. Open only when neither secret is configured. */
function cronOrAdmin(req, _res, next) {
  if (!config.cronSecret && !config.adminKey) return next();
  const b = bearer(req);
  if (config.cronSecret && b && equal(b, config.cronSecret)) return next();
  const k = req.headers['x-admin-key'];
  if (config.adminKey && k && equal(k, config.adminKey)) return next();
  return next(new AppError(403, 'FORBIDDEN', 'You are not allowed to perform this action.'));
}

module.exports = { apiKey, adminOnly, cronOrAdmin };
