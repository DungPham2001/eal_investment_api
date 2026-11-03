const { History } = require('../models/system');
const { labelOf } = require('./labels');

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** { field: [old, new] } over the fields that differ (system fields are not part of the snapshots). */
function diff(before, after) {
  const out = {};
  for (const k of Object.keys(after)) if (!same(before[k], after[k])) out[k] = [before[k] ?? null, after[k] ?? null];
  return out;
}

async function logHistory(cfg, { action, doc, changes = null, ctx, session, label }) {
  const row = {
    module: cfg.name,
    recId: String(doc._id),
    label: label || (await labelOf(cfg, doc, session)),
    by: ctx.by,
    at: new Date(),
    action,
    changes: action === 'update' || action === 'restore' ? changes : null,
  };
  await History.create([row], { session });
}

const serializeHistory = (h) => ({
  id: h._id, module: h.module, recId: h.recId, label: h.label, by: h.by, at: h.at, action: h.action, changes: h.changes ?? null,
});

module.exports = { diff, logHistory, serializeHistory };
