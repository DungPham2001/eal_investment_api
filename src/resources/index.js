/**
 * Registers the 21 modules (spec 2.4 + 3) with their server rules (spec 4).
 * Hooks: prepare({ doc, isNew, before, session }) normalizes / computes, validate(...) checks cross-field rules.
 */
const { define } = require('../core/registry');
const M = require('../models/records');
const { conflict } = require('../utils/AppError');
const { monthStart, today } = require('../lib/dates');
const { round } = require('../lib/util');
const { vnMonth } = require('../core/labels');
const { rentStatus, refreshIfStale } = require('../services/rents');

/** later >= earlier, both optional YYYY-MM-DD. */
function notBefore(cfg, doc, later, earlier) {
  if (doc[later] && doc[earlier] && doc[later] < doc[earlier]) throw cfg.fail({ [later]: `Must be on or after ${cfg.fieldMap[earlier].label}` });
}

const propertyOfUnit = async (unitId, session) => (await M.units.findById(unitId, 'property').session(session).lean())?.property ?? null;

define({ name: 'portfolios', Model: M.portfolios, noun: 'portfolio', title: 'Portfolio', sort: ['name'] });

define({
  name: 'properties', Model: M.properties, noun: 'property', title: 'Property', statusField: 'status',
  sort: ['value', 'units', 'name'], bulkCreate: true,
});

const units = define({
  name: 'units', Model: M.units, noun: 'rental unit', title: 'Rental Units', statusField: 'status',
  sort: ['rent', 'code', 'area'], bulkCreate: true,
  async validate({ doc, session }) {
    const other = await M.units.findOne({ property: doc.property, code: doc.code, _id: { $ne: doc._id } }, '_id').collation({ locale: 'vi', strength: 2 }).session(session).lean();
    if (other) throw conflict('DUPLICATE', `Unit code "${doc.code}" already exists in this property.`, { fields: { code: 'Already exists in this property' } });
  },
});

const leases = define({
  name: 'leases', Model: M.leases, noun: 'lease', title: 'Leases', statusField: 'status', dateKey: 'end',
  sort: ['end', 'rent'], searchRefs: ['unit'],
  async prepare({ doc, session }) {
    doc.property = await propertyOfUnit(doc.unit, session);
  },
  validate({ doc }) {
    notBefore(leases, doc, 'end', 'start');
    if (doc.prev && doc.prev === doc._id) throw leases.fail({ prev: 'Cannot be the lease itself' });
  },
});

const rents = define({
  name: 'rents', Model: M.rents, noun: 'rent period', title: 'Rent Collection', statusField: 'status', dateKey: 'month',
  sort: ['month', 'gap'], searchRefs: ['unit'], periodLocked: true,
  labelNeedsUnits: true,
  labelOf: (d, { unitCode }) => `${unitCode || 'Unit'} · ${vnMonth(d.month)}`,
  beforeList: () => refreshIfStale(M.rents),
  async prepare({ doc, session }) {
    doc.property = await propertyOfUnit(doc.unit, session);
    if (doc.month) doc.month = monthStart(doc.month);
    if (doc.paid == null) doc.paid = 0;
    doc.gap = round((doc.due || 0) - (doc.paid || 0));
    doc.status = rentStatus(doc);
  },
  async validate({ doc, session }) {
    const other = await M.rents.findOne({ unit: doc.unit, month: doc.month, _id: { $ne: doc._id } }, '_id').session(session).lean();
    if (other) throw conflict('DUPLICATE', `This unit already has a rent period for ${vnMonth(doc.month)}.`, { fields: { month: 'A rent period already exists for this month' } });
  },
  decorate: (r) => ({ ...r, status: rentStatus(r), gap: round((r.due || 0) - (r.paid || 0)) }),
});

const workorders = define({
  name: 'workorders', Model: M.workorders, noun: 'work order', title: 'Maintenance', statusField: 'status', dateKey: 'dueDate',
  sort: ['dueDate', 'estCost'],
  prepare({ doc }) {
    if (doc.status === 'Completed' && !doc.doneDate) doc.doneDate = today();
  },
  async validate({ doc, session }) {
    if (!doc.unit) return;
    const unitProperty = await propertyOfUnit(doc.unit, session);
    if (unitProperty && unitProperty !== doc.property) throw workorders.fail({ unit: 'The unit does not belong to the selected property' });
  },
});

define({ name: 'vendors', Model: M.vendors, noun: 'vendor', title: 'Contractor', statusField: 'status', sort: ['company'] });

define({ name: 'inspections', Model: M.inspections, noun: 'inspection', title: 'Property Inspections', statusField: 'result', dateKey: 'date', sort: ['date'] });

const renovations = define({
  name: 'renovations', Model: M.renovations, noun: 'renovation project', title: 'Renovation Projects', statusField: 'status', dateKey: 'eta',
  sort: ['eta', 'budget', 'progress'],
  validate({ doc }) { notBefore(renovations, doc, 'eta', 'start'); },
});

define({ name: 'milestones', Model: M.milestones, noun: 'milestone', title: 'Milestones', statusField: 'status', dateKey: 'due', sort: ['due'] });

define({ name: 'tasks', Model: M.tasks, noun: 'task', title: 'Tasks', statusField: 'status', dateKey: 'due', sort: ['due', 'priority'] });

define({
  name: 'expenses', Model: M.expenses, noun: 'expense', title: 'Expenses', dateKey: 'date', sort: ['date', 'amount'], periodLocked: true,
  prepare({ doc }) {
    if (doc.category === 'Capital Improvements') doc.nature = 'Capital';
  },
});

define({ name: 'budgets', Model: M.budgets, noun: 'budget', title: 'Annual budget', sort: ['year', 'amount'] });

const loans = define({
  name: 'loans', Model: M.loans, noun: 'loan', title: 'Loans', statusField: 'status', dateKey: 'maturity',
  sort: ['maturity', 'balance', 'rate'],
  validate({ doc }) { notBefore(loans, doc, 'maturity', 'start'); },
});

define({
  name: 'revenue', Model: M.revenue, noun: 'revenue record', title: 'Revenue Records', dateKey: 'month', sort: ['month', 'amount'], periodLocked: true,
  prepare({ doc }) {
    if (doc.month) doc.month = monthStart(doc.month);
    if (!doc.source) doc.source = 'Manual Entry'; // "Auto from Rent Collection" is only ever set by the server
  },
});

const targets = define({
  name: 'targets', Model: M.targets, noun: 'target', title: 'Revenue & NOI Targets', sort: ['year', 'revenue', 'noi'],
  labelOf: (d) => (d.period === 'Year' || !d.index ? `Annual target ${d.year}` : `${d.period} target ${d.index}/${d.year}`),
  prepare({ doc }) {
    if (doc.period === 'Year') doc.index = null;
  },
  validate({ doc }) {
    if (doc.period === 'Month' && !(doc.index >= 1 && doc.index <= 12)) throw targets.fail({ index: 'Enter a month from 1 to 12' });
    if (doc.period === 'Quarter' && !(doc.index >= 1 && doc.index <= 4)) throw targets.fail({ index: 'Enter a quarter from 1 to 4' });
  },
});

define({
  name: 'deals', Model: M.deals, noun: 'investment deal', title: 'Investment Deals', statusField: 'stage', sort: ['ask', 'cap', 'offer'],
  prepare({ doc }) {
    const price = doc.offer > 0 ? doc.offer : doc.ask;
    doc.cap = price > 0 && doc.noi != null ? round((doc.noi / price) * 100) : null;
    if (doc.side === 'Buy') doc.property = null; // property only applies to "Sell" deals
  },
});

define({ name: 'checklist', Model: M.checklist, noun: 'checklist item', title: 'Due Diligence Checklist', statusField: 'status' });

define({ name: 'sales', Model: M.sales, noun: 'closed transaction', title: 'Closed Transactions', dateKey: 'date', sort: ['date', 'value', 'qty'] });

define({ name: 'scenarios', Model: M.scenarios, noun: 'scenario', title: 'Analysis Scenarios', sort: ['name'], search: ['name', 'tool'] });

define({ name: 'partners', Model: M.partners, noun: 'partner', title: 'Partners', sort: ['company'], search: ['company', 'city'] });

module.exports = require('../core/registry');
