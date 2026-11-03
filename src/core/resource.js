const express = require('express');
const { createRecord, updateRecord, deleteRecord, pick } = require('./record');
const { serialize } = require('./serialize');
const { list, expand } = require('./list');
const cascade = require('./cascade');
const { withTx } = require('./tx');
const { History } = require('../models/system');
const { serializeHistory } = require('./history');
const { AppError, asyncHandler, notFound } = require('../utils/AppError');
const { scan } = require('../lib/guard');

/** JSON object body, re-checked with the Guard (spec 0.3) -> 422 SENSITIVE_DATA. */
function bodyOf(cfg, req, body = req.body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'INVALID_BODY', 'A JSON object body is required.');
  const bad = scan(cfg, body);
  if (Object.keys(bad).length) {
    const [k, v] = Object.entries(bad)[0];
    throw new AppError(422, 'SENSITIVE_DATA', `${cfg.fieldMap[k]?.label || k}: ${v}`, { fields: bad });
  }
  return body;
}

/** If-Match: 3 | "3" | W/"3" (spec 4.4). `version` in the body is accepted as a fallback. */
function versionOf(req) {
  const h = req.headers['if-match'];
  const m = typeof h === 'string' && /^(?:W\/)?"?(\d+)"?$/.exec(h.trim());
  if (m) return Number(m[1]);
  if (Number.isInteger(req.body?.version)) return req.body.version;
  throw new AppError(428, 'PRECONDITION_REQUIRED', 'Missing If-Match header (the current version of the record).');
}

const withEtag = (res, record) => res.set('ETag', `"${record.version}"`).json(record);

/** POST /{module}/{id}/duplicate (spec 2.3): business fields only, " (copy)" on the first of name / code / title. */
function duplicateBody(cfg, doc) {
  const body = pick(cfg.writable, serialize(cfg, doc));
  for (const k of ['name', 'code', 'title']) {
    if (typeof body[k] === 'string' && body[k]) {
      body[k] = `${body[k]} (copy)`.slice(0, 300);
      break;
    }
  }
  return body;
}

/** Standard REST router of a module (spec 2). */
function createRouter(cfg) {
  const router = express.Router();
  const ser = (doc) => serialize(cfg, doc);

  router.get('/', asyncHandler(async (req, res) => res.json(await list(cfg, req.query))));

  router.post('/', asyncHandler(async (req, res) => {
    const body = bodyOf(cfg, req);
    const doc = await withTx((session) => createRecord(cfg, body, req.ctx, { session }));
    withEtag(res.status(201), ser(doc));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    if (cfg.beforeList) await cfg.beforeList();
    const row = await cfg.Model.findById(req.params.id).lean();
    if (!row) throw notFound(cfg.noun);
    const [item] = await expand(cfg, [ser(row)], req.query.expand);
    withEtag(res, item);
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const body = bodyOf(cfg, req);
    const expectVersion = versionOf(req);
    const { doc } = await withTx((session) => updateRecord(cfg, req.params.id, body, req.ctx, { session, expectVersion }));
    withEtag(res, ser(doc));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await withTx((session) => deleteRecord(cfg, req.params.id, req.ctx, { session }));
    res.status(204).end();
  }));

  router.get('/:id/impact', asyncHandler(async (req, res) => {
    if (!(await cfg.Model.exists({ _id: req.params.id }))) throw notFound(cfg.noun);
    res.json(await cascade.describe(await cascade.plan(cfg.name, [req.params.id])));
  }));

  router.post('/:id/duplicate', asyncHandler(async (req, res) => {
    const src = await cfg.Model.findById(req.params.id).lean();
    if (!src) throw notFound(cfg.noun);
    const doc = await withTx((session) => createRecord(cfg, duplicateBody(cfg, src), req.ctx, { session }));
    withEtag(res.status(201), ser(doc));
  }));

  router.get('/:id/history', asyncHandler(async (req, res) => {
    const rows = await History.find({ module: cfg.name, recId: req.params.id }).sort({ at: -1, _id: 1 }).lean();
    res.json({ items: rows.map(serializeHistory), nextCursor: null, total: rows.length });
  }));

  return router;
}

module.exports = { createRouter, bodyOf, versionOf, withEtag };
