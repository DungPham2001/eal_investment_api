/** Loads the collections the analytics / alerts / queue / timeline need, scoped by property or portfolio. */
const M = require('../models/records');
const { invalid } = require('../utils/AppError');
const { isDate, today } = require('../lib/dates');
const { refreshRentStatuses } = require('./rents');

const list = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);

/** { at, propertyIds | null } from ?at=&propertyId=&portfolioId= (several ids: comma separated). */
async function scopeOf(query = {}) {
  const at = query.at || today();
  if (!isDate(at)) throw invalid({ at: 'Invalid date (format YYYY-MM-DD)' });
  let propertyIds = list(query.propertyId);
  const portfolios = list(query.portfolioId);
  if (portfolios) {
    const ids = (await M.properties.find({ portfolio: { $in: portfolios } }, '_id').lean()).map((p) => p._id);
    propertyIds = propertyIds ? propertyIds.filter((id) => ids.includes(id)) : ids;
  }
  return { at, propertyIds };
}

const LOADERS = {
  properties: (f) => M.properties.find(f.self).lean(),
  units: (f) => M.units.find(f.prop).lean(),
  leases: (f) => M.leases.find(f.prop).lean(),
  rents: async (f) => { await refreshRentStatuses(M.rents); return M.rents.find(f.prop).lean(); },
  revenue: (f) => M.revenue.find(f.prop).lean(),
  expenses: (f) => M.expenses.find(f.prop).lean(),
  budgets: (f) => M.budgets.find(f.prop).lean(),
  loans: (f) => M.loans.find(f.prop).lean(),
  workorders: (f) => M.workorders.find(f.prop).lean(),
  inspections: (f) => M.inspections.find(f.prop).lean(),
  renovations: (f) => M.renovations.find(f.prop).lean(),
  milestones: async (f) => (f.renovationIds ? M.milestones.find({ renovation: { $in: await f.renovationIds() } }).lean() : M.milestones.find().lean()),
  sales: (f) => M.sales.find(f.prop).lean(),
  // not tied to a property: never scoped
  deals: () => M.deals.find().lean(),
  checklist: () => M.checklist.find().lean(),
  tasks: () => M.tasks.find().lean(),
  vendors: () => M.vendors.find().lean(),
};

/** load(scope, ['units', 'leases']) -> { units: [...], leases: [...] } */
async function load({ propertyIds }, names) {
  const f = {
    self: propertyIds ? { _id: { $in: propertyIds } } : {},
    prop: propertyIds ? { property: { $in: propertyIds } } : {},
    renovationIds: propertyIds ? async () => (await M.renovations.find({ property: { $in: propertyIds } }, '_id').lean()).map((r) => r._id) : null,
  };
  const rows = await Promise.all(names.map((n) => LOADERS[n](f)));
  return Object.fromEntries(names.map((n, i) => [n, rows[i]]));
}

module.exports = { scopeOf, load };
