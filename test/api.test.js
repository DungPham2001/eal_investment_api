const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { start, stop, reset, api, create } = require('./helpers');
const { today, addDays, addMonths, monthStart } = require('../src/lib/dates');
const { rentStatus } = require('../src/services/rents');

before(start);
after(stop);
beforeEach(reset);

const T = today();
const M0 = monthStart(T);

async function seedProperty(extra = {}) {
  const property = await create('properties', { name: 'Biscayne Gardens', type: 'Multifamily', status: 'Owned', city: 'North Miami', zip: '33181', units: 24, value: 5200000, purchasePrice: 4000000, ...extra });
  const unit = await create('units', { code: 'A-101', property: property.id, type: '1 Bedroom', status: 'Occupied', rent: 1850 });
  return { property, unit };
}

test('properties: validation, guard, create, If-Match, no-op patch, conflict, list', async () => {
  const bad = (await api.post('properties', { name: '', type: 'Sai', city: 'Miami', zip: '123' }).expect(422)).body;
  assert.equal(bad.code, 'VALIDATION_ERROR');
  assert.equal(bad.fields.name, 'Required');
  assert.match(bad.fields.type, /^Invalid value/);
  assert.equal(bad.fields.zip, 'ZIP code must be 5 digits');
  assert.match(bad.message, /: /);

  const base = { name: 'Biscayne Gardens', type: 'Multifamily', status: 'Owned', city: 'North Miami', zip: '33181' };
  const ssn = (await api.post('properties', { ...base, note: 'SSN 123-45-6789' }).expect(422)).body;
  assert.equal(ssn.code, 'SENSITIVE_DATA');
  assert.equal(ssn.fields.note, 'Contains what looks like a Social Security number — not allowed.');
  assert.equal((await api.post('properties', { ...base, owner: 'linh@eal.com' }).expect(422)).body.fields.owner, 'This field does not accept email addresses.');
  assert.equal((await api.post('properties', { ...base, note: 'call (305) 555-1234' }).expect(422)).body.fields.note, 'This field does not accept phone numbers.');
  assert.equal((await api.post('properties', { ...base, note: '4242 4242 4242 4242' }).expect(422)).body.fields.note, 'Contains what looks like a payment card number — not allowed.');
  assert.equal((await api.post('properties', { ...base, note: 'tk 123456789012' }).expect(422)).body.fields.note, 'Contains a long number that looks like an account number — not allowed.');

  const res = await api.post('properties', { ...base, address: '', value: 5200000.456, version: 99, createdBy: 'hacker' }).expect(201);
  const p = res.body;
  assert.equal(res.headers.etag, '"1"');
  assert.equal(p.version, 1);
  assert.equal(p.createdBy, 'Linda Carter');
  assert.equal(p.address, null);
  assert.equal(p.value, 5200000.46);
  assert.equal(p.portfolio, null);

  assert.equal((await api.patch(`properties/${p.id}`, { city: 'Miami' }).expect(428)).body.code, 'PRECONDITION_REQUIRED');
  const same = (await api.patch(`properties/${p.id}`, { city: 'North Miami' }, 1).expect(200)).body;
  assert.equal(same.version, 1, 'no real change -> version stays');
  const upd = (await api.patch(`properties/${p.id}`, { city: 'Miami', status: 'For Sale' }, 1).expect(200)).body;
  assert.equal(upd.version, 2);
  const conflict = (await api.patch(`properties/${p.id}`, { city: 'Tampa' }, 1).expect(409)).body;
  assert.equal(conflict.code, 'VERSION_CONFLICT');
  assert.equal(conflict.current.city, 'Miami');
  await api.patch(`properties/${p.id}`, { portfolio: 'nope' }, 2).expect(422);

  await create('properties', { ...base, name: 'Coral Plaza', type: 'Commercial', value: 9000000 });
  await create('properties', { ...base, name: 'Lot 7', type: 'Land', value: 300000 });
  const sorted = (await api.get('properties?sort=-value').expect(200)).body;
  assert.deepEqual(sorted.items.map((x) => x.name), ['Coral Plaza', 'Biscayne Gardens', 'Lot 7']);
  assert.equal(sorted.total, 3);
  const filtered = (await api.get(`properties?type=${encodeURIComponent('Commercial,Land')}&q=lot`).expect(200)).body;
  assert.deepEqual(filtered.items.map((x) => x.name), ['Lot 7']);
  const p1 = (await api.get('properties?limit=2&sort=name').expect(200)).body;
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = (await api.get(`properties?limit=2&sort=name&cursor=${p1.nextCursor}`).expect(200)).body;
  assert.deepEqual(p2.items.map((x) => x.name), ['Lot 7']);
  assert.equal(p2.nextCursor, null);
  assert.equal((await api.get('properties?all=true').expect(200)).body.items.length, 3);
  await api.get('properties?sort=bogus').expect(422);

  const dup = (await api.post(`properties/${p.id}/duplicate`).expect(201)).body;
  assert.equal(dup.name, 'Biscayne Gardens (copy)');
  assert.equal(dup.version, 1);
});

test('vendors / partners: company contact fields accept phone & email, still refuse SSN', async () => {
  const v = await create('vendors', { company: 'Sun Electric', service: 'Electrical', status: 'Active', phone: '+1 305 555 0101', email: 'Office@SunElectric.com', ratePrice: 4, rateTime: 5, rateQuality: 3 });
  assert.equal(v.email, 'office@sunelectric.com');
  await api.post('vendors', { company: 'X', service: 'Electrical', status: 'Active', phone: '123-45-6789' }).expect(422);
  await api.post('vendors', { company: 'X', service: 'Electrical', status: 'Active', ratePrice: 7 }).expect(422);
  await api.post('partners', { company: 'Bank', kind: 'Broker', website: 'ftp://x' }).expect(422);
  await create('partners', { company: 'Bank', kind: 'Bank & Lender', website: 'https://bank.example', email: 'loans@bank.example' });
});

test('server rules: leases.property, rents month/status/gap, workorders, expenses, revenue, deals, targets', async () => {
  const { property, unit } = await seedProperty();
  const lease = await create('leases', { unit: unit.id, kind: 'Annual', status: 'Active', start: addDays(T, -300), end: addDays(T, 65), rent: 1850, property: 'ignored' });
  assert.equal(lease.property, property.id);
  await api.post('leases', { unit: unit.id, kind: 'Annual', status: 'Active', start: T, end: addDays(T, -1), rent: 1 }).expect(422);
  await api.post('leases', { unit: 'missing', kind: 'Annual', status: 'Active', start: T, end: T, rent: 1 }).expect(422);

  const rent = await create('rents', { unit: unit.id, month: `${M0.slice(0, 8)}17`, due: 1850, paid: 500, status: 'Paid in Full' });
  assert.equal(rent.month, M0);
  assert.equal(rent.property, property.id);
  assert.equal(rent.gap, 1350);
  assert.equal(rent.status, rentStatus({ due: 1850, paid: 500, month: M0 }));
  assert.equal((await api.post('rents', { unit: unit.id, month: M0, due: 100 }).expect(409)).body.code, 'DUPLICATE');
  const paid = (await api.patch(`rents/${rent.id}`, { paid: 1850 }, 1).expect(200)).body;
  assert.equal(paid.status, 'Paid in Full');
  assert.equal(paid.gap, 0);

  const wo = await create('workorders', { title: 'Water leak', property: property.id, unit: unit.id, category: 'Plumbing', priority: 'High', status: 'Completed', dueDate: T });
  assert.equal(wo.doneDate, T);
  const other = await create('properties', { name: 'Other', type: 'Land', status: 'Owned', city: 'Miami', zip: '33101' });
  await api.post('workorders', { title: 'x', property: other.id, unit: unit.id, category: 'Plumbing', priority: 'High', status: 'New', dueDate: T }).expect(422);

  const exp = await create('expenses', { property: property.id, category: 'Capital Improvements', nature: 'Operating', amount: 1000, date: T });
  assert.equal(exp.nature, 'Capital');

  const rev = await create('revenue', { property: property.id, kind: 'Rent', month: T, amount: 1850, source: 'Auto from Rent Collection' });
  assert.equal(rev.month, M0);
  assert.equal(rev.source, 'Manual Entry');

  const deal = await create('deals', { name: 'Hialeah 12', side: 'Buy', stage: 'Analysis', ask: 1210000, noi: 78650, property: property.id });
  assert.equal(deal.cap, 6.5);
  assert.equal(deal.property, null);
  const offer = (await api.patch(`deals/${deal.id}`, { offer: 1100000 }, 1).expect(200)).body;
  assert.equal(offer.cap, 7.15);

  const year = await create('targets', { period: 'Year', year: 2026, index: 3, revenue: 1, noi: -1 });
  assert.equal(year.index, null);
  await api.post('targets', { period: 'Quarter', year: 2026, index: 5, revenue: 1, noi: 1 }).expect(422);

  const sale = await create('sales', { property: property.id, kind: 'Unit Lease', date: T, product: '1 Bedroom', value: 22200 });
  assert.equal(sale.qty, 1);

  const sc = await create('scenarios', { name: 'Hialeah base', tool: 'Rental Property Purchase Analysis', values: '{"price":1210000,"rate":6.5,"big":1234567890}' });
  assert.equal(sc.values, '{"price":1210000,"rate":6.5,"big":1234567890}');

  const expanded = (await api.get(`leases?expand=unit,property&q=A-101`).expect(200)).body.items[0];
  assert.equal(expanded.unitCode, 'A-101');
  assert.equal(expanded.propertyName, 'Biscayne Gardens');
});

test('rent status rule (spec 4)', () => {
  const m = '2026-10-01';
  assert.equal(rentStatus({ due: 100, paid: 100, month: m }, '2026-10-01'), 'Paid in Full');
  assert.equal(rentStatus({ due: 100, paid: 0, month: m }, '2026-10-05'), 'Unpaid');
  assert.equal(rentStatus({ due: 100, paid: 0, month: m }, '2026-10-06'), 'Overdue');
  assert.equal(rentStatus({ due: 100, paid: 50, month: m }, '2026-10-03'), 'Partially Paid');
  assert.equal(rentStatus({ due: 100, paid: 50, month: m }, '2026-11-05'), 'Partially Paid');
  assert.equal(rentStatus({ due: 100, paid: 50, month: m }, '2026-11-06'), 'Overdue');
});

test('stored rent statuses are refreshed before lists', async () => {
  const { unit } = await seedProperty();
  const r = await create('rents', { unit: unit.id, month: addMonths(M0, -2), due: 1000, paid: 0 });
  await mongoose.connection.db.collection('rents').updateOne({ _id: r.id }, { $set: { status: 'Unpaid' } });
  const list = (await api.get(`rents?status=${encodeURIComponent('Overdue')}`).expect(200)).body;
  assert.equal(list.items.length, 1);
});

test('generate rents of this month + renew lease', async () => {
  const { unit } = await seedProperty();
  const lease = await create('leases', { unit: unit.id, kind: 'Annual', status: 'Active', start: '2025-12-01', end: '2026-11-30', rent: 1850 });
  await create('leases', { unit: unit.id, kind: 'Annual', status: 'Expired', start: '2024-12-01', end: '2025-11-30', rent: 1700 });
  assert.equal((await api.post('rents:generateThisMonth').expect(200)).body.created, 1);
  assert.equal((await api.post('rents%3AgenerateThisMonth').expect(200)).body.created, 0, 'idempotent per unit+month');
  const rows = (await api.get('rents').expect(200)).body.items;
  assert.equal(rows[0].due, 1850);
  assert.equal(rows[0].month, M0);

  const out = (await api.post(`leases/${lease.id}:renew`, {}).expect(201)).body;
  assert.equal(out.lease.status, 'Upcoming');
  assert.equal(out.lease.start, '2026-12-01');
  assert.equal(out.lease.end, '2027-11-30');
  assert.equal(out.lease.prev, lease.id);
  assert.equal(out.previous.status, 'Renewed');
  assert.equal((await api.post(`leases/${lease.id}:renew`, {}).expect(409)).body.code, 'INVALID_STATE');
});

test('cascade delete, impact preview, unlink, history cleanup, sales kept', async () => {
  const portfolio = await create('portfolios', { name: 'Miami core', strategy: 'Stable Cash Flow' });
  const { property, unit } = await seedProperty({ portfolio: portfolio.id });
  const vendor = await create('vendors', { company: 'Sun Electric', service: 'Electrical', status: 'Active' });
  const lease = await create('leases', { unit: unit.id, kind: 'Annual', status: 'Active', start: '2026-01-01', end: '2026-12-31', rent: 1850 });
  await create('rents', { unit: unit.id, month: M0, due: 1850 });
  const wo = await create('workorders', { title: 'Electrical', property: property.id, unit: unit.id, vendor: vendor.id, category: 'Electrical', priority: 'Normal', status: 'New', dueDate: T });
  const reno = await create('renovations', { name: 'Repaint', property: property.id, status: 'Planned', budget: 10000, vendor: vendor.id });
  await create('milestones', { title: 'Paint done', renovation: reno.id, due: T, status: 'Pending' });
  const sale = await create('sales', { property: property.id, kind: 'Acquisition', date: T, product: 'Whole Property', qty: 1, value: 4000000 });
  const deal = await create('deals', { name: 'Sell Biscayne', side: 'Sell', stage: 'Screening', property: property.id });

  // unit delete: leases + rents go, workorder.unit -> null
  const impactUnit = (await api.get(`units/${unit.id}/impact`).expect(200)).body;
  assert.deepEqual(impactUnit.counts.removed, { leases: 1, rents: 1 });
  assert.deepEqual(impactUnit.unlinked.map((u) => [u.module, u.field]), [['workorders', 'unit']]);

  // vendor delete unlinks workorders + renovations
  await api.del(`vendors/${vendor.id}`).expect(204);
  const wo2 = (await api.get(`workorders/${wo.id}`).expect(200)).body;
  assert.equal(wo2.vendor, null);
  assert.equal(wo2.version, wo.version + 1);

  const impact = (await api.get(`properties/${property.id}/impact`).expect(200)).body;
  assert.deepEqual(impact.counts.removed, { units: 1, leases: 1, workorders: 1, renovations: 1, rents: 1, milestones: 1 });
  assert.deepEqual(impact.unlinked.map((u) => u.module), ['deals']);
  assert.ok(impact.removed.find((r) => r.module === 'units').label === 'A-101');

  await api.del(`properties/${property.id}`).expect(204);
  await api.get(`leases/${lease.id}`).expect(404);
  assert.equal((await api.get('rents').expect(200)).body.total, 0);
  assert.equal((await api.get('milestones').expect(200)).body.total, 0);
  assert.equal((await api.get(`sales/${sale.id}`).expect(200)).body.property, property.id, 'sales keep the property id');
  assert.equal((await api.get(`deals/${deal.id}`).expect(200)).body.property, null);
  assert.ok((await api.get(`portfolios/${portfolio.id}`).expect(200)).body);

  const hist = (await api.get('history?limit=200').expect(200)).body.items;
  assert.equal(hist.filter((h) => ['units', 'leases', 'rents', 'workorders', 'renovations', 'milestones'].includes(h.module)).length, 0);
  const del = hist.filter((h) => h.action === 'delete');
  assert.deepEqual(del.map((h) => [h.module, h.label]), [['properties', 'property'], ['vendors', 'vendor']]);
  await api.del(`properties/${property.id}`).expect(404);
});

test('history: changes, record history, revert, unusual edits', async () => {
  const { property } = await seedProperty();
  let v = 1;
  for (const city of ['A', 'B', 'C', 'D', 'E']) {
    v = (await api.patch(`properties/${property.id}`, { city }, v).expect(200)).body.version;
  }
  const rec = (await api.get(`properties/${property.id}/history`).expect(200)).body.items;
  assert.equal(rec.length, 6);
  assert.equal(rec[0].action, 'update');
  assert.deepEqual(rec[0].changes, { city: ['D', 'E'] });
  assert.equal(rec[0].by, 'Linda Carter');
  assert.equal(rec[0].label, 'Biscayne Gardens');

  const reverted = (await api.post(`history/${rec[0].id}:revert`).expect(200)).body;
  assert.equal(reverted.city, 'D');
  assert.equal(reverted.version, 7);
  assert.equal((await api.get(`properties/${property.id}/history`).expect(200)).body.items[0].action, 'restore');
  const create0 = rec.find((h) => h.action === 'create');
  assert.equal((await api.post(`history/${create0.id}:revert`).expect(409)).body.code, 'INVALID_STATE');

  const unusual = (await api.get('history/unusual').expect(200)).body;
  assert.equal(unusual[0].recId, property.id);
  assert.equal(unusual[0].count, 5);
  assert.ok((await api.get('alerts').expect(200)).body.find((a) => a.key === 'unusual'));

  const filtered = (await api.get(`history?module=properties&action=update&limit=2`).expect(200)).body;
  assert.equal(filtered.items.length, 2);
  assert.equal(filtered.total, 5);
  assert.ok(filtered.nextCursor);
});

test('closed period lock (423), create into closed period refused', async () => {
  const { property } = await seedProperty();
  const old = addMonths(M0, -4);
  await api.post('expenses', { property: property.id, category: 'Insurance', nature: 'Operating', amount: 10, date: old }).expect(423);
  const exp = await create('expenses', { property: property.id, category: 'Insurance', nature: 'Operating', amount: 10, date: T });
  const moved = (await api.patch(`expenses/${exp.id}`, { date: old }, 1).expect(423)).body;
  assert.equal(moved.code, 'PERIOD_LOCKED');
  await mongoose.connection.db.collection('expenses').updateOne({ _id: exp.id }, { $set: { date: old } });
  assert.equal((await api.patch(`expenses/${exp.id}`, { amount: 20 }, 1).expect(423)).body.message, 'This period is closed and cannot be edited or deleted.');
  await api.del(`expenses/${exp.id}`).expect(423);
  await api.post('expenses:bulkDelete', { ids: [exp.id] }).expect(423);
  const cfg = (await api.get('config').expect(200)).body;
  assert.equal(cfg.closedBefore, addMonths(M0, -3));
  assert.deepEqual(cfg.deleteLimit, { perWindow: null, windowMinutes: null, bulkMax: null });
  assert.equal(cfg.exportPerDay, null);
});

test('no limits: bulk delete any number of ids, delete as often as wanted', async () => {
  const ids = [];
  for (let i = 0; i < 75; i++) ids.push((await create('tasks', { title: `T${i}`, due: T, priority: 'Normal', status: 'To Do' })).id);
  const ok = (await api.post('tasks:bulkDelete', { ids: [...ids.slice(0, 70), 'missing'] }).expect(200)).body;
  assert.equal(ok.deleted, 70);
  assert.deepEqual(ok.missing, ['missing']);
  for (const id of ids.slice(70)) await api.del(`tasks/${id}`).expect(204);
  assert.equal((await api.get('tasks').expect(200)).body.total, 0);
  await api.post('tasks:bulkDelete', { ids: [] }).expect(422);

  for (let i = 0; i < 60; i++) await create('tasks', { title: `L${i}`, due: T, priority: 'Normal', status: 'To Do' });
  assert.equal((await api.get('tasks?limit=500').expect(200)).body.items.length, 60);
  const all = (await api.get('tasks?all=true').expect(200)).body;
  assert.equal(all.items.length, 60);
  assert.equal(all.nextCursor, null);
});

test('bulkCreate (CSV import) reports per row', async () => {
  const { property } = await seedProperty();
  const body = { items: [
    { code: 'B-1', property: property.id, type: 'Studio', status: 'Vacant', rent: 1200 },
    { code: 'B-2', property: property.id, type: 'Studio', status: 'Vacant' },
    { code: 'B-3', property: property.id, type: 'Studio', status: 'Vacant', rent: 1300, note: 'a@b.com' },
    { code: 'A-101', property: property.id, type: 'Studio', status: 'Vacant', rent: 1 },
  ] };
  const r = (await api.post('units:bulkCreate', body).expect(201)).body;
  assert.equal(r.created, 1);
  assert.deepEqual(r.results.map((x) => x.error?.code || 'ok'), ['ok', 'VALIDATION_ERROR', 'SENSITIVE_DATA', 'DUPLICATE']);
  assert.equal(r.results[1].index, 1);
  assert.equal(r.results[1].error.fields.rent, 'Required');
  await api.post('tasks:bulkCreate', { items: [{}] }).expect(422);
});

test('analytics: summary, monthly, performance, aging, pipeline, best-selling, queue, timeline', async () => {
  const { property, unit } = await seedProperty();
  await create('units', { code: 'A-102', property: property.id, type: 'Studio', status: 'Vacant', rent: 1500, vacantSince: addDays(T, -45) });
  await create('units', { code: 'A-103', property: property.id, type: 'Studio', status: 'Off Market', rent: 900 });
  await create('leases', { unit: unit.id, kind: 'Annual', status: 'Active', start: addDays(T, -300), end: addDays(T, 30), rent: 1800 });
  await create('revenue', { property: property.id, kind: 'Rent', month: T, amount: 1800 });
  await create('revenue', { property: property.id, kind: 'Parking Fees', month: T, amount: 200 });
  await create('expenses', { property: property.id, category: 'Insurance', nature: 'Operating', amount: 500, date: T });
  await create('expenses', { property: property.id, category: 'Loan Interest', nature: 'Operating', amount: 999, date: T });
  await create('expenses', { property: property.id, category: 'Capital Improvements', nature: 'Capital', amount: 3000, date: T });
  await create('budgets', { property: property.id, year: Number(T.slice(0, 4)), category: 'Insurance', amount: 1200 });
  await create('loans', { property: property.id, lender: 'Bank', status: 'Current', principal: 100000, balance: 80000, rate: 6.5, maturity: addDays(T, 200), payment: 100 });
  await create('rents', { unit: unit.id, month: addMonths(M0, -2), due: 1800, paid: 800 });
  await create('deals', { name: 'D1', side: 'Buy', stage: 'Analysis', ask: 1000 });
  await create('sales', { property: property.id, kind: 'Unit Lease', date: T, product: 'Studio', qty: 2, value: 3000 });
  await create('sales', { property: property.id, kind: 'Lease Renewal', date: addDays(T, -100), product: 'Studio', qty: 5, value: 1 });
  await create('tasks', { title: 'Call tenant', due: addDays(T, -1), priority: 'Urgent', status: 'To Do' });

  const s = (await api.get('analytics/summary?period=month').expect(200)).body;
  assert.equal(s.unitCount, 3);
  assert.equal(s.occupancy, 50);
  assert.equal(s.listedRent, 3350);
  assert.equal(s.actualRent, 1800);
  assert.equal(s.revenue, 2000);
  assert.equal(s.rentRevenue, 1800);
  assert.equal(s.otherRevenue, 200);
  assert.equal(s.opex, 500);
  assert.equal(s.capex, 3000);
  assert.equal(s.noi, 1500);
  assert.equal(s.budget, 100);
  assert.equal(s.totalDebt, 80000);
  assert.equal(s.debtService, 1200);
  assert.deepEqual(s.overdue, { amount: 1000, units: 1 });
  assert.equal(s.openDeals, 1);
  assert.equal(s.tasksOverdue, 1);
  assert.equal(s.leasesExpiring60, 1);
  assert.ok(s.previous.range.to < s.range.from);

  const monthly = (await api.get('analytics/monthly?n=3').expect(200)).body;
  assert.equal(monthly.length, 3);
  assert.equal(monthly[2].month, M0);
  assert.equal(monthly[2].noi, 1500);

  const perf = (await api.get('analytics/performance?period=year').expect(200)).body[0];
  assert.equal(perf.propertyId, property.id);
  assert.equal(perf.dscr, 1.25);
  assert.equal(perf.cashFlow, 300);

  const byCat = (await api.get('analytics/expense-by-category?period=month').expect(200)).body;
  assert.deepEqual(Object.keys(byCat), ['Capital Improvements', 'Loan Interest', 'Insurance']);
  const bva = (await api.get('analytics/budget-vs-actual').expect(200)).body;
  assert.deepEqual(bva.find((r) => r.category === 'Insurance'), { category: 'Insurance', budget: 1200, actual: 500 });
  const aging = (await api.get('analytics/aging').expect(200)).body;
  assert.equal(Object.values(aging).reduce((a, b) => a + b, 0), 1000);
  assert.equal((await api.get('analytics/pipeline').expect(200)).body.find((p) => p.stage === 'Analysis').buy.count, 1);
  const trend = (await api.get('analytics/occupancy-trend?n=3').expect(200)).body;
  assert.equal(trend[2].occupancy, 50);

  const best = (await api.get('analytics/best-selling?period=month&groupBy=property').expect(200)).body;
  assert.equal(best.items[0].qty, 2, 'sale 100 days ago is outside the 30-day window');
  assert.equal(best.items[0].title, 'Biscayne Gardens');
  assert.equal(best.items[0].subtitle, 'Multifamily · North Miami');
  const bestYear = (await api.get('analytics/best-selling?period=year&groupBy=product').expect(200)).body;
  assert.deepEqual(bestYear.items[0].byKind, { 'Unit Lease': 2, 'Lease Renewal': 5 });
  await api.get('analytics/summary?period=week').expect(422);

  const alerts = (await api.get('alerts').expect(200)).body.map((a) => a.key);
  for (const k of ['lease', 'vacant', 'rent', 'loan']) assert.ok(alerts.includes(k), k);
  assert.ok(!(await api.get('alerts?muted=rent').expect(200)).body.find((a) => a.key === 'rent'));

  const queue = (await api.get('queue').expect(200)).body;
  assert.deepEqual(queue.slice(0, 2).map((x) => [x.module, x.weight]), [['rents', 3], ['tasks', 3]]);
  assert.deepEqual(queue.find((x) => x.module === 'tasks').quick, { field: 'status', value: 'Done' });
  const timeline = (await api.get(`timeline?from=${T}&to=${addDays(T, 365)}`).expect(200)).body;
  assert.deepEqual(timeline.items.map((e) => e.kind).sort(), ['lease_end', 'loan_maturity']);

  const job = (await api.get('jobs/daily').expect(200)).body;
  assert.equal(job.occupancySnapshots, 1);
});

test('config, company, legal, exports quota, reports, idempotency', async () => {
  const company = (await api.get('company').expect(200)).body;
  assert.equal(company.name, 'EAL INVESTMENT INC.');
  assert.deepEqual((await api.get('legal/terms').expect(200)).body.sections, []);
  assert.deepEqual((await api.get('content/guides').expect(200)).body, []);
  assert.equal((await api.put('content/guides', []).expect(403)).body.code, 'ADMIN_DISABLED');

  for (let i = 0; i < 25; i++) assert.equal((await api.post('exports:consume').expect(200)).body.left, null);


  const { property } = await seedProperty();
  const rep = (await api.post('reports', { module: 'properties', recId: property.id, reason: 'Inaccurate', detail: 'Wrong value' }).expect(201)).body;
  assert.equal(rep.status, 'Pending Review');
  assert.equal(rep.label, 'Biscayne Gardens');
  assert.equal((await api.patch(`reports/${rep.id}`, { status: 'Resolved' }).expect(200)).body.status, 'Resolved');
  assert.equal((await api.get('reports').expect(200)).body.total, 1);

  const body = { name: 'Core', strategy: 'Development' };
  const a = await api.post('portfolios', body, 'same-key-0001').expect(201);
  const b = await api.post('portfolios', body, 'same-key-0001').expect(201);
  assert.equal(b.headers['idempotent-replay'], 'true');
  assert.equal(a.body.id, b.body.id);
  assert.equal((await api.get('portfolios').expect(200)).body.total, 1);
  assert.equal((await api.get('nope').expect(404)).body.code, 'NOT_FOUND');
  await api.get('me/preferences').expect(404);

  // no identity header at all: everything still works, createdBy = "Anonymous"
  const bare = await require('supertest')(require('../src/app')).post('/v1/portfolios').send({ name: 'No identity' }).expect(201);
  assert.equal(bare.body.createdBy, 'Anonymous');
});
