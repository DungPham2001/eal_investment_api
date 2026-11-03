const config = require('../config');
const { AppError } = require('../utils/AppError');

const notFound = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `That address does not exist: ${req.method} ${req.path}`));

/** Body: { code, message, fields? , ...extra } (spec 0). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = typeof err.code === 'string' ? err.code : null;
  let message = err.message;
  let extra = err.extra || {};

  if (err.name === 'CastError') {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Invalid value.';
    extra = { fields: { [err.path]: message } };
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'The record already exists.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request is too large.';
  }

  if (status >= 500) {
    console.error(err);
    code = 'INTERNAL_ERROR';
    if (config.env === 'production') message = 'Something went wrong on our side. Please try again in a few minutes.';
    extra = {};
  }
  if (status === 429 && extra.retryAfter) res.set('Retry-After', String(extra.retryAfter));
  res.status(status).json({ code: code || 'ERROR', message, ...extra });
}

module.exports = { notFound, errorHandler };
