const gstService = require('../services/gstService');

async function getGstReport(req, res) {
  res.json(await gstService.getGstReport(req));
}

async function getGstExport(req, res) {
  res.json(await gstService.getGstExport(req));
}

module.exports = { getGstReport, getGstExport };
