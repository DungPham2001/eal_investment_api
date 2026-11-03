const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const { context } = require('./middleware/context');
const { apiKey } = require('./middleware/auth');
const { idempotency } = require('./middleware/idempotency');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Vercel/Render/Nginx: rate limiting needs the real client IP
app.set('etag', false); // ETag carries the record version (If-Match), not a body hash
app.use(helmet());
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['Idempotent-Replay', 'ETag'] }));
app.use(compression());
// method, url, status, time only: no IP or user agent is logged.
if (config.env !== 'test') app.use(morgan('tiny'));
app.use(express.json({ limit: '50mb' })); // public app: no quotas, large CSV imports are fine
app.use(context);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/v1', require('./routes/system').jobs); // Vercel Cron does not send the API key
app.use('/v1', apiKey, idempotency, require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
