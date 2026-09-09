const paymentService = require('../services/paymentService');

async function list(req, res) {
  res.json(await paymentService.list(req));
}
async function getById(req, res) {
  res.json(await paymentService.getById(parseInt(req.params.id, 10)));
}
async function getByOrderId(req, res) {
  res.json(await paymentService.getById(parseInt(req.params.orderId || req.params.id, 10)));
}
// async function statsSummary(req, res) {
//   res.json(await paymentService.statsSummary());
// }

async function statsSummary(req, res) {
  res.json(
    await paymentService.statsSummary(req)
  );
}

async function reconcile(req, res) {
  res.json(await paymentService.reconcile(parseInt(req.params.id, 10), req.body || {}));
}

module.exports = { list, getById, getByOrderId, statsSummary, reconcile };
