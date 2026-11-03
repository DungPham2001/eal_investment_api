/** Alerts (spec 6.3), work queue and timeline (6.4). Muting alerts stays on the device (`?muted=lease,rent` is honoured). */
const E = require('../models/enums');
const { History } = require('../models/system');
const { round, sum, money } = require('../lib/util');
const { addDays, diffDays, day5, monthStart, monthsIn, isDate } = require('../lib/dates');
const { invalid } = require('../utils/AppError');
const { scopeOf, load } = require('./data');
const { isOpex, isActiveLease, openWo, budgetFor } = require('./analytics');

/** Records edited >= 5 times in the last 60 minutes. */
async function unusualEdits({ minutes = 60, min = 5 } = {}) {
  const since = new Date(Date.now() - minutes * 60000);
  const rows = await History.aggregate([
    { $match: { action: 'update', at: { $gte: since } } },
    { $sort: { at: -1 } },
    { $group: { _id: { module: '$module', recId: '$recId' }, count: { $sum: 1 }, label: { $first: '$label' }, lastAt: { $first: '$at' }, by: { $addToSet: '$by' } } },
    { $match: { count: { $gte: min } } },
    { $sort: { count: -1, lastAt: -1 } },
  ]);
  return rows.map((r) => ({ module: r._id.module, recId: r._id.recId, label: r.label, count: r.count, lastAt: r.lastAt, by: r.by }));
}

async function buildAlerts(q = {}) {
  const scope = await scopeOf(q);
  const t = scope.at;
  const d = await load(scope, ['units', 'leases', 'rents', 'workorders', 'loans', 'expenses', 'budgets']);
  const out = [];
  const push = (a) => out.push(a);

  const leases = d.leases.filter((l) => isActiveLease(l) && l.end >= t && l.end <= addDays(t, 60));
  if (leases.length) push({ key: 'lease', title: `${leases.length} lease(s) expiring soon`, subtitle: 'Within the next 60 days', severity: 'warning', module: 'leases', count: leases.length });

  const vacant = d.units.filter((u) => u.status === 'Vacant' && u.vacantSince && diffDays(u.vacantSince, t) > 30);
  if (vacant.length) push({ key: 'vacant', title: `${vacant.length} unit(s) vacant over 30 days`, subtitle: 'Consider adjusting the rent or marketing', severity: 'info', module: 'units', count: vacant.length });

  const overdue = d.rents.filter((r) => r.status === 'Overdue');
  if (overdue.length) {
    const amount = round(sum(overdue, (r) => Math.max(0, r.due - (r.paid || 0))));
    push({ key: 'rent', title: `Overdue rent ${money(amount)}`, subtitle: `${new Set(overdue.map((r) => r.unit)).size} unit(s)`, severity: 'danger', module: 'rents', amount, count: overdue.length });
  }

  const open = d.workorders.filter(openWo);
  const urgent = open.filter((w) => w.priority === 'Urgent').length;
  const late = open.filter((w) => w.dueDate && w.dueDate < t).length;
  if (urgent || late) push({ key: 'wo', title: `${urgent} urgent · ${late} overdue work order(s)`, subtitle: 'Open work orders', severity: 'danger', module: 'workorders', count: urgent + late });

  const loans = d.loans.filter((l) => l.status !== 'Paid Off' && l.maturity && l.maturity <= addDays(t, 365));
  if (loans.length) push({ key: 'loan', title: `${loans.length} loan(s) maturing within 12 months`, subtitle: 'Prepare to refinance or pay off', severity: 'warning', module: 'loans', count: loans.length });

  const year = t.slice(0, 4);
  const ytd = { from: `${year}-01-01`, to: t };
  const opexYtd = sum(d.expenses.filter((x) => isOpex(x) && x.date >= ytd.from && x.date <= ytd.to), (x) => x.amount);
  const budgetYtd = budgetFor(d.budgets, { from: ytd.from, to: monthsIn(ytd.from, t).slice(-1)[0] });
  if (budgetYtd > 0 && opexYtd > budgetYtd * 1.1) {
    const over = Math.round((opexYtd / budgetYtd - 1) * 100);
    push({ key: 'budget', title: `Expenses are ${over}% over budget`, subtitle: `Year to date ${year}: ${money(opexYtd)} / ${money(budgetYtd)}`, severity: 'warning', module: 'expenses', percent: over });
  }
  const m = monthStart(t);
  const opexMonth = sum(d.expenses.filter((x) => isOpex(x) && x.date >= m && x.date <= t), (x) => x.amount);
  const budgetMonth = budgetFor(d.budgets, { from: m, to: m });
  if (budgetMonth > 0 && opexMonth > budgetMonth * 1.1) {
    const over = Math.round((opexMonth / budgetMonth - 1) * 100);
    push({ key: 'budget_m', title: `Expenses this month are ${over}% over budget`, subtitle: `${money(opexMonth)} / ${money(budgetMonth)}`, severity: 'info', module: 'expenses', percent: over });
  }

  const unusual = await unusualEdits();
  if (unusual.length) push({ key: 'unusual', title: `${unusual.length} record(s) with unusual edit activity`, subtitle: '≥ 5 edits within 60 minutes', severity: 'warning', module: 'history', count: unusual.length });

  const muted = new Set(typeof q.muted === 'string' ? q.muted.split(',').map((s) => s.trim()) : []);
  return out.filter((a) => !muted.has(a.key));
}

// ---- queue (6.4) -----------------------------------------------------------------------------------
const WEIGHT = { tasks: { Urgent: 3, High: 2, Normal: 1 }, workorders: { Urgent: 4, High: 2, Normal: 1 } };

async function names(scope) {
  const d = await load(scope, ['properties', 'units', 'renovations', 'deals']);
  const map = (rows, f) => new Map(rows.map((r) => [r._id, r[f]]));
  return { prop: map(d.properties, 'name'), unit: map(d.units, 'code'), reno: map(d.renovations, 'name'), deal: map(d.deals, 'name') };
}

async function buildQueue(q = {}) {
  const scope = await scopeOf(q);
  const t = scope.at;
  const n = await names(scope);
  const d = await load(scope, ['tasks', 'workorders', 'leases', 'rents', 'loans', 'vendors', 'milestones', 'checklist']);
  const items = [];

  for (const x of d.tasks.filter((r) => r.status !== 'Done' && r.due <= addDays(t, 14))) {
    items.push({ module: 'tasks', recordId: x._id, due: x.due, title: x.title, subtitle: x.related || x.owner || null, reason: x.due < t ? 'Overdue task' : 'Task due soon', weight: WEIGHT.tasks[x.priority] || 1, quick: { field: 'status', value: 'Done' }, postponeField: 'due' });
  }
  for (const x of d.workorders.filter((r) => openWo(r) && (r.priority === 'Urgent' || (r.dueDate && r.dueDate <= addDays(t, 7))))) {
    items.push({ module: 'workorders', recordId: x._id, due: x.dueDate, title: x.title, subtitle: [n.prop.get(x.property), n.unit.get(x.unit)].filter(Boolean).join(' · ') || null, reason: x.priority === 'Urgent' ? 'Urgent maintenance' : x.dueDate < t ? 'Overdue maintenance' : 'Maintenance due soon', weight: WEIGHT.workorders[x.priority] || 1, quick: { field: 'status', value: 'Completed' }, postponeField: 'dueDate' });
  }
  for (const x of d.leases.filter((r) => isActiveLease(r) && r.end <= addDays(t, 60))) {
    items.push({ module: 'leases', recordId: x._id, due: x.end, title: `Lease ${n.unit.get(x.unit) || ''} expires`.replace('  ', ' '), subtitle: n.prop.get(x.property) || null, reason: 'Lease expiring soon', weight: 2 });
  }
  for (const x of d.rents.filter((r) => r.status === 'Overdue')) {
    items.push({ module: 'rents', recordId: x._id, due: day5(x.month), title: `Rent ${n.unit.get(x.unit) || ''} balance due ${money(x.due - (x.paid || 0))}`, subtitle: n.prop.get(x.property) || null, reason: 'Overdue rent', weight: 3 });
  }
  for (const x of d.loans.filter((r) => r.status !== 'Paid Off')) {
    const sub = [x.lender, n.prop.get(x.property)].filter(Boolean).join(' · ');
    if (x.maturity && x.maturity <= addDays(t, 90)) items.push({ module: 'loans', recordId: x._id, due: x.maturity, title: 'Loan maturity', subtitle: sub, reason: 'Loan maturity', weight: 2 });
    if (x.rateReset && x.rateReset <= addDays(t, 90)) items.push({ module: 'loans', recordId: x._id, due: x.rateReset, title: 'Rate reset', subtitle: sub, reason: 'Rate reset', weight: 2 });
  }
  for (const x of d.vendors.filter((r) => r.status === 'Active')) {
    if (x.licenseExp && x.licenseExp <= addDays(t, 45)) items.push({ module: 'vendors', recordId: x._id, due: x.licenseExp, title: `${x.company} license expires`, subtitle: x.service, reason: 'Vendor license', weight: 1 });
    if (x.insuranceExp && x.insuranceExp <= addDays(t, 45)) items.push({ module: 'vendors', recordId: x._id, due: x.insuranceExp, title: `${x.company} insurance expires`, subtitle: x.service, reason: 'Vendor insurance', weight: 1 });
  }
  for (const x of d.milestones.filter((r) => r.status !== 'Done' && r.due <= addDays(t, 14))) {
    items.push({ module: 'milestones', recordId: x._id, due: x.due, title: x.title, subtitle: n.reno.get(x.renovation) || null, reason: 'Milestones', weight: 1, quick: { field: 'status', value: 'Done' }, postponeField: 'due' });
  }
  for (const x of d.checklist.filter((r) => r.status === 'Issue Found')) {
    items.push({ module: 'checklist', recordId: x._id, due: t, title: `${x.item}: issue found`, subtitle: n.deal.get(x.deal) || null, reason: 'Due diligence issue', weight: 2 });
  }
  return items.sort((a, b) => b.weight - a.weight || String(a.due).localeCompare(String(b.due)));
}

// ---- timeline (6.4) --------------------------------------------------------------------------------
async function buildTimeline(q = {}) {
  const scope = await scopeOf(q);
  const from = q.from || scope.at;
  const to = q.to || addDays(from, 90);
  if (!isDate(from)) throw invalid({ from: 'Invalid date (format YYYY-MM-DD)' });
  if (!isDate(to) || to < from) throw invalid({ to: 'Invalid date or before "from"' });
  const n = await names(scope);
  const d = await load(scope, ['leases', 'loans', 'workorders', 'renovations', 'vendors', 'milestones', 'tasks']);
  const ev = [];
  const add = (date, module, recordId, kind, title, subtitle, propertyId = null) => {
    if (date && date >= from && date <= to) ev.push({ date, module, recordId, kind, title, subtitle: subtitle || null, propertyId });
  };
  for (const x of d.leases.filter(isActiveLease)) add(x.end, 'leases', x._id, 'lease_end', `Lease ends ${n.unit.get(x.unit) || ''}`.trim(), n.prop.get(x.property), x.property);
  for (const x of d.loans.filter((r) => r.status !== 'Paid Off')) {
    add(x.maturity, 'loans', x._id, 'loan_maturity', `${x.lender} loan maturity`, n.prop.get(x.property), x.property);
    add(x.rateReset, 'loans', x._id, 'rate_reset', `${x.lender} rate reset`, n.prop.get(x.property), x.property);
  }
  for (const x of d.workorders.filter(openWo)) add(x.dueDate, 'workorders', x._id, 'wo_due', x.title, n.prop.get(x.property), x.property);
  for (const x of d.renovations.filter((r) => r.status !== 'Completed')) add(x.eta, 'renovations', x._id, 'reno_eta', `${x.name} completion`, n.prop.get(x.property), x.property);
  if (!scope.propertyIds) {
    for (const x of d.vendors) {
      add(x.licenseExp, 'vendors', x._id, 'license_exp', `${x.company} license expires`, x.service);
      add(x.insuranceExp, 'vendors', x._id, 'insurance_exp', `${x.company} insurance expires`, x.service);
    }
    for (const x of d.tasks.filter((r) => r.status !== 'Done')) add(x.due, 'tasks', x._id, 'task_due', x.title, x.related);
  }
  for (const x of d.milestones.filter((r) => r.status !== 'Done')) add(x.due, 'milestones', x._id, 'milestone_due', x.title, n.reno.get(x.renovation));
  return { from, to, items: ev.sort((a, b) => a.date.localeCompare(b.date)) };
}

module.exports = { buildAlerts, buildQueue, buildTimeline, unusualEdits };
