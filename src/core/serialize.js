/**
 * lean doc -> API shape (spec 2.1): flat business fields + id, createdBy, createdAt, updatedAt, version.
 * Missing optionals come back as null. `cfg.decorate` adds read-time computed values (rents.status).
 */
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject({ minimize: false }) : doc);

function serialize(cfg, input) {
  const obj = plain(input);
  const out = { id: String(obj._id) };
  for (const f of cfg.fieldNames) out[f] = obj[f] ?? null;
  out.createdBy = obj.createdBy ?? 'Anonymous';
  out.createdAt = obj.createdAt ?? null;
  out.updatedAt = obj.updatedAt ?? null;
  out.version = obj.version ?? 1;
  return cfg.decorate ? cfg.decorate(out) : out;
}

module.exports = { serialize, plain };
