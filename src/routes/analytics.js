const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const A = require('../services/analytics');

const router = express.Router();
const r = (path, fn) => router.get(path, asyncHandler(async (req, res) => res.json(await fn(req.query))));

r('/summary', A.summary);
r('/monthly', A.monthly);
r('/occupancy-trend', A.occupancyTrend);
r('/performance', A.performance);
r('/expense-by-category', A.expenseByCategory);
r('/budget-vs-actual', A.budgetVsActual);
r('/aging', A.aging);
r('/pipeline', A.pipeline);
r('/best-selling', A.bestSelling);

module.exports = router;
