const mongoose = require('mongoose');
const { Schema } = mongoose;
const { newId } = require('./fields');
const E = require('./enums');

const make = (name, collection, def, indexes = []) => {
  const s = new Schema(def, { collection, versionKey: false, minimize: false });
  for (const [spec, opts] of indexes) s.index(spec, opts);
  return mongoose.model(name, s);
};

/** Edit history (spec 5). `changes` = { field: [old, new] } for update / restore only. */
const History = make('History', 'history', {
  _id: { type: String, default: newId },
  module: String,
  recId: String,
  label: String,
  by: String,
  at: { type: Date, default: Date.now },
  action: { type: String, enum: E.HISTORY_ACTION },
  changes: { type: Schema.Types.Mixed, default: null },
}, [[{ at: -1, _id: 1 }], [{ module: 1, recId: 1, at: -1 }], [{ action: 1, at: -1 }], [{ by: 1, at: -1 }]]);

/** Content reports (spec 5.1). */
const ContentReport = make('ContentReport', 'content_reports', {
  _id: { type: String, default: newId },
  module: String,
  recId: String,
  label: String,
  reason: String,
  detail: { type: String, default: null },
  status: { type: String, enum: E.REPORT_STATUS, default: 'Pending Review' },
  by: String,
  at: { type: Date, default: Date.now },
}, [[{ at: -1 }], [{ module: 1, recId: 1 }], [{ status: 1, at: -1 }]]);

/** Company info, legal texts and guides (spec 7, 8.1). `_id` = company | terms | privacy | guides. */
const Content = make('Content', 'contents', {
  _id: String,
  data: Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now },
});

/** Monthly occupancy per property, written by the daily job: past months keep the figure they had at month end. */
const OccupancySnapshot = make('OccupancySnapshot', 'occupancy_snapshots', {
  _id: String, // `${month}:${propertyId}`
  month: String,
  property: String,
  occupied: Number,
  total: Number,
  at: { type: Date, default: Date.now },
}, [[{ month: 1 }]]);

/** Singleton shared settings (manual period close). */
const Setting = make('Setting', 'settings', {
  _id: String,
  closedBefore: { type: String, default: null },
  updatedAt: Date,
});

module.exports = { History, ContentReport, Content, OccupancySnapshot, Setting };
