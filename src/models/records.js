/** The 21 business modules of spec section 3. Field names, labels and enum values are exactly the app's. */
const E = require('./enums');
const { defineModel } = require('./define');
const { str, text, json, date, en, int, num, money, pct, rating, ref, url, email, phone, computed } = require('./fields');

const R = { required: true };
const note = () => text('Note');
const owner = () => str('Owner');

const portfolios = defineModel('portfolios', {
  name: str('Portfolio name', R),
  strategy: en('Strategy', E.STRATEGY),
  region: str('Area'),
  owner: owner(),
  note: note(),
});

const properties = defineModel('properties', {
  name: str('Property name', R),
  type: en('Property type', E.PROPERTY_TYPE, R),
  status: en('Status', E.PROPERTY_STATUS, R),
  portfolio: ref('Portfolio', 'portfolios', { onDelete: 'unlink' }),
  city: str('City', R),
  zip: str('ZIP code', { required: true, validate: { validator: (v) => v == null || /^\d{5}(-\d{4})?$/.test(v), message: 'ZIP code must be 5 digits' } }),
  address: str('Full address'),
  yearBuilt: int('Year built', { min: 1800, max: 2100 }),
  area: num('Area (sq ft)'),
  units: int('Number of units', { min: 0 }),
  ownership: str('Ownership structure'),
  purchasePrice: money('Purchase price'),
  purchaseDate: date('Purchase date'),
  value: money('Current estimated value'),
  owner: owner(),
  note: note(),
}, { indexes: [[{ status: 1 }], [{ type: 1 }], [{ name: 1 }]] });

const units = defineModel('units', {
  code: str('Unit code', R),
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  type: en('Type', E.UNIT_TYPE, R),
  status: en('Status', E.UNIT_STATUS, R),
  area: num('Area (sq ft)'),
  beds: int('Bedrooms', { min: 0 }),
  baths: num('Bathrooms'),
  rent: money('Listed rent / month', R),
  furnish: en('Furnishing', E.FURNISH),
  vacantSince: date('Vacant since'),
  note: note(),
}, { indexes: [[{ status: 1 }], [{ property: 1, code: 1 }]] });

const leases = defineModel('leases', {
  unit: ref('Unit', 'units', { onDelete: 'cascade', required: true }),
  property: computed(ref('Property', 'properties', { onDelete: 'cascade' })),
  kind: en('Lease type', E.LEASE_KIND, R),
  status: en('Status', E.LEASE_STATUS, R),
  start: date('Start date', R),
  end: date('End date', R),
  rent: money('Rent / month', R),
  deposit: money('Security deposit'),
  renewal: str('Renewal terms'),
  prev: ref('Previous lease (renewed from)', 'leases', { onDelete: 'unlink' }),
  note: note(),
}, { indexes: [[{ status: 1, end: 1 }]] });

const rents = defineModel('rents', {
  unit: ref('Unit', 'units', { onDelete: 'cascade', required: true }),
  property: computed(ref('Property', 'properties', { onDelete: 'cascade' })),
  month: date('Month', R),
  due: money('Rent due', R),
  paid: money('Amount paid (manual)', { default: 0 }),
  lastPaid: date('Last payment date'),
  note: note(),
  status: computed(en('Status', E.RENT_STATUS)),
  gap: computed(money('Balance due', { signed: true, default: 0 })),
}, { indexes: [[{ month: -1 }], [{ unit: 1, month: 1 }], [{ status: 1 }]] });

const workorders = defineModel('workorders', {
  title: str('Title', R),
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  unit: ref('Unit (empty = common area)', 'units', { onDelete: 'unlink' }),
  category: en('Type', E.WO_CATEGORY, R),
  priority: en('Priority', E.PRIORITY, R),
  status: en('Status', E.WO_STATUS, R),
  description: text('Description'),
  vendor: ref('Contractor', 'vendors', { onDelete: 'unlink' }),
  estCost: money('Estimated cost'),
  actualCost: money('Actual cost'),
  dueDate: date('Due date', R),
  doneDate: date('Completed date'),
  owner: owner(),
}, { indexes: [[{ status: 1, dueDate: 1 }]] });

const vendors = defineModel('vendors', {
  company: str('Company name', R),
  service: en('Service type', E.VENDOR_SERVICE, R),
  status: en('Status', E.VENDOR_STATUS, R),
  area: str('Service area'),
  license: str('License number'),
  licenseExp: date('License expires'),
  insuranceExp: date('Liability insurance expires'),
  phone: phone('Company phone'),
  email: email('Company email'),
  ratePrice: rating('Price rating'),
  rateTime: rating('Timeliness rating'),
  rateQuality: rating('Quality rating'),
  note: note(),
}, { indexes: [[{ status: 1 }], [{ service: 1 }]] });

const inspections = defineModel('inspections', {
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  item: en('Item', E.INSPECTION_ITEM, R),
  result: en('Result', E.INSPECTION_RESULT, R),
  date: date('Inspection date', R),
  inspector: str('Inspector'),
  note: note(),
}, { indexes: [[{ date: -1 }]] });

const renovations = defineModel('renovations', {
  name: str('Project name', R),
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  status: en('Status', E.RENO_STATUS, R),
  scope: text('Scope'),
  budget: money('Budget', R),
  actual: money('Actual cost'),
  vendor: ref('Contractor', 'vendors', { onDelete: 'unlink' }),
  start: date('Start date'),
  eta: date('Expected completion'),
  progress: pct('Progress (%)'),
  permitNo: str('Building permit number'),
  permitExp: date('License expires'),
  rentLift: money('Rent increase after renovation / month'),
  note: note(),
}, { indexes: [[{ status: 1 }], [{ eta: -1 }]] });

const milestones = defineModel('milestones', {
  title: str('Milestone name', R),
  renovation: ref('Project', 'renovations', { onDelete: 'cascade', required: true }),
  due: date('Due date', R),
  status: en('Status', E.MILESTONE_STATUS, R),
  note: note(),
}, { indexes: [[{ due: -1 }]] });

const tasks = defineModel('tasks', {
  title: str('Title', R),
  related: str('Related record'),
  owner: owner(),
  due: date('Due date', R),
  priority: en('Priority', E.PRIORITY, R),
  status: en('Status', E.TASK_STATUS, R),
  remind: int('Remind before (days)', { min: 0, default: 1 }),
  note: note(),
}, { indexes: [[{ status: 1, due: 1 }]] });

const expenses = defineModel('expenses', {
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  category: en('Expense category', E.EXPENSE_CATEGORY, R),
  nature: en('Nature', E.EXPENSE_NATURE, R),
  amount: money('Amount', R),
  date: date('Date', R),
  supplier: str('Supplier (company name)'),
  note: note(),
}, { indexes: [[{ date: -1 }], [{ category: 1 }]] });

const budgets = defineModel('budgets', {
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  year: int('Year', { required: true, min: 2000, max: 2100 }),
  category: en('Expense category', E.EXPENSE_CATEGORY, R),
  amount: money('Annual budget', R),
  note: note(),
}, { indexes: [[{ year: 1, category: 1 }]] });

const loans = defineModel('loans', {
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  lender: str('Lender (institution)', R),
  status: en('Status', E.LOAN_STATUS, R),
  principal: money('Original principal', R),
  balance: money('Current balance (manual)', R),
  rate: pct('Interest rate (%/yr)', R),
  kind: en('Rate type', E.RATE_KIND),
  term: int('Term (months)', { min: 0 }),
  start: date('Start date'),
  maturity: date('Maturity date', R),
  rateReset: date('Rate reset date'),
  payment: money('Monthly payment'),
  refi: text('Refinance terms'),
  note: note(),
}, { indexes: [[{ status: 1, maturity: 1 }]] });

const revenue = defineModel('revenue', {
  property: ref('Property', 'properties', { onDelete: 'cascade', required: true }),
  kind: en('Revenue type', E.REVENUE_KIND, R),
  month: date('Month', R),
  amount: money('Amount', R),
  source: computed(en('Source', E.REVENUE_SOURCE, { default: 'Manual Entry' })),
  reason: text('Manual entry reason'),
}, { indexes: [[{ month: -1 }], [{ kind: 1 }]] });

const targets = defineModel('targets', {
  period: en('Period', E.TARGET_PERIOD, R),
  year: int('Year', { required: true, min: 2000, max: 2100 }),
  index: int('Month/Quarter number', { min: 1, max: 12 }),
  revenue: money('Revenue target', R),
  noi: money('NOI target', { required: true, signed: true }),
  note: note(),
}, { indexes: [[{ year: 1, period: 1 }]] });

const deals = defineModel('deals', {
  name: str('Deal name', R),
  side: en('Side', E.DEAL_SIDE, R),
  stage: en('Stage', E.DEAL_STAGE, R),
  area: str('Area'),
  type: en('Property type', E.PROPERTY_TYPE),
  ask: money('Asking price'),
  offer: money('Offer price'),
  noi: money('Projected NOI / year', { signed: true }),
  source: str('Source'),
  owner: owner(),
  property: ref('Property (for sell deals)', 'properties', { onDelete: 'unlink' }),
  note: note(),
  cap: computed(num('Cap rate', { min: undefined })),
}, { indexes: [[{ stage: 1 }]] });

const checklist = defineModel('checklist', {
  deal: ref('Investment deal', 'deals', { onDelete: 'cascade', required: true }),
  item: en('Item', E.CHECK_ITEM, R),
  status: en('Status', E.CHECK_STATUS, R),
  note: note(),
}, { indexes: [[{ status: 1 }]] });

const sales = defineModel('sales', {
  // Closed deals stay when the property is deleted (spec 1: keeps the best-selling history).
  property: ref('Property', 'properties', { onDelete: 'keep', required: true }),
  kind: en('Transaction type', E.SALE_KIND, R),
  date: date('Closing date', R),
  product: en('Product type', E.SALE_PRODUCT, R),
  qty: int('Quantity (units)', { required: true, min: 1, default: 1 }),
  value: money('Transaction value', R),
  note: note(),
}, { indexes: [[{ date: -1 }]] });

const scenarios = defineModel('scenarios', {
  name: str('Scenario name', R),
  tool: str('Tool', R),
  deal: ref('Linked deal', 'deals', { onDelete: 'unlink' }),
  inputs: text('Assumptions'),
  result: text('Result'),
  calc: str('Calculator'),
  values: json('Assumption values (JSON)'),
}, { indexes: [[{ tool: 1 }]] });

const partners = defineModel('partners', {
  company: str('Company name', R),
  kind: en('Type', E.PARTNER_KIND, R),
  city: str('City'),
  website: url('Website'),
  phone: phone('General phone'),
  email: email('Email chung'),
  note: note(),
}, { indexes: [[{ kind: 1 }]] });

module.exports = {
  portfolios, properties, units, leases, rents, workorders, vendors, inspections, renovations, milestones, tasks,
  expenses, budgets, loans, revenue, targets, deals, checklist, sales, scenarios, partners,
};
