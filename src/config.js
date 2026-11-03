require('dotenv').config();

const env = process.env.NODE_ENV || 'development';
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

module.exports = {
  env,
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eal_investment',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // "Today", day 5 of the month and the start of a month are computed in this timezone (spec 10.6).
  timezone: process.env.TIMEZONE || 'America/New_York',
  lockMonths: num(process.env.LOCK_MONTHS, 3),
  apiKey: process.env.API_KEY || '',
  adminKey: process.env.ADMIN_KEY || '',
  cronSecret: process.env.CRON_SECRET || '',
  minAppVersion: process.env.MIN_APP_VERSION || '1.0.0',
};
