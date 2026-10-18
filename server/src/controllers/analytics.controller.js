const { sendSuccess } = require("../utils/http");
const analyticsService = require("../services/analytics.service");

const getAdminAnalytics = async (req, res) => sendSuccess(res, await analyticsService.getAnalytics(req.validatedQuery), "Analytics loaded");

module.exports = { getAdminAnalytics };
