const gstService = require('../services/gstService');

async function getGstReport(req, res) {
  res.json(await gstService.getGstReport(req));
}

module.exports = { getGstReport };
