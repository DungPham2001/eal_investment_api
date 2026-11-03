const config = require('../config');

const DAY = 86400000;
const RX = /^(\d{4})-(\d{2})-(\d{2})$/;

const ms = (s) => {
  const [, y, m, d] = RX.exec(s);
  return Date.UTC(+y, +m - 1, +d);
};
const fmt = (t) => new Date(t).toISOString().slice(0, 10);

/** True for a real calendar date written YYYY-MM-DD. */
const isDate = (s) => typeof s === 'string' && RX.test(s) && fmt(ms(s)) === s;

const addDays = (s, n) => fmt(ms(s) + n * DAY);

/** Adds months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

/** b - a in whole days. */
const diffDays = (a, b) => Math.round((ms(b) - ms(a)) / DAY);

const monthStart = (s) => `${s.slice(0, 7)}-01`;
const monthEnd = (s) => addDays(addMonths(monthStart(s), 1), -1);
/** Day 5 of the month of `s` (rent due date). */
const day5 = (s) => `${s.slice(0, 7)}-05`;

/** A Date (or ISO string) as YYYY-MM-DD in the business timezone. */
const dateInTz = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

/** Today's date (YYYY-MM-DD) in the business timezone. */
const today = () => dateInTz(new Date());

// ---- calendar periods (analytics 6.1) ------------------------------------------------------------
const PERIODS = ['month', 'quarter', 'year'];

function periodRange(period, at) {
  const y = at.slice(0, 4);
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (period === 'quarter') {
    const q = Math.floor((Number(at.slice(5, 7)) - 1) / 3);
    const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    return { from, to: monthEnd(addMonths(from, 2)) };
  }
  return { from: monthStart(at), to: monthEnd(at) };
}

const previousRange = (period, at) => periodRange(period, addDays(periodRange(period, at).from, -1));

/** Month starts covering [from, to]. */
function monthsIn(from, to) {
  const out = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const inRange = (d, r) => !!d && d >= r.from && d <= r.to;

module.exports = { PERIODS, isDate, addDays, addMonths, diffDays, monthStart, monthEnd, day5, dateInTz, today, periodRange, previousRange, monthsIn, inRange };
