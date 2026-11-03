/**
 * Same rules as the app's Guard (spec 0.3), re-checked on the server. Applied to every free-text field.
 * Company contact fields (vendors/partners phone & email) may hold an email / phone, but SSN and card numbers are still refused.
 */
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const LONG_DIGITS = /\d{9,}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(?<![\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;

const MSG = {
  ssn: 'Contains what looks like a Social Security number — not allowed.',
  card: 'Contains what looks like a payment card number — not allowed.',
  account: 'Contains a long number that looks like an account number — not allowed.',
  email: 'This field does not accept email addresses.',
  phone: 'This field does not accept phone numbers.',
};

const luhn = (digits) => {
  let total = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
    alt = !alt;
  }
  return total % 10 === 0;
};

/** Returns the Vietnamese message for the first rule `text` breaks, or null. */
function check(text, { contact = false } = {}) {
  if (typeof text !== 'string' || !text) return null;
  if (SSN.test(text)) return MSG.ssn;
  for (const m of text.match(CARD) || []) {
    const d = m.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return MSG.card;
  }
  if (contact) return null;
  if (LONG_DIGITS.test(text)) return MSG.account;
  if (EMAIL.test(text)) return MSG.email;
  if (PHONE.test(text)) return MSG.phone;
  return null;
}

const TEXT_TYPES = new Set(['string', 'text', 'url', 'email', 'phone']);

/** { field: message } for every free-text field of `cfg` in `body` that breaks a rule. */
function scan(cfg, body) {
  const out = {};
  for (const f of cfg.fields) {
    if (!TEXT_TYPES.has(f.ftype) || !f.guard) continue;
    const why = check(body[f.name], { contact: f.contact });
    if (why) out[f.name] = why;
  }
  return out;
}

/** Same check over plain named values (content reports...). */
function scanValues(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const why = check(v);
    if (why) out[k] = why;
  }
  return out;
}

module.exports = { check, scan, scanValues, MSG };
