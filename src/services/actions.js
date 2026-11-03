/**
 * "Colon" endpoints of the spec (Google-style custom methods): POST /v1/{module}:bulkDelete, /v1/{module}:bulkCreate,
 * /v1/rents:generateThisMonth, /v1/leases/{id}:renew, /v1/history/{id}:revert, /v1/exports:consume.
 * ":" may arrive raw or percent-encoded (%3A).
 */
const express = require('express');
const registry = require('../core/registry');
const { createRecord, updateRecord, deleteRecords } = require('../core/record');
const { serialize } = require('../core/serialize');
const { withTx } = require('../core/tx');
const { bodyOf, versionOf } = require('../core/resource');
const { History } = require('../models/system');
const { AppError, asyncHandler, notFound, conflict } = require('../utils/AppError');
const { addDays, addMonths, monthStart, today } = require('../lib/dates');
const E = require('../models/enums');

const router = express.Router();
const C = '(?::|%3A)';
const route = (pattern) => new RegExp(`^/${pattern}/?$`, 'i');

const moduleOf = (name) => {
  const cfg = registry.get(name);
  if (!cfg) throw new AppError(404, 'NOT_FOUND', `There is no module "${name}".`);
  return cfg;
};

// ---- bulk delete (spec 2): any number of ids, no rate limit (public app) ----------------------
router.post(route(`([a-z]+)${C}bulkDelete`), asyncHandler(async (req, res) => {
  const cfg = moduleOf(req.params[0]);
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'The list of ids to delete is invalid.', { fields: { ids: 'Must be a non-empty array of id strings.' } });
  }
  res.json(await withTx((session) => deleteRecords(cfg, [...new Set(ids)], req.ctx, { session })));
}));

// ---- CSV import (spec 4.7): rows are independent, each row gets its own result ------------------
router.post(route(`([a-z]+)${C}bulkCreate`), asyncHandler(async (req, res) => {
  const cfg = moduleOf(req.params[0]);
  if (!cfg.bulkCreate) throw new AppError(422, 'IMPORT_NOT_ALLOWED', `CSV import is not supported for ${cfg.title}. Only Properties and Rental Units can be imported.`);
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) throw new AppError(422, 'VALIDATION_ERROR', 'There are no rows to import.', { fields: { items: 'Must be a non-empty array.' } });

  const results = [];
  for (let index = 0; index < items.length; index++) {
    try {
      const body = bodyOf(cfg, req, items[index]);
      const doc = await withTx((session) => createRecord(cfg, body, req.ctx, { session }));
      results.push({ index, id: doc._id, record: serialize(cfg, doc) });
    } catch (err) {
      if (!err.status || err.status >= 500) throw err;
      results.push({ index, error: { code: err.code, message: err.message, ...(err.extra?.fields ? { fields: err.extra.fields } : {}) } });
    }
  }
  const created = results.filter((r) => !r.error).length;
  res.status(created ? 201 : 422).json({ created, failed: results.length - created, results });
}));

// ---- rents of this month (spec 4.1) -----------------------------------------------------------
router.post(route(`rents${C}generateThisMonth`), asyncHandler(async (req, res) => {
  const L = registry.get('leases');
  const Rn = registry.get('rents');
  const month = monthStart(today());
  const created = await withTx(async (session) => {
    const active = await L.Model.find({ status: { $in: E.ACTIVE_LEASE } }).sort({ start: -1 }).session(session).lean();
    const existing = new Set((await Rn.Model.find({ month }, 'unit').session(session).lean()).map((r) => r.unit));
    const unitIds = new Set((await registry.get('units').Model.find({ _id: { $in: active.map((l) => l.unit) } }, '_id').session(session).lean()).map((u) => u._id));
    let n = 0;
    for (const lease of active) {
      if (existing.has(lease.unit) || !unitIds.has(lease.unit)) continue;
      await createRecord(Rn, { unit: lease.unit, month, due: lease.rent, paid: 0 }, req.ctx, { session });
      existing.add(lease.unit);
      n += 1;
    }
    return n;
  });
  res.json({ created, month });
}));

// ---- lease renewal in one transaction (spec 4.2) ----------------------------------------------
const RENEW_OVERRIDES = ['kind', 'start', 'end', 'rent', 'deposit', 'renewal', 'note'];
router.post(route(`leases/([^/]+?)${C}renew`), asyncHandler(async (req, res) => {
  const L = registry.get('leases');
  const body = bodyOf(L, req, req.body || {});
  const expectVersion = req.headers['if-match'] || Number.isInteger(body.version) ? versionOf(req) : null;
  const out = await withTx(async (session) => {
    const old = await L.Model.findById(req.params[0]).session(session).lean();
    if (!old) throw notFound(L.noun);
    if (['Renewed', 'Terminated'].includes(old.status)) throw conflict('INVALID_STATE', `The lease is "${old.status}" and cannot be renewed.`);
    const next = {
      unit: old.unit, kind: old.kind, status: 'Upcoming', start: addDays(old.end, 1), end: addMonths(old.end, 12),
      rent: old.rent, deposit: old.deposit, renewal: old.renewal, prev: old._id,
    };
    for (const k of RENEW_OVERRIDES) if (body[k] !== undefined) next[k] = body[k];
    const lease = await createRecord(L, next, req.ctx, { session });
    const { doc: previous } = await updateRecord(L, old._id, { status: 'Renewed' }, req.ctx, { session, expectVersion });
    return { lease: serialize(L, lease), previous: serialize(L, previous) };
  });
  res.status(201).json(out);
}));

// ---- undo one edit from history (spec 5) -------------------------------------------------------
router.post(route(`history/([^/]+?)${C}revert`), asyncHandler(async (req, res) => {
  const entry = await History.findById(req.params[0]).lean();
  if (!entry) throw notFound('history entry');
  if (!['update', 'restore'].includes(entry.action) || !entry.changes) throw conflict('INVALID_STATE', 'Only an update can be reverted.');
  const cfg = registry.get(entry.module);
  if (!cfg || !(await cfg.Model.exists({ _id: entry.recId }))) throw conflict('RECORD_DELETED', 'The record has been deleted and cannot be reverted.');
  const body = {};
  for (const [field, [oldValue]] of Object.entries(entry.changes)) if (cfg.writable.includes(field)) body[field] = oldValue;
  const expectVersion = req.headers['if-match'] ? versionOf(req) : null;
  const { doc } = await withTx((session) => updateRecord(cfg, entry.recId, body, req.ctx, { session, expectVersion, action: 'restore' }));
  res.set('ETag', `"${doc.version}"`).json(serialize(cfg, doc));
}));

// ---- CSV export (spec 4.6): kept for app compatibility, never limited ---------------------------
router.post(route(`exports${C}consume`), (_req, res) => res.json({ left: null, limit: null }));

module.exports = { router };
