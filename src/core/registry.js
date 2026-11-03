/**
 * Every module by name. `define` reads the field metadata off the Mongoose schema (label, ftype, ref target, onDelete...)
 * so the CRUD engine, the Guard, the cascade and the list filters all work from one description.
 */
const { AppError } = require('../utils/AppError');
const { SYSTEM_FIELDS } = require('../models/define');

/** Order the app uses to pick the display name of a record (spec 2.2). */
const LABEL_ORDER = ['name', 'code', 'title', 'company', 'lender', 'item', 'kind', 'category'];

const registry = new Map();

function define(cfg) {
  const fields = [];
  cfg.Model.schema.eachPath((name, st) => {
    if (SYSTEM_FIELDS.includes(name) || name.includes('.')) return;
    const o = st.options;
    fields.push({
      name,
      label: o.label || name,
      ftype: o.ftype || 'string',
      required: !!o.required,
      to: o.to || null,
      onDelete: o.onDelete || null,
      computed: !!o.computed,
      contact: !!o.contact,
      guard: o.guard !== false,
      values: o.values || null,
    });
  });

  const full = {
    sort: [],
    dateKey: null,
    statusField: null,
    periodLocked: false,
    searchRefs: [],
    ...cfg,
    fields,
    fieldMap: Object.fromEntries(fields.map((f) => [f.name, f])),
    fieldNames: fields.map((f) => f.name),
    writable: fields.filter((f) => !f.computed).map((f) => f.name),
    refs: fields.filter((f) => f.to),
  };
  full.labelField = LABEL_ORDER.find((k) => full.fieldMap[k]) || null;
  full.search = cfg.search || (full.labelField ? [full.labelField] : []);
  /** 422 VALIDATION_ERROR whose message is "<Label>: <error>" of the first field. */
  full.fail = (errors) => {
    const [k, v] = Object.entries(errors)[0];
    return new AppError(422, 'VALIDATION_ERROR', `${full.fieldMap[k]?.label || k}: ${v}`, { fields: errors });
  };
  registry.set(full.name, full);
  return full;
}

const get = (name) => registry.get(name);
const all = () => [...registry.values()];
const names = () => [...registry.keys()];

module.exports = { define, get, all, names, LABEL_ORDER };
