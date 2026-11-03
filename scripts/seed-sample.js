/**
 * Loads English sample data (free text in English; enum values stay the app's Vietnamese labels) through the API itself (so computed fields, history and statuses are consistent). DEV / DEMO ONLY:
 * the production app shows no sample data (spec 9).
 *   npm run seed:sample            # refuses to run if the database already has records
 *   npm run seed:sample -- --reset # EMPTIES every business collection + history of the database in MONGODB_URI first
 * Dates are relative to today so dashboards, alerts and the queue are populated whenever you run it.
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const app = require('../src/app');
const registry = require('../src/resources');
const { today, addDays, addMonths, monthStart } = require('../src/lib/dates');

const T = today();
const d = (n) => addDays(T, n);
const M = (n) => addMonths(monthStart(T), n);
const Y = Number(T.slice(0, 4));

let base;
let n = 0;
async function call(method, path, body) {
  const res = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'X-Display-Name': 'Sample Data',
      'Idempotency-Key': `seed-${Date.now()}-${n++}`, ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const post = (p, b) => call('POST', p, b ?? {});

async function main() {
  await mongoose.connect(config.mongoUri);
  const collections = [...registry.names(), 'history', 'content_reports', 'occupancy_snapshots', 'idempotency_keys'];
  if (process.argv.includes('--reset')) {
    for (const c of collections) await mongoose.connection.db.collection(c).deleteMany({});
    console.log('business collections emptied');
  } else if (await mongoose.connection.db.collection('properties').countDocuments()) {
    throw new Error('The database already has data. Use  npm run seed:sample -- --reset  to empty it first.');
  }
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  // ---------------------------------------------------------------- portfolios & properties
  const pf = {
    core: await post('portfolios', { name: 'Miami Core Income', strategy: 'Stable Cash Flow', region: 'Miami-Dade', owner: 'Linda Carter' }),
    va: await post('portfolios', { name: 'Broward Value-Add', strategy: 'Value-Add', region: 'Broward', owner: 'Michael Brooks' }),
  };
  const P = {};
  for (const [k, body] of Object.entries({
    bg: { name: 'Biscayne Gardens', type: 'Multifamily', status: 'Owned', portfolio: pf.core.id, city: 'North Miami', zip: '33181', yearBuilt: 1998, area: 21600, units: 24, ownership: 'LLC', purchasePrice: 4100000, purchaseDate: '2021-06-15', value: 5200000, owner: 'Linda Carter' },
    cp: { name: 'Coral Plaza', type: 'Commercial', status: 'Owned', portfolio: pf.core.id, city: 'Coral Gables', zip: '33134', address: '2200 Ponce de Leon Blvd', yearBuilt: 2005, area: 18000, units: 6, purchasePrice: 6300000, purchaseDate: '2019-03-01', value: 7400000, owner: 'Linda Carter' },
    hl: { name: 'Hollywood Lakes Duplex', type: 'Single-Family', status: 'Managed', portfolio: pf.va.id, city: 'Hollywood', zip: '33019', yearBuilt: 1972, area: 2400, units: 2, purchasePrice: 690000, purchaseDate: '2023-09-20', value: 820000, owner: 'Michael Brooks' },
    lot: { name: 'Homestead Lot 7', type: 'Land', status: 'For Sale', city: 'Homestead', zip: '33030', address: 'SW 312th St & 187th Ave', area: 43560, purchasePrice: 250000, purchaseDate: '2022-01-10', value: 380000, owner: 'Michael Brooks' },
  })) P[k] = await post('properties', body);

  // ---------------------------------------------------------------- units & leases
  const U = [];
  const unitPlan = [
    [P.bg, 'A-101', '1 Bedroom', 'Occupied', 1850], [P.bg, 'A-102', '2 Bedroom', 'Occupied', 2350], [P.bg, 'A-103', 'Studio', 'Vacant', 1450, d(-42)],
    [P.bg, 'A-201', '1 Bedroom', 'Notice Given', 1900], [P.bg, 'A-202', '2 Bedroom', 'Occupied', 2400], [P.bg, 'A-203', '3 Bedroom', 'Under Repair', 2900],
    [P.cp, 'CP-1', 'Commercial Space', 'Occupied', 8200], [P.cp, 'CP-2', 'Commercial Space', 'Occupied', 6400], [P.cp, 'CP-3', 'Commercial Space', 'Vacant', 5900, d(-12)],
    [P.hl, 'H-A', '2 Bedroom', 'Occupied', 2600], [P.hl, 'H-B', '2 Bedroom', 'Occupied', 2550],
  ];
  for (const [p, code, type, status, rent, vacantSince] of unitPlan) {
    U.push(await post('units', { code, property: p.id, type, status, rent, area: type === 'Commercial Space' ? 3000 : 750 + 250 * (parseInt(type, 10) || 0), beds: parseInt(type, 10) || 0, baths: 1, furnish: 'Unfurnished', vacantSince }));
  }
  const leases = [];
  for (const [i, end] of [[0, d(40)], [1, d(210)], [3, d(25)], [4, d(300)], [6, d(700)], [7, d(150)], [9, d(95)], [10, d(330)]]) {
    const u = U[i];
    leases.push(await post('leases', { unit: u.id, kind: u.type === 'Commercial Space' ? 'Commercial' : 'Annual', status: end <= d(60) ? 'Expiring Soon' : 'Active', start: addDays(addMonths(end, -12), 1), end, rent: u.rent, deposit: u.rent, renewal: '12-month renewal, rent increase capped at 4%' }));
  }

  // ---------------------------------------------------------------- rents (3 months back), revenue, expenses
  for (let back = 3; back >= 1; back--) {
    for (const l of leases) {
      const paid = back > 1 || l.unit !== U[3].id ? l.rent : 0;
      await post('rents', { unit: l.unit, month: M(-back), due: l.rent, paid: back === 1 && l.unit === U[1].id ? 1000 : paid, lastPaid: addDays(M(-back), 3) });
    }
  }
  await post('rents:generateThisMonth');
  for (let back = 2; back >= 0; back--) {
    for (const p of [P.bg, P.cp, P.hl]) {
      const rent = leases.filter((l) => l.property === p.id).reduce((a, l) => a + l.rent, 0);
      await post('revenue', { property: p.id, kind: 'Rent', month: M(-back), amount: rent });
    }
    await post('revenue', { property: P.bg.id, kind: 'Parking Fees', month: M(-back), amount: 600 });
    await post('revenue', { property: P.bg.id, kind: 'Laundry', month: M(-back), amount: 240 });
    const day = (k) => (back === 0 ? T : addDays(M(-back), k));
    await post('expenses', { property: P.bg.id, category: 'Utilities', nature: 'Operating', amount: 1900, date: day(8), supplier: 'FPL' });
    await post('expenses', { property: P.bg.id, category: 'Management', nature: 'Operating', amount: 1450, date: day(2) });
    await post('expenses', { property: P.cp.id, category: 'Repairs & Maintenance', nature: 'Operating', amount: 2300, date: day(15), supplier: 'Sun Electric LLC' });
    await post('expenses', { property: P.cp.id, category: 'Insurance', nature: 'Operating', amount: 2100, date: day(1), supplier: 'Citizens' });
    await post('expenses', { property: P.hl.id, category: 'Utilities', nature: 'Operating', amount: 380, date: day(9) });
  }
  await post('expenses', { property: P.bg.id, category: 'Capital Improvements', nature: 'Capital', amount: 18500, date: d(-20), supplier: 'Atlantic Build Co.' });
  await post('expenses', { property: P.bg.id, category: 'Loan Interest', nature: 'Operating', amount: 13400, date: d(-5) });

  for (const [p, cat, amount] of [[P.bg, 'Utilities', 22000], [P.bg, 'Management', 17400], [P.bg, 'Property Tax', 48000], [P.cp, 'Repairs & Maintenance', 24000], [P.cp, 'Insurance', 25200], [P.hl, 'Utilities', 4800]]) {
    await post('budgets', { property: p.id, year: Y, category: cat, amount });
  }
  await post('targets', { period: 'Year', year: Y, revenue: 520000, noi: 340000 });
  await post('targets', { period: 'Quarter', year: Y, index: Math.floor((Number(T.slice(5, 7)) - 1) / 3) + 1, revenue: 130000, noi: 85000 });

  // ---------------------------------------------------------------- loans
  await post('loans', { property: P.bg.id, lender: 'Truist Bank', status: 'Current', principal: 2870000, balance: 2610000, rate: 5.25, kind: 'Fixed', term: 120, start: '2021-06-15', maturity: d(240), payment: 15850, refi: 'No prepayment penalty after year 5' });
  await post('loans', { property: P.cp.id, lender: 'City National Bank of Florida', status: 'Current', principal: 4100000, balance: 3720000, rate: 6.1, kind: 'Floating', term: 84, start: '2019-03-01', maturity: d(900), rateReset: d(70), payment: 24800 });

  // ---------------------------------------------------------------- vendors, work orders, inspections, renovations
  const V = {
    el: await post('vendors', { company: 'Sun Electric LLC', service: 'Electrical', status: 'Active', area: 'Miami-Dade', license: 'EC13008811', licenseExp: d(30), insuranceExp: d(200), phone: '+1 305 555 0110', email: 'office@sunelectric.example', ratePrice: 4, rateTime: 5, rateQuality: 4 }),
    ac: await post('vendors', { company: 'CoolBreeze HVAC', service: 'HVAC', status: 'Active', area: 'Miami-Dade, Broward', licenseExp: d(400), insuranceExp: d(20), ratePrice: 3, rateTime: 4, rateQuality: 5 }),
    bd: await post('vendors', { company: 'Atlantic Build Co.', service: 'Construction', status: 'Active', area: 'Florida', licenseExp: d(500), insuranceExp: d(500), ratePrice: 3, rateTime: 3, rateQuality: 4 }),
  };
  await post('workorders', { title: 'A-102 AC not cooling', property: P.bg.id, unit: U[1].id, category: 'HVAC', priority: 'Urgent', status: 'Assigned', vendor: V.ac.id, estCost: 650, dueDate: d(1), owner: 'Linda Carter' });
  await post('workorders', { title: 'Hallway ceiling water leak', property: P.bg.id, category: 'Plumbing', priority: 'High', status: 'In Progress', estCost: 1200, dueDate: d(-2), owner: 'Linda Carter' });
  await post('workorders', { title: 'Replace parking lot lights', property: P.cp.id, category: 'Electrical', priority: 'Normal', status: 'Completed', vendor: V.el.id, estCost: 900, actualCost: 840, dueDate: d(-10), doneDate: d(-8) });
  await post('workorders', { title: 'Fire extinguisher inspection', property: P.cp.id, category: 'Fire Safety', priority: 'Normal', status: 'New', dueDate: d(12) });
  await post('inspections', { property: P.bg.id, item: 'Roofing', result: 'Needs Monitoring', date: d(-30), inspector: 'Florida Roof Inspect' });
  await post('inspections', { property: P.cp.id, item: 'Fire Safety', result: 'Good', date: d(-60), inspector: 'Fire Marshal' });
  const reno = await post('renovations', { name: 'A-203 Renovation', property: P.bg.id, status: 'Under Construction', scope: 'New flooring, kitchen remodel, full repaint', budget: 32000, actual: 18500, vendor: V.bd.id, start: d(-25), eta: d(20), progress: 55, permitNo: 'BLD-2026-0412', permitExp: d(160), rentLift: 350 });
  await post('milestones', { title: 'Kitchen completed', renovation: reno.id, due: d(6), status: 'Pending' });
  await post('milestones', { title: 'Final walkthrough', renovation: reno.id, due: d(20), status: 'Pending' });

  // ---------------------------------------------------------------- deals, checklist, sales, scenarios
  const deal = await post('deals', { name: 'Hialeah 12-Unit', side: 'Buy', stage: 'Due Diligence', area: 'Hialeah', type: 'Multifamily', ask: 1210000, offer: 1150000, noi: 78650, source: 'Broker referral', owner: 'Michael Brooks' });
  await post('deals', { name: 'Sell Homestead Lot 7', side: 'Sell', stage: 'Offer', area: 'Homestead', type: 'Land', ask: 395000, property: P.lot.id, owner: 'Michael Brooks' });
  await post('deals', { name: 'Fort Lauderdale Retail Center', side: 'Buy', stage: 'Screening', area: 'Fort Lauderdale', type: 'Commercial', ask: 2600000, noi: 171600 });
  for (const [item, status] of [['Title & Ownership', 'Passed'], ['Building Inspection', 'Issue Found'], ['Environmental', 'Not Checked'], ['Financing', 'Passed']]) {
    await post('checklist', { deal: deal.id, item, status, note: status === 'Issue Found' ? 'Roof needs replacement within 2 years' : null });
  }
  for (const [p, kind, date, product, qty, value] of [
    [P.bg, 'Unit Lease', d(-5), '1 Bedroom', 1, 22200], [P.bg, 'Lease Renewal', d(-20), '2 Bedroom', 2, 57600], [P.cp, 'Unit Lease', d(-45), 'Commercial Space', 1, 98400],
    [P.hl, 'Lease Renewal', d(-70), '2 Bedroom', 1, 30600], [P.hl, 'Acquisition', '2023-09-20', 'Single-Family', 1, 690000],
  ]) await post('sales', { property: p.id, kind, date, product, qty, value });
  await post('scenarios', {
    name: 'Hialeah — offer price', tool: 'Rental Property Purchase Analysis', calc: 'Rental Property Purchase Analysis', deal: deal.id,
    inputs: 'Price $1,150,000 · LTV 70% · rate 6.5% · 30 years', result: 'Cap rate 6.84% · CoC 7.2%\nDSCR 1.31',
    values: JSON.stringify({ price: 1150000, reno: 40000, rent: 9600, vac: 5, opex: 8000, tax: 12000, ins: 5320, ltv: 70, rate: 6.5, years: 30 }),
  });

  // ---------------------------------------------------------------- tasks & partners
  await post('tasks', { title: 'Send renewal notice to A-201', related: 'A-201', owner: 'Linda Carter', due: d(-1), priority: 'High', status: 'To Do' });
  await post('tasks', { title: "Reconcile last month's rent", owner: 'Michael Brooks', due: d(2), priority: 'Normal', status: 'In Progress' });
  await post('tasks', { title: 'Renew Coral Plaza insurance', related: 'Coral Plaza', owner: 'Linda Carter', due: d(10), priority: 'Urgent', status: 'To Do' });
  await post('partners', { company: 'Truist Bank', kind: 'Bank & Lender', city: 'Miami', website: 'https://www.truist.com', phone: '+1 305 555 0150', email: 'cre@truist.example' });
  await post('partners', { company: 'Biscayne Realty Group', kind: 'Broker', city: 'North Miami' });
  await post('partners', { company: 'Sunshine Title & Escrow', kind: 'Title Insurance', city: 'Fort Lauderdale' });

  await call('GET', 'jobs/daily');
  server.close();
  const counts = await Promise.all(registry.names().map(async (c) => `${c}:${await mongoose.connection.db.collection(c).countDocuments()}`));
  console.log('sample data loaded ->', counts.join(' '));
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e.message);
  await mongoose.disconnect();
  process.exit(1);
});
