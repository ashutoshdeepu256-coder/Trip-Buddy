const { sendSuccess } = require("../utils/http");
const tripDiscoveryService = require("../services/tripDiscovery.service");

const list = async (req, res) =>
  sendSuccess(res, await tripDiscoveryService.discoverTrips(req.validatedQuery, req.user || null));

module.exports = { list };
