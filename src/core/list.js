/**
 * GET /v1/{module} (spec 2.2):
 *   q            search the label field (+ unit code for leases / rents)
 *   {field}=a,b  equality on any field ("null" = no value), several values = any of them
 *   {date}From / {date}To   range on a date field (main date key or any other)
 *   sort=-rent,code         "-" = descending. Default: main date key desc, else createdAt desc
 *   limit, cursor           -> { items, nextCursor, total } (limit default 50, no maximum)
 *   all=true                everything, no cap (phase 1: the app computes dashboards on the client)
 *   expand=property,unit    adds <field>Name (and unitCode) next to the ids
 */
const registry = require('./registry');
const { serialize } = require('./serialize');
const { labelsByIds } = require('./labels');
const { invalid } = require('../utils/AppError');
const { escapeRegex } = require('../lib/util');
const { isDate } = require('../lib/dates');

const RESERVED = new Set(['q', 'sort', 'limit', 'cursor', 'all', 'expand']);
const NUMERIC = new Set(['int', 'number', 'money', 'pct', 'rating']);
const SYSTEM_SORT = new Set(['createdAt', 'updatedAt', 'version']);

const encodeCursor = (offset) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
function decodeCursor(raw) {
  if (!raw) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (Number.isInteger(o) && o >= 0) return o;
  } catch { /* fall through */ }
  throw invalid({ cursor: 'Invalid cursor. Reload the list from the start.' });
}

function one(query, key) {
  const v = query[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw invalid({ [key]: 'Only a single text value is accepted.' });
  return v;
}

function castValue(cfg, f, raw) {
  if (raw === 'null' || raw === '') return null;
  if (NUMERIC.has(f.ftype)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw cfg.fail({ [f.name]: 'Must be a number' });
    return n;
  }
  return raw.normalize('NFC');
}

async function buildFilter(cfg, query) {
  const and = [];
  const q = one(query, 'q')?.trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q.normalize('NFC').slice(0, 80)), 'i');
    const or = cfg.search.map((p) => ({ [p]: rx }));
    for (const field of cfg.searchRefs) {
      const target = registry.get(cfg.fieldMap[field].to);
      const ids = await target.Model.find({ [target.labelField]: rx }, '_id').limit(1000).lean();
      if (ids.length) or.push({ [field]: { $in: ids.map((r) => r._id) } });
    }
    and.push(or.length ? { $or: or } : { _id: null });
  }

  for (const key of Object.keys(query)) {
    if (RESERVED.has(key)) continue;
    const raw = one(query, key);
    const range = /^(.+)(From|To)$/.exec(key);
    if (range && cfg.fieldMap[range[1]]?.ftype === 'date') {
      if (!isDate(raw)) throw invalid({ [key]: 'Invalid date (format YYYY-MM-DD)' });
      and.push({ [range[1]]: range[2] === 'From' ? { $gte: raw } : { $lte: raw } });
      continue;
    }
    const f = cfg.fieldMap[key];
    if (!f) continue; // unknown keys are ignored
    const values = raw.split(',').map((s) => castValue(cfg, f, s.trim()));
    and.push({ [key]: values.length > 1 ? { $in: values } : values[0] });
  }
  return and.length ? { $and: and } : {};
}

function buildSort(cfg, raw) {
  if (!raw) return cfg.dateKey ? { [cfg.dateKey]: -1, createdAt: -1, _id: 1 } : { createdAt: -1, _id: 1 };
  const sort = {};
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const desc = part.startsWith('-');
    const key = desc ? part.slice(1) : part;
    if (!cfg.fieldMap[key] && !SYSTEM_SORT.has(key)) {
      throw invalid({ sort: `Cannot sort by "${key}". Use one of: ${[...cfg.sort, cfg.dateKey, 'createdAt'].filter(Boolean).join(', ')}.` });
    }
    sort[key] = desc ? -1 : 1;
  }
  if (!sort.createdAt) sort.createdAt = -1;
  sort._id = 1;
  return sort;
}

/** Adds `<field>Name` (+ `unitCode`) for the requested ref fields. */
async function expand(cfg, items, raw) {
  const fields = String(raw || '').split(',').map((s) => s.trim()).filter((f) => cfg.fieldMap[f]?.to);
  for (const field of fields) {
    const labels = await labelsByIds(cfg.fieldMap[field].to, items.map((i) => i[field]));
    for (const i of items) {
      const label = i[field] ? labels.get(i[field]) ?? null : null;
      i[`${field}Name`] = label;
      if (field === 'unit') i.unitCode = label;
    }
  }
  return items;
}

async function list(cfg, query) {
  if (cfg.beforeList) await cfg.beforeList();
  const filter = await buildFilter(cfg, query);
  const sort = buildSort(cfg, one(query, 'sort'));
  const all = one(query, 'all') === 'true';
  const limit = all ? 0 : Math.max(1, parseInt(one(query, 'limit'), 10) || 50); // 0 = no limit
  const offset = all ? 0 : decodeCursor(one(query, 'cursor'));

  const [rows, total] = await Promise.all([
    cfg.Model.find(filter).sort(sort).skip(offset).limit(limit).lean(),
    cfg.Model.countDocuments(filter),
  ]);
  const items = await expand(cfg, rows.map((r) => serialize(cfg, r)), one(query, 'expand'));
  const next = offset + rows.length;
  return { items, nextCursor: !all && next < total && rows.length === limit ? encodeCursor(next) : null, total };
}

module.exports = { list, expand, buildFilter };
