/** Company info, legal texts and guides (spec 7, 8.1): stored in `contents`, editable with PUT /v1/content/:key (admin). */
const { Content } = require('../models/system');
const { invalid } = require('../utils/AppError');

/** Company profile from the spec (EAL publishes it; used until the `contents.company` row is edited). */
const COMPANY = {
  name: 'EAL INVESTMENT INC.',
  field: 'Real Estate Investment & Management',
  fieldVi: 'Real Estate Investment & Management',
  address: '13499 Biscayne Blvd Ste M4, North Miami, FL 33181-2036, United States',
  phone: '+1 804 960 6738',
  email: 'endorahma@gmail.com',
  website: 'https://ealinvesterment.blogspot.com/p/home.html/',
  hours: 'Mon – Fri · 9:00 AM – 5:30 PM (EST)',
  founded: '2015',
  serviceArea: 'Miami-Dade, Broward · Florida',
  assetTypes: 'Multifamily, single-family, commercial, land',
  published: { period: 'Q3/2026', updatedAt: '2026-10-05', properties: 24, units: 412, occupancy: 94.6 },
};

const KEYS = ['company', 'terms', 'privacy', 'guides'];
const EMPTY = {
  company: COMPANY,
  terms: { intro: null, sections: [], updatedAt: null },
  privacy: { intro: null, sections: [], updatedAt: null },
  guides: [],
};

async function getContent(key) {
  const row = await Content.findById(key).lean();
  if (!row) return EMPTY[key];
  if (key === 'terms' || key === 'privacy') return { ...EMPTY[key], ...row.data, updatedAt: row.data?.updatedAt || row.updatedAt };
  return row.data;
}

function check(key, data) {
  if (!KEYS.includes(key)) throw invalid({ key: `Must be one of: ${KEYS.join(', ')}` });
  if (key === 'guides') {
    if (!Array.isArray(data) || data.some((g) => !g || typeof g.title !== 'string' || typeof g.body !== 'string')) {
      throw invalid({ body: 'guides must be an array of { title, icon, body }.' });
    }
  } else if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid({ body: 'A JSON object body is required.' });
  if (key === 'terms' || key === 'privacy') {
    if (!Array.isArray(data.sections) || data.sections.some((s) => typeof s?.title !== 'string' || typeof s?.body !== 'string')) {
      throw invalid({ sections: 'sections must be an array of { title, body }.' });
    }
  }
}

async function putContent(key, data) {
  check(key, data);
  await Content.updateOne({ _id: key }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
  return getContent(key);
}

/** db:init: writes the company profile once, never overwrites an edited one. */
async function seedDefaults() {
  await Content.updateOne({ _id: 'company' }, { $setOnInsert: { data: COMPANY, updatedAt: new Date() } }, { upsert: true });
}

module.exports = { getContent, putContent, seedDefaults, KEYS, COMPANY };
