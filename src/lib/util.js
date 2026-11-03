const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const pct = (num, den) => (den > 0 ? round((num / den) * 100) : 0);
const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
const groupBy = (arr, fn) => arr.reduce((m, x) => {
  const k = fn(x);
  (m.get(k) || m.set(k, []).get(k)).push(x);
  return m;
}, new Map());
const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`;

module.exports = { escapeRegex, round, pct, sum, groupBy, money };
