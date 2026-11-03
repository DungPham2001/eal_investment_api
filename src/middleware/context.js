/**
 * The app has no login and sends no identity, and nothing is rate limited. `ctx.actor` (client IP) only scopes Idempotency-Key.
 * X-Display-Name is optional: the name the user typed in Settings, written to createdBy / history.by ("Anonymous" when absent).
 * Non-ASCII names may be sent percent-encoded (encodeURIComponent) or as raw UTF-8.
 */
const { check } = require('../lib/guard');

function displayName(raw) {
  if (typeof raw !== 'string') return 'Anonymous';
  let s = raw;
  if (/[^\x00-\x7f]/.test(s)) s = Buffer.from(s, 'latin1').toString('utf8');
  if (s.includes('%')) {
    try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  }
  s = s.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s && !check(s) ? s : 'Anonymous';
}

function context(req, _res, next) {
  req.ctx = { actor: `ip:${req.ip}`, by: displayName(req.headers['x-display-name']) };
  next();
}

module.exports = { context, displayName };
