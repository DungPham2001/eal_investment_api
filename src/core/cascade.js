/**
 * Delete rules of spec 1, driven by each ref field's `onDelete`:
 *   cascade -> the child is deleted too (and its own children), unlink -> the child's field becomes null, keep -> nothing.
 */
const registry = require('./registry');
const { labelsFor } = require('./labels');
const { History, ContentReport } = require('../models/system');

const childLinks = (module) =>
  registry.all().flatMap((cfg) => cfg.refs.filter((f) => f.to === module && f.onDelete !== 'keep').map((f) => ({ cfg, field: f.name, onDelete: f.onDelete })));

/**
 * What deleting `ids` of `module` does.
 * Returns { roots: Map(module -> ids), removed: Map(module -> ids) (children only), unlinked: [{ cfg, id, field }] }.
 */
async function plan(module, ids, session = null) {
  const roots = new Map([[module, new Set(ids)]]);
  const removed = new Map();
  const isGone = (m, id) => roots.get(m)?.has(id) || removed.get(m)?.has(id);
  const unlinkSpecs = [];
  const queue = [[module, ids]];

  while (queue.length) {
    const [m, batch] = queue.shift();
    for (const { cfg, field, onDelete } of childLinks(m)) {
      if (onDelete === 'unlink') {
        unlinkSpecs.push({ cfg, field, targets: batch });
        continue;
      }
      const rows = await cfg.Model.find({ [field]: { $in: batch } }, '_id').session(session).lean();
      const fresh = rows.map((r) => r._id).filter((id) => !isGone(cfg.name, id));
      if (!fresh.length) continue;
      if (!removed.has(cfg.name)) removed.set(cfg.name, new Set());
      for (const id of fresh) removed.get(cfg.name).add(id);
      queue.push([cfg.name, fresh]);
    }
  }

  const unlinked = [];
  const seen = new Set();
  for (const { cfg, field, targets } of unlinkSpecs) {
    const rows = await cfg.Model.find({ [field]: { $in: targets } }, '_id').session(session).lean();
    for (const r of rows) {
      const key = `${cfg.name}:${r._id}:${field}`;
      if (isGone(cfg.name, r._id) || seen.has(key)) continue;
      seen.add(key);
      unlinked.push({ cfg, id: r._id, field });
    }
  }
  return { roots, removed, unlinked };
}

/** Impact preview body: { removed: [{ module, id, label }], unlinked: [{ module, id, label, field }], counts }. */
async function describe(p, session = null) {
  const removed = [];
  const counts = { removed: {}, unlinked: {} };
  for (const [module, set] of p.removed) {
    const cfg = registry.get(module);
    const docs = await cfg.Model.find({ _id: { $in: [...set] } }).session(session).lean();
    const labels = await labelsFor(cfg, docs, session);
    for (const d of docs) removed.push({ module, id: d._id, label: labels.get(d._id) });
    counts.removed[module] = docs.length;
  }
  const unlinked = [];
  const byModule = new Map();
  for (const u of p.unlinked) (byModule.get(u.cfg.name) || byModule.set(u.cfg.name, []).get(u.cfg.name)).push(u);
  for (const [module, list] of byModule) {
    const cfg = registry.get(module);
    const docs = await cfg.Model.find({ _id: { $in: list.map((u) => u.id) } }).session(session).lean();
    const labels = await labelsFor(cfg, docs, session);
    for (const u of list) unlinked.push({ module, id: u.id, label: labels.get(u.id) || cfg.noun, field: u.field });
    counts.unlinked[module] = new Set(list.map((u) => u.id)).size;
  }
  return { removed, unlinked, counts };
}

/** Applies a plan: deletes roots + children, nulls unlinked fields (version +1), drops their history and content reports. */
async function execute(p, session = null) {
  const gone = [];
  for (const map of [p.roots, p.removed]) {
    for (const [module, set] of map) {
      const ids = [...set];
      if (!ids.length) continue;
      await registry.get(module).Model.deleteMany({ _id: { $in: ids } }, { session });
      gone.push({ module, recId: { $in: ids } });
    }
  }
  const groups = new Map();
  for (const u of p.unlinked) {
    const key = `${u.cfg.name}|${u.field}`;
    if (!groups.has(key)) groups.set(key, { cfg: u.cfg, field: u.field, ids: [] });
    groups.get(key).ids.push(u.id);
  }
  for (const { cfg, field, ids } of groups.values()) {
    await cfg.Model.updateMany({ _id: { $in: ids } }, { $set: { [field]: null }, $inc: { version: 1 } }, { session });
  }
  if (gone.length) {
    await History.deleteMany({ $or: gone }, { session });
    await ContentReport.deleteMany({ $or: gone }, { session });
  }
}

module.exports = { plan, describe, execute };
