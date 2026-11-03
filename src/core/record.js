/**
 * create / update / delete for any registered module. Every function takes an optional Mongo `session`
 * so actions (renew, bulk delete, generate rents) compose several of them in ONE transaction.
 *
 * Pipeline: pick writable fields -> schema validation -> foreign keys exist -> cfg.prepare (server rules of spec 4)
 * -> validation again -> cfg.validate (cross-field rules) -> closed-period lock -> save + history.
 */
const { AppError, notFound } = require('../utils/AppError');
const { serialize } = require('./serialize');
const { diff, logHistory } = require('./history');
const cascade = require('./cascade');
const registry = require('./registry');
const { closedBefore } = require('../services/settings');

const NUMERIC = new Set(['int', 'number', 'money', 'pct', 'rating']);

const pick = (names, body) => Object.fromEntries(names.filter((n) => body[n] !== undefined).map((n) => [n, body[n]]));

async function validateDoc(cfg, doc) {
  try {
    await doc.validate();
  } catch (err) {
    if (err.name !== 'ValidationError') throw err;
    const fields = {};
    for (const e of Object.values(err.errors)) {
      const path = e.path.split('.')[0];
      fields[path] = e.name === 'CastError' ? (NUMERIC.has(cfg.fieldMap[path]?.ftype) ? 'Must be a number' : 'Invalid value') : e.message;
    }
    throw cfg.fail(fields);
  }
}

/** Foreign keys named in `names` must point at an existing record (spec 0.2: sai -> 422). */
async function checkRefs(cfg, doc, names, session) {
  const errors = {};
  for (const f of cfg.refs) {
    if (f.computed || !names.includes(f.name) || doc[f.name] == null) continue;
    const target = registry.get(f.to);
    if (!(await target.Model.exists({ _id: doc[f.name] }).session(session))) errors[f.name] = `The selected ${target.noun} was not found.`;
  }
  if (Object.keys(errors).length) throw cfg.fail(errors);
}

const LOCK_MSG = {
  create: 'This period is closed; new records cannot be added.',
  update: 'This period is closed and cannot be edited or deleted.',
};

function lockCheck(cfg, value, cutoff, op) {
  if (cutoff && value && value < cutoff) throw new AppError(423, 'PERIOD_LOCKED', LOCK_MSG[op] || LOCK_MSG.update, { closedBefore: cutoff });
}

const lockCutoff = (cfg, session) => (cfg.periodLocked ? closedBefore(session) : null);

/** Business fields (incl. computed) as plain JSON, for diffs. */
const snapshot = (cfg, doc) => JSON.parse(JSON.stringify(Object.fromEntries(cfg.fieldNames.map((n) => [n, doc.get(n) ?? null]))));

async function createRecord(cfg, body, ctx, { session = null } = {}) {
  const fields = pick(cfg.writable, body);
  const doc = new cfg.Model(fields);
  await validateDoc(cfg, doc);
  await checkRefs(cfg, doc, cfg.writable, session);
  if (cfg.prepare) await cfg.prepare({ doc, isNew: true, before: null, session, ctx });
  await validateDoc(cfg, doc);
  if (cfg.validate) await cfg.validate({ doc, isNew: true, before: null, session });
  lockCheck(cfg, doc[cfg.dateKey], await lockCutoff(cfg, session), 'create');
  doc.createdBy = ctx.by;
  await doc.save({ session });
  await logHistory(cfg, { action: 'create', doc, ctx, session });
  return doc;
}

const conflictError = (cfg, doc) =>
  new AppError(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Review the latest version and try again.', { current: serialize(cfg, doc) });

/**
 * PATCH semantics: only fields present in `body` change. version / updatedAt move only when a value really changed.
 * options: expectVersion (number|null), action ('update' | 'restore'), system (skip the period lock: time-driven jobs).
 * Returns { doc, changed, changes }.
 */
async function updateRecord(cfg, id, body, ctx, { session = null, expectVersion = null, action = 'update', system = false } = {}) {
  const doc = await cfg.Model.findById(id).session(session);
  if (!doc) throw notFound(cfg.noun);
  if (expectVersion !== null && doc.version !== expectVersion) throw conflictError(cfg, doc);
  const cutoff = system ? null : await lockCutoff(cfg, session);
  lockCheck(cfg, doc[cfg.dateKey], cutoff, 'update');

  const before = snapshot(cfg, doc);
  const fields = pick(cfg.writable, body);
  doc.set(fields);
  await validateDoc(cfg, doc);
  await checkRefs(cfg, doc, Object.keys(fields), session);
  if (cfg.prepare) await cfg.prepare({ doc, isNew: false, before, session, ctx });
  await validateDoc(cfg, doc);
  if (cfg.validate) await cfg.validate({ doc, isNew: false, before, session });
  lockCheck(cfg, doc[cfg.dateKey], cutoff, 'update'); // cannot move a record into a closed period either

  const after = snapshot(cfg, doc);
  const changes = diff(before, after);
  if (!Object.keys(changes).length) return { doc, changed: false, changes };

  const $set = Object.fromEntries(Object.keys(changes).map((k) => [k, after[k]]));
  const saved = await cfg.Model.findOneAndUpdate({ _id: id, version: doc.version }, { $set, $inc: { version: 1 } }, { new: true, session });
  if (!saved) throw conflictError(cfg, await cfg.Model.findById(id).session(session));
  await logHistory(cfg, { action, doc: saved, changes, ctx, session });
  return { doc: saved, changed: true, changes };
}

/** Loads `ids` and refuses (423) if any of them is in a closed period. Missing ids are returned separately. */
async function loadForDelete(cfg, ids, session) {
  const docs = await cfg.Model.find({ _id: { $in: ids } }).session(session);
  const cutoff = await lockCutoff(cfg, session);
  for (const d of docs) lockCheck(cfg, d[cfg.dateKey], cutoff, 'delete');
  const found = new Set(docs.map((d) => d._id));
  return { docs, missing: ids.filter((id) => !found.has(id)) };
}

/**
 * Deletes root records + cascade. History: every row of the removed records goes, then ONE `delete` row per root
 * (label = the record type, e.g. "property", spec 5).
 */
async function deleteRecords(cfg, ids, ctx, { session = null } = {}) {
  const { docs, missing } = await loadForDelete(cfg, ids, session);
  if (!docs.length) return { deleted: 0, missing };
  const p = await cascade.plan(cfg.name, docs.map((d) => d._id), session);
  await cascade.execute(p, session);
  for (const doc of docs) await logHistory(cfg, { action: 'delete', doc, ctx, session, label: cfg.noun });
  const cascaded = [...p.removed.values()].reduce((a, s) => a + s.size, 0);
  return { deleted: docs.length, cascaded, unlinked: p.unlinked.length, missing };
}

async function deleteRecord(cfg, id, ctx, opts = {}) {
  const r = await deleteRecords(cfg, [id], ctx, opts);
  if (!r.deleted) throw notFound(cfg.noun);
  return r;
}

module.exports = { createRecord, updateRecord, deleteRecord, deleteRecords, snapshot, pick, validateDoc };
