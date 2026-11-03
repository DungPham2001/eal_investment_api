/**
 * Field helpers: every helper takes the label the app shows (used in Vietnamese error messages and history)
 * and stores a few extra options on the schema path that the engine reads back:
 *   label, ftype (string|text|int|number|money|pct|rating|date|enum|ref|url|email|phone|json),
 *   to + onDelete (ref), computed (server-set, never accepted from the client), contact, guard.
 * Optional values default to null; an empty string from the app is stored as null (spec 0: return null, never "").
 */
const { randomUUID } = require('crypto');
const { isDate } = require('../lib/dates');

const REQUIRED = [true, 'Required'];

const clean = (v) => {
  if (typeof v !== 'string') return v;
  const s = v.normalize('NFC').trim();
  return s === '' ? null : s;
};
const toNumber = (v) => {
  const c = clean(v);
  return typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c;
};
const round2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

function base(label, ftype, type, builtIn, o = {}) {
  const { required, validate, ...rest } = o;
  return {
    type,
    label,
    ftype,
    default: null,
    set: clean,
    ...(required ? { required: REQUIRED } : {}),
    validate: [...builtIn, ...(validate ? [].concat(validate) : [])],
    ...rest,
  };
}

const rule = (validator, message) => ({ validator: (v) => v == null || validator(v), message });

const str = (label, o) => base(label, 'string', String, [rule((v) => v.length <= 300, 'Max 300 characters')], o);
const text = (label, o) => base(label, 'text', String, [rule((v) => v.length <= 5000, 'Max 5000 characters')], o);
/** Machine data stored verbatim (scenarios.values is a JSON string): not parsed, not run through the Guard. */
const json = (label, o) => base(label, 'json', String, [rule((v) => v.length <= 20000, 'Max 20000 characters')], { guard: false, ...o });

const date = (label, o) => base(label, 'date', String, [rule(isDate, 'Invalid date (format YYYY-MM-DD)')], o);

function en(label, values, o) {
  return base(label, 'enum', String, [rule((v) => values.includes(v), `Invalid value. Choose one of: ${values.join(' / ')}`)], { values, ...o });
}

function numeric(label, ftype, { min, max, integer = false, ...o } = {}) {
  const checks = [rule((v) => Number.isFinite(v), 'Must be a number')];
  if (integer) checks.push(rule(Number.isInteger, 'Must be a whole number'));
  if (min !== undefined && max !== undefined) checks.push(rule((v) => v >= min && v <= max, `Must be between ${min} and ${max}`));
  else if (min === 0) checks.push(rule((v) => v >= 0, 'Cannot be negative'));
  else if (min !== undefined) checks.push(rule((v) => v >= min, `Minimum ${min}`));
  return base(label, ftype, Number, checks, { set: ftype === 'money' ? (v) => round2(toNumber(v)) : toNumber, ...o });
}

const int = (label, o = {}) => numeric(label, 'int', { integer: true, ...o });
const num = (label, o = {}) => numeric(label, 'number', { min: 0, ...o });
/** USD, at most 2 decimals (rounded). `signed: true` allows negative amounts (NOI). */
const money = (label, { signed = false, ...o } = {}) => numeric(label, 'money', signed ? o : { min: 0, ...o });
const pct = (label, o = {}) => numeric(label, 'pct', { min: 0, max: 100, ...o });
const rating = (label, o = {}) => numeric(label, 'rating', { min: 1, max: 5, integer: true, ...o });

/** Foreign key to `to` (module name). onDelete: cascade (delete with the parent) | unlink (set null) | keep. */
const ref = (label, to, { onDelete = 'unlink', ...o } = {}) =>
  base(label, 'ref', String, [rule((v) => v.length <= 64, 'Invalid link id')], { to, onDelete, index: true, ...o });

const url = (label, o) => base(label, 'url', String, [rule((v) => v.length <= 2048 && /^https?:\/\/\S+$/i.test(v), 'Must start with http:// or https://')], o);
/** Company contact only: may contain an email / phone, the Guard still refuses SSN and card numbers. */
const email = (label, o) => base(label, 'email', String, [rule((v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email address')], { contact: true, lowercase: true, ...o });
const phone = (label, o) => base(label, 'phone', String, [rule((v) => /^\+?[\d\s().-]{7,25}$/.test(v), 'Invalid phone number')], { contact: true, ...o });

/** Server-computed value: returned, never accepted from the client. */
const computed = (def) => ({ ...def, computed: true });

const newId = () => randomUUID();

module.exports = { str, text, json, date, en, int, num, money, pct, rating, ref, url, email, phone, computed, newId, clean };
