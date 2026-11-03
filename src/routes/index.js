const express = require('express');
const registry = require('../resources');
const { createRouter } = require('../core/resource');

const api = express.Router();

api.use('/', require('../services/actions').router); // colon endpoints first: /rents:generateThisMonth ...
api.use('/analytics', require('./analytics'));
api.use('/', require('./system'));

for (const cfg of registry.all()) api.use(`/${cfg.name}`, createRouter(cfg));

module.exports = api;
