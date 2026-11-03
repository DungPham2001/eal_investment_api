/**
 * Display name of a record (history `label`, impact preview, `?expand=`): the first of
 * name / code / title / company / lender / item / kind / category, or a module-specific `cfg.labelOf`.
 */
const registry = require('./registry');

const vnMonth = (m) => (m ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : '');

/** Map id -> label for `docs` of module `cfg` (lean or hydrated). */
async function labelsFor(cfg, docs, session = null) {
  const out = new Map();
  if (!docs.length) return out;
  let unitCodes = new Map();
  if (cfg.labelNeedsUnits) {
    const ids = [...new Set(docs.map((d) => d.unit).filter(Boolean))];
    const units = await registry.get('units').Model.find({ _id: { $in: ids } }, 'code').session(session).lean();
    unitCodes = new Map(units.map((u) => [u._id, u.code]));
  }
  for (const d of docs) {
    const label = cfg.labelOf ? cfg.labelOf(d, { unitCode: unitCodes.get(d.unit) }) : (cfg.labelField && d[cfg.labelField]) || '';
    out.set(String(d._id), label || cfg.noun);
  }
  return out;
}

async function labelOf(cfg, doc, session = null) {
  return (await labelsFor(cfg, [doc], session)).get(String(doc._id));
}

/** Labels of records referenced by id, loaded by module. ids -> Map(id -> label). */
async function labelsByIds(module, ids, session = null) {
  const cfg = registry.get(module);
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!cfg || !uniq.length) return new Map();
  const docs = await cfg.Model.find({ _id: { $in: uniq } }).session(session).lean();
  return labelsFor(cfg, docs, session);
}

module.exports = { labelsFor, labelOf, labelsByIds, vnMonth };
