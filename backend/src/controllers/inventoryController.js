const inventoryService = require('../services/inventoryService');

async function getInventory(req, res) {
  res.json(await inventoryService.getInventory(req));
}

module.exports = { getInventory };
