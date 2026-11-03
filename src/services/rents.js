/**
 * rents.status (spec 4), "today" in the business timezone:
 *   1. paid >= due and due > 0                    -> Paid in Full
 *   2. else, today after day 5 of month m:  paid > 0 -> Partially Paid (Overdue once today is after day 5 of m+1)
 *                                           paid = 0 -> Overdue
 *   3. else paid > 0 -> Partially Paid, otherwise Unpaid
 * Time-dependent, so it is recomputed on every read and stored values are refreshed before lists / analytics / by the daily job.
 */
const { addMonths, day5, monthStart, today } = require('../lib/dates');

function rentStatus({ due, paid, month }, t = today()) {
  const d = Number(due) || 0;
  const p = Number(paid) || 0;
  if (d > 0 && p >= d) return 'Paid in Full';
  if (month && t > day5(month)) {
    if (p > 0) return t > day5(addMonths(month, 1)) ? 'Overdue' : 'Partially Paid';
    return 'Overdue';
  }
  return p > 0 ? 'Partially Paid' : 'Unpaid';
}

/**
 * Rewrites stale stored statuses with 4 updateMany (no version / history change: nothing the user edited).
 * A = last month whose day 5 is already past, B = the month before A.
 */
async function refreshRentStatuses(Model, t = today()) {
  const A = t > day5(t) ? monthStart(t) : addMonths(monthStart(t), -1);
  const B = addMonths(A, -1);
  const full = { $expr: { $and: [{ $gt: ['$due', 0] }, { $gte: [{ $ifNull: ['$paid', 0] }, '$due'] }] } };
  const notFull = { $nor: [full] };
  const paidZero = { $or: [{ paid: { $lte: 0 } }, { paid: null }] };
  const c = Model.collection;
  const r = await Promise.all([
    c.updateMany({ ...full, status: { $ne: 'Paid in Full' } }, { $set: { status: 'Paid in Full' } }),
    c.updateMany({ $and: [notFull, { status: { $ne: 'Overdue' } }, { $or: [{ month: { $lte: B } }, { $and: [{ month: { $lte: A } }, paidZero] }] }] }, { $set: { status: 'Overdue' } }),
    c.updateMany({ $and: [notFull, { status: { $ne: 'Partially Paid' } }, { paid: { $gt: 0 } }, { month: { $gt: B } }] }, { $set: { status: 'Partially Paid' } }),
    c.updateMany({ $and: [notFull, { status: { $ne: 'Unpaid' } }, paidZero, { month: { $gt: A } }] }, { $set: { status: 'Unpaid' } }),
  ]);
  return r.reduce((a, x) => a + x.modifiedCount, 0);
}

let last = 0;
/** At most once a minute per process (lists call it). */
async function refreshIfStale(Model) {
  if (Date.now() - last < 60000) return;
  last = Date.now();
  await refreshRentStatuses(Model);
}
const resetThrottle = () => { last = 0; };

module.exports = { rentStatus, refreshRentStatuses, refreshIfStale, resetThrottle };
