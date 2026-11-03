const mongoose = require('mongoose');
const { Schema } = mongoose;
const { newId } = require('./fields');

/** System fields (spec 0.1) on top of the business fields. */
const SYSTEM_FIELDS = ['_id', 'createdBy', 'version', 'createdAt', 'updatedAt'];

/** The collection is named exactly like the module (`properties`, `workorders`...). */
function defineModel(module, fields, { indexes = [] } = {}) {
  const schema = new Schema(
    {
      _id: { type: String, default: newId },
      ...fields,
      createdBy: { type: String, default: 'Anonymous' },
      version: { type: Number, default: 1 },
    },
    { collection: module, timestamps: true, versionKey: false, minimize: false, id: false }
  );
  schema.index({ createdAt: -1 });
  for (const [spec, opts] of indexes) schema.index(spec, opts);
  return mongoose.model(module, schema);
}

module.exports = { defineModel, SYSTEM_FIELDS };
