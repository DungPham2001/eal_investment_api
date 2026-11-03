const M = require('../models/records');
const { OccupancySnapshot } = require('../models/system');
const { monthStart, today } = require('../lib/dates');
const { refreshRentStatuses, resetThrottle } = require('./rents');
const { occupancyOf } = require('./analytics');

/** Things that change because time passed. Safe to run any number of times a day (Vercel Cron: /v1/jobs/daily). */
async function runDailyJobs() {
  const t = today();
  const rentStatuses = await refreshRentStatuses(M.rents, t);
  resetThrottle();

  // occupancy of the current month per property: the last run of a month freezes that month's figure
  const month = monthStart(t);
  const [properties, units] = await Promise.all([M.properties.find({}, '_id').lean(), M.units.find({}, 'property status').lean()]);
  const byProperty = new Map(properties.map((p) => [p._id, []]));
  for (const u of units) byProperty.get(u.property)?.push(u);
  const ops = [...byProperty].map(([property, list]) => {
    const o = occupancyOf(list);
    return { updateOne: { filter: { _id: `${month}:${property}` }, update: { $set: { month, property, occupied: o.occupied, total: o.total, at: new Date() } }, upsert: true } };
  });
  if (ops.length) await OccupancySnapshot.bulkWrite(ops);
  return { date: t, rentStatuses, occupancySnapshots: ops.length };
}

module.exports = { runDailyJobs };
