/** `code` is the machine-readable string the app switches on; `extra` is merged into the error body. Messages are Vietnamese: the app shows them as-is. */
class AppError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (noun = 'record') => new AppError(404, 'NOT_FOUND', `${noun} not found. It may have been deleted.`);
const conflict = (code, message, extra) => new AppError(409, code, message, extra);
/** `fields` is { field: message }; the top-level message is the first one. */
const invalid = (fields, message) =>
  new AppError(422, 'VALIDATION_ERROR', message || Object.values(fields)[0] || 'The data is not valid.', { fields });

module.exports = { AppError, asyncHandler, notFound, conflict, invalid };
