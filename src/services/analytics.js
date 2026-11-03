/**
 * Phase-2 aggregates of spec 6. Formulas are the app's (6.1) so numbers do not change when the app switches to them.
 */
const E = require('../models/enums');
const { OccupancySnapshot } = require('../models/system');
const { invalid } = require('../utils/AppError');
const { round, pct, sum } = require('../lib/util');
const { PERIODS, addDays, addMonths, diffDays, day5, monthStart, monthEnd, monthsIn, periodRange, previousRange, inRange, dateInTz, isDate } = require('../lib/dates');
const { scopeOf, load } = require('./data');

const periodOf = (q) => {
  const p = q.period || 'month';
  if (!PERIODS.includes(p)) throw invalid({ period: `Must be one of: ${PERIODS.join(', ')}` });
  return p;
};
const countOf = (q, d = 12) => Math.min(60, Math.max(1, parseInt(q.n, 10) || d));

// ---- building blocks (6.1) -----------------------------------------------------------------------
const countedUnits = (units) => units.filter((u) => u.status !== 'Off Market');
const isOccupied = (u) => E.OCCUPIED_UNIT.includes(u.status);
const isActiveLease = (l) => E.ACTIVE_LEASE.includes(l.status);

function occupancyOf(units) {
  const counted = countedUnits(units);
  return { occupied: counted.filter(isOccupied).length, total: counted.length, occupancy: pct(counted.filter(isOccupied).length, counted.length) };
}

const isOpex = (x) => x.nature === 'Operating' && !E.NON_OPEX.includes(x.category);
const isCapex = (x) => x.nature === 'Capital' || x.category === 'Capital Improvements';

/** Σ budgets.amount / 12 for each month of the range whose year matches, without Loan Interest & Capital Improvements. */
function budgetFor(budgets, range) {
  return round(sum(monthsIn(range.from, range.to), (m) => sum(budgets.filter((b) => b.year === Number(m.slice(0, 4)) && !E.NON_OPEX.includes(b.category)), (b) => b.amount / 12)));
}

function collectionRate(rents, range) {
  const rows = rents.filter((r) => inRange(r.month, range));
  const due = sum(rows, (r) => r.due);
  return due > 0 ? round((sum(rows, (r) => Math.min(r.paid || 0, r.due || 0)) / due) * 100) : 0;
}

function periodMetrics(d, range) {
  const rev = d.revenue.filter((r) => inRange(r.month, range));
  const exp = d.expenses.filter((x) => inRange(x.date, range));
  const revenue = round(sum(rev, (r) => r.amount));
  const rentRevenue = round(sum(rev.filter((r) => r.kind === 'Rent'), (r) => r.amount));
  const opex = round(sum(exp.filter(isOpex), (x) => x.amount));
  const capex = round(sum(exp.filter(isCapex), (x) => x.amount));
  return {
    range, revenue, rentRevenue, otherRevenue: round(revenue - rentRevenue), opex, capex, noi: round(revenue - opex),
    budget: budgetFor(d.budgets, range), collectionRate: collectionRate(d.rents, range),
  };
}

const openLoans = (loans) => loans.filter((l) => l.status !== 'Paid Off');
const debtService = (loans) => round(sum(openLoans(loans), (l) => (l.payment || 0) * 12));

/** units declared on the property count only while it has no unit records (spec 3.1). */
function unitCount(properties, units) {
  const withRecords = new Set(units.map((u) => u.property));
  return units.length + sum(properties.filter((p) => !withRecords.has(p._id)), (p) => p.units || 0);
}

const openWo = (w) => E.OPEN_WO.includes(w.status);

function avgResolveDays(workorders) {
  const done = workorders.filter((w) => w.status === 'Completed' && w.doneDate && w.createdAt);
  if (!done.length) return 0;
  return round(sum(done, (w) => Math.max(0, diffDays(dateInTz(w.createdAt), w.doneDate))) / done.length, 1);
}

function overdueRents(rents) {
  const rows = rents.filter((r) => r.status === 'Overdue');
  return { amount: round(sum(rows, (r) => Math.max(0, (r.due || 0) - (r.paid || 0)))), units: new Set(rows.map((r) => r.unit)).size };
}

// ---- endpoints (6.2) -----------------------------------------------------------------------------
async function summary(q) {
  const period = periodOf(q);
  const scope = await scopeOf(q);
  const { at } = scope;
  const d = await load(scope, ['properties', 'units', 'leases', 'rents', 'revenue', 'expenses', 'budgets', 'loans', 'workorders', 'deals', 'tasks']);
  const counted = countedUnits(d.units);
  const occ = occupancyOf(d.units);
  const openTasks = d.tasks.filter((t) => t.status !== 'Done');
  return {
    period,
    at,
    propertyCount: d.properties.length,
    unitCount: unitCount(d.properties, d.units),
    occupiedUnits: occ.occupied,
    occupancy: occ.occupancy,
    listedRent: round(sum(counted, (u) => u.rent)),
    actualRent: round(sum(d.leases.filter(isActiveLease), (l) => l.rent)),
    ...periodMetrics(d, periodRange(period, at)),
    totalDebt: round(sum(openLoans(d.loans), (l) => l.balance)),
    debtService: debtService(d.loans),
    overdue: overdueRents(d.rents),
    openWorkOrders: d.workorders.filter(openWo).length,
    overdueWorkOrders: d.workorders.filter((w) => openWo(w) && w.dueDate && w.dueDate < at).length,
    avgResolveDays: avgResolveDays(d.workorders),
    openDeals: d.deals.filter((x) => !E.CLOSED_DEAL.includes(x.stage)).length,
    leasesExpiring60: d.leases.filter((l) => isActiveLease(l) && l.end >= at && l.end <= addDays(at, 60)).length,
    loansMaturing365: openLoans(d.loans).filter((l) => l.maturity && l.maturity <= addDays(at, 365)).length,
    tasksOpen: openTasks.length,
    tasksOverdue: openTasks.filter((t) => t.due < at).length,
    tasksDueSoon: openTasks.filter((t) => t.due >= at && t.due <= addDays(at, 3)).length,
    previous: periodMetrics(d, previousRange(period, at)),
  };
}

const lastMonths = (at, n) => Array.from({ length: n }, (_, i) => addMonths(monthStart(at), i - n + 1));

async function monthly(q) {
  const scope = await scopeOf(q);
  const d = await load(scope, ['revenue', 'expenses', 'budgets', 'rents']);
  return lastMonths(scope.at, countOf(q)).map((month) => {
    const m = periodMetrics(d, { from: month, to: monthEnd(month) });
    return { month, revenue: m.revenue, opex: m.opex, noi: m.noi, capex: m.capex, budget: m.budget };
  });
}

/**
 * Current month: live unit statuses. Past months: the daily job's snapshot if there is one, otherwise the share of
 * counted units that had a lease covering part of that month.
 */
async function occupancyTrend(q) {
  const scope = await scopeOf(q);
  const d = await load(scope, ['units', 'leases']);
  const months = lastMonths(scope.at, countOf(q));
  const snaps = await OccupancySnapshot.find({ month: { $in: months }, ...(scope.propertyIds ? { property: { $in: scope.propertyIds } } : {}) }).lean();
  const current = monthStart(scope.at);
  const counted = countedUnits(d.units);
  return months.map((month) => {
    if (month === current) return { month, occupancy: occupancyOf(d.units).occupancy, source: 'live' };
    const rows = snaps.filter((s) => s.month === month);
    if (rows.length) return { month, occupancy: pct(sum(rows, (s) => s.occupied), sum(rows, (s) => s.total)), source: 'snapshot' };
    const end = monthEnd(month);
    const leased = new Set(d.leases.filter((l) => l.start <= end && l.end >= month && l.status !== 'Upcoming').map((l) => l.unit));
    return { month, occupancy: pct(counted.filter((u) => leased.has(u._id)).length, counted.length), source: 'leases' };
  });
}

/** Per property. DSCR = NOI of the period / annual debt service (spec 6.1). */
async function performance(q) {
  const period = periodOf(q);
  const scope = await scopeOf(q);
  const d = await load(scope, ['properties', 'units', 'revenue', 'expenses', 'budgets', 'rents', 'loans']);
  const range = periodRange(period, scope.at);
  return d.properties.map((p) => {
    const only = (rows) => rows.filter((r) => r.property === p._id);
    const m = periodMetrics({ revenue: only(d.revenue), expenses: only(d.expenses), budgets: only(d.budgets), rents: only(d.rents) }, range);
    const loans = only(d.loans);
    const ds = debtService(loans);
    return {
      propertyId: p._id, name: p.name, type: p.type, city: p.city,
      occupancy: occupancyOf(only(d.units)).occupancy,
      revenue: m.revenue, opex: m.opex, noi: m.noi,
      debt: round(sum(openLoans(loans), (l) => l.balance)),
      debtService: ds,
      cashFlow: round(m.noi - ds),
      area: p.area ?? null,
      noiOnCost: p.purchasePrice > 0 ? round((m.noi / p.purchasePrice) * 100) : null,
      dscr: ds > 0 ? round(m.noi / ds) : null,
    };
  }).sort((a, b) => b.noi - a.noi);
}

async function expenseByCategory(q) {
  const scope = await scopeOf(q);
  const range = periodRange(periodOf(q), scope.at);
  const d = await load(scope, ['expenses']);
  const totals = {};
  for (const x of d.expenses.filter((e) => inRange(e.date, range))) totals[x.category] = round((totals[x.category] || 0) + x.amount);
  return Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
}

async function budgetVsActual(q) {
  const scope = await scopeOf(q);
  const year = q.year ? Number(q.year) : Number(scope.at.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid({ year: 'Invalid year' });
  const d = await load(scope, ['budgets', 'expenses']);
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  return E.EXPENSE_CATEGORY.map((category) => ({
    category,
    budget: round(sum(d.budgets.filter((b) => b.year === year && b.category === category), (b) => b.amount)),
    actual: round(sum(d.expenses.filter((x) => x.category === category && inRange(x.date, range)), (x) => x.amount)),
  })).filter((r) => r.budget || r.actual);
}

/** Unpaid balance by days late = today - day 5 of the rent month. */
async function aging(q) {
  const scope = await scopeOf(q);
  const d = await load(scope, ['rents']);
  const out = { 'Not Due': 0, '1–30 days': 0, '31–60 days': 0, '> 60 days': 0 };
  for (const r of d.rents) {
    const left = (r.due || 0) - (r.paid || 0);
    if (left <= 0) continue;
    const late = diffDays(day5(r.month), scope.at);
    const key = late <= 0 ? 'Not Due' : late <= 30 ? '1–30 days' : late <= 60 ? '31–60 days' : '> 60 days';
    out[key] = round(out[key] + left);
  }
  return out;
}

async function pipeline() {
  const d = await load({ propertyIds: null }, ['deals']);
  const price = (x) => (x.offer > 0 ? x.offer : x.ask || 0);
  return E.DEAL_STAGE.map((stage) => {
    const rows = d.deals.filter((x) => x.stage === stage);
    const side = (s) => {
      const r = rows.filter((x) => x.side === s);
      return { count: r.length, ask: round(sum(r, (x) => x.ask)), value: round(sum(r, price)) };
    };
    return { stage, count: rows.length, ask: round(sum(rows, (x) => x.ask)), value: round(sum(rows, price)), buy: side('Buy'), sell: side('Sell') };
  });
}

/** Sliding window ending today: 30 / 90 / 365 days (spec 6.5). Sorted by qty desc, then value desc. */
const WINDOW_DAYS = { month: 30, quarter: 90, year: 365 };
async function bestSelling(q) {
  const period = periodOf(q);
  const groupBy = q.groupBy || 'property';
  if (!['property', 'product'].includes(groupBy)) throw invalid({ groupBy: 'Must be one of: property, product' });
  const scope = await scopeOf(q);
  const to = scope.at;
  const from = addDays(to, -(WINDOW_DAYS[period] - 1));
  const d = await load(scope, ['sales', 'properties']);
  const props = new Map((await require('../models/records').properties.find({}, 'name type city').lean()).map((p) => [p._id, p]));
  const groups = new Map();
  for (const s of d.sales.filter((x) => x.date >= from && x.date <= to)) {
    const key = groupBy === 'property' ? s.property : s.product;
    if (!groups.has(key)) groups.set(key, { key, qty: 0, value: 0, deals: 0, byKind: {} });
    const g = groups.get(key);
    g.qty += s.qty || 0;
    g.value = round(g.value + (s.value || 0));
    g.deals += 1;
    g.byKind[s.kind] = (g.byKind[s.kind] || 0) + (s.qty || 0);
  }
  const items = [...groups.values()].map((g) => {
    if (groupBy === 'product') return { ...g, title: g.key, subtitle: 'Product type', propertyId: null };
    const p = props.get(g.key);
    return { ...g, title: p?.name ?? '—', subtitle: p ? [p.type, p.city].filter(Boolean).join(' · ') : null, propertyId: g.key };
  }).sort((a, b) => b.qty - a.qty || b.value - a.value);
  return { period, groupBy, from, to, items };
}

module.exports = {
  summary, monthly, occupancyTrend, performance, expenseByCategory, budgetVsActual, aging, pipeline, bestSelling,
  // shared with alerts / jobs
  occupancyOf, periodMetrics, budgetFor, isOpex, isActiveLease, openWo, countedUnits, isOccupied, isDate,
};
