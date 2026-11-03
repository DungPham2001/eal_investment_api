const config = require('../config');
const { Setting } = require('../models/system');
const { addMonths, monthStart, today } = require('../lib/dates');

/**
 * Records of rents / expenses / revenue dated before this day are locked (spec 4.3):
 * first day of (current month - LOCK_MONTHS), or a later day closed by hand (PUT /v1/config/closed-before).
 */
async function closedBefore(session = null) {
  const rolling = addMonths(monthStart(today()), -config.lockMonths);
  const s = await Setting.findById('main').session(session).lean();
  return s?.closedBefore && s.closedBefore > rolling ? s.closedBefore : rolling;
}

async function setClosedBefore(value) {
  await Setting.updateOne({ _id: 'main' }, { $set: { closedBefore: value, updatedAt: new Date() } }, { upsert: true });
  return closedBefore();
}

async function publicConfig() {
  return {
    closedBefore: await closedBefore(),
    timezone: config.timezone,
    // Public app: nothing is rate limited or capped. null = unlimited (the app should drop its local caps).
    deleteLimit: { perWindow: null, windowMinutes: null, bulkMax: null },
    exportPerDay: null,
    importMaxRows: null,
    importMaxKb: null,
    minAppVersion: config.minAppVersion,
  };
}

module.exports = { closedBefore, setClosedBefore, publicConfig };
