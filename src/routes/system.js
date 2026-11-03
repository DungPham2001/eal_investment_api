/** Config, company & legal content, history, content reports, alerts / queue / timeline, daily job. */
const express = require('express');
const registry = require('../core/registry');
const { labelOf } = require('../core/labels');
const { serializeHistory } = require('../core/history');
const { History, ContentReport } = require('../models/system');
const E = require('../models/enums');
const { AppError, asyncHandler, notFound, invalid } = require('../utils/AppError');
const { adminOnly, cronOrAdmin } = require('../middleware/auth');
const { scanValues } = require('../lib/guard');
const { isDate } = require('../lib/dates');
const { publicConfig, setClosedBefore } = require('../services/settings');
const { getContent, putContent } = require('../services/content');
const { buildAlerts, buildQueue, buildTimeline, unusualEdits } = require('../services/alerts');
const { runDailyJobs } = require('../services/jobs');

const router = express.Router();
const ok = (fn) => asyncHandler(async (req, res) => res.json(await fn(req)));

const encodeCursor = (o) => Buffer.from(JSON.stringify({ o })).toString('base64url');
function page(query) {
  const limit = Math.max(1, parseInt(query.limit, 10) || 50);
  let offset = 0;
  if (query.cursor) {
    try { offset = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString('utf8')).o; } catch { offset = -1; }
    if (!Number.isInteger(offset) || offset < 0) throw invalid({ cursor: 'Invalid cursor. Reload the list from the start.' });
  }
  return { limit, offset };
}
async function paged(Model, filter, query, sort, map) {
  const { limit, offset } = page(query);
  const [rows, total] = await Promise.all([Model.find(filter).sort(sort).skip(offset).limit(limit).lean(), Model.countDocuments(filter)]);
  return { items: rows.map(map), nextCursor: offset + rows.length < total ? encodeCursor(offset + rows.length) : null, total };
}
const str = (v) => (typeof v === 'string' && v ? v : undefined);

// ---- config & content (spec 7, 8) ---------------------------------------------------------------
router.get('/config', ok(() => publicConfig()));
router.put('/config/closed-before', adminOnly, ok(async (req) => {
  const v = req.body?.closedBefore;
  if (v !== null && !isDate(v)) throw invalid({ closedBefore: 'Invalid date (YYYY-MM-DD) or null' });
  return { closedBefore: await setClosedBefore(v) };
}));

router.get('/company', ok(() => getContent('company')));
router.get('/legal/terms', ok(() => getContent('terms')));
router.get('/legal/privacy', ok(() => getContent('privacy')));
router.get('/content/guides', ok(() => getContent('guides')));
router.put('/content/:key', adminOnly, ok((req) => putContent(req.params.key, req.body)));

// ---- history (spec 5) ----------------------------------------------------------------------------
router.get('/history/unusual', ok(() => unusualEdits()));
router.get('/history', ok((req) => {
  const q = req.query;
  const filter = {};
  for (const k of ['module', 'recId', 'action', 'by']) if (str(q[k])) filter[k] = q[k].includes(',') ? { $in: q[k].split(',') } : q[k];
  return paged(History, filter, q, { at: -1, _id: 1 }, serializeHistory);
}));

// ---- content reports (spec 5.1) --------------------------------------------------------------------
const serializeReport = (r) => ({ id: r._id, module: r.module, recId: r.recId, label: r.label, reason: r.reason, detail: r.detail ?? null, status: r.status, by: r.by, at: r.at });

router.get('/reports', ok((req) => {
  const filter = {};
  for (const k of ['module', 'recId', 'status']) if (str(req.query[k])) filter[k] = req.query[k];
  return paged(ContentReport, filter, req.query, { at: -1, _id: 1 }, serializeReport);
}));

router.post('/reports', asyncHandler(async (req, res) => {
  const { module, recId, reason, detail } = req.body || {};
  const cfg = registry.get(module);
  if (!cfg) throw invalid({ module: `Must be one of: ${registry.names().join(', ')}` });
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 200) throw invalid({ reason: 'Required (max 200 characters)' });
  if (detail != null && (typeof detail !== 'string' || detail.length > 2000)) throw invalid({ detail: 'Max 2000 characters' });
  const bad = scanValues({ reason, detail });
  if (Object.keys(bad).length) throw new AppError(422, 'SENSITIVE_DATA', Object.values(bad)[0], { fields: bad });
  const doc = typeof recId === 'string' && (await cfg.Model.findById(recId).lean());
  if (!doc) throw notFound(cfg.noun);
  const [row] = await ContentReport.create([{ module, recId, label: await labelOf(cfg, doc), reason: reason.trim(), detail: detail?.trim() || null, by: req.ctx.by }]);
  res.status(201).json(serializeReport(row.toObject()));
}));

router.patch('/reports/:id', ok(async (req) => {
  if (!E.REPORT_STATUS.includes(req.body?.status)) throw invalid({ status: `Must be one of: ${E.REPORT_STATUS.join(' / ')}` });
  const row = await ContentReport.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true }).lean();
  if (!row) throw notFound('report');
  return serializeReport(row);
}));

// ---- alerts, queue, timeline (spec 6.3, 6.4) -----------------------------------------------------
router.get('/alerts', ok((req) => buildAlerts(req.query)));
router.get('/queue', ok((req) => buildQueue(req.query)));
router.get('/timeline', ok((req) => buildTimeline(req.query)));

module.exports = router;
module.exports.jobs = express.Router()
  .get('/jobs/daily', cronOrAdmin, ok(() => runDailyJobs()))
  .post('/jobs/daily', cronOrAdmin, ok(() => runDailyJobs()));
