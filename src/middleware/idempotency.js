const mongoose = require('mongoose');
const { AppError } = require('../utils/AppError');

const Idem = mongoose.model(
  'Idempotency',
  new mongoose.Schema(
    {
      key: String,
      scope: String,
      state: { type: String, default: 'pending' },
      status: Number,
      body: mongoose.Schema.Types.Mixed,
      createdAt: { type: Date, default: Date.now, expires: 86400 },
    },
    { collection: 'idempotency_keys', versionKey: false, minimize: false }
  ).index({ key: 1, scope: 1 }, { unique: true })
);

/**
 * POST + Idempotency-Key: the first request runs, a repeat with the same key (same client IP, same URL) gets the stored
 * response back instead of creating a duplicate. Only 2xx responses are remembered, so a failed attempt can be retried.
 */
async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (req.method !== 'POST' || !key) return next();
  if (typeof key !== 'string' || key.length > 128) return next(new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be a string of at most 128 characters.'));
  const scope = `${req.ctx.actor}:${req.originalUrl}`;

  try {
    await Idem.create({ key, scope });
  } catch (err) {
    if (err.code !== 11000) return next(err);
    const found = await Idem.findOne({ key, scope }).lean();
    if (found?.state === 'done') {
      res.set('Idempotent-Replay', 'true');
      return found.body === null ? res.status(found.status).end() : res.status(found.status).json(found.body);
    }
    return next(new AppError(409, 'REQUEST_IN_PROGRESS', 'The same request is still being processed. Retry in a moment.'));
  }

  const send = res.json.bind(res);
  res.json = (body) => {
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const done = ok ? Idem.updateOne({ key, scope }, { state: 'done', status: res.statusCode, body }) : Idem.deleteOne({ key, scope });
    done.then(() => send(body), () => send(body));
    return res;
  };
  return next();
}

module.exports = { idempotency };
