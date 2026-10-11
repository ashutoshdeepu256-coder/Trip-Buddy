const { sendSuccess } = require("../utils/http");
const groupFormationService = require("../services/groupFormation.service");

const generate = async (req, res) => {
  const result = await groupFormationService.generateGroupRecommendation(req.params.tripId, req.user, req);
  return sendSuccess(res, result, result.recommendation ? "Group recommendation ready" : "Not enough eligible travellers");
};

const listForTrip = async (req, res) =>
  sendSuccess(res, await groupFormationService.listTripRecommendations(req.params.tripId, req.user));

const detail = async (req, res) =>
  sendSuccess(res, { recommendation: await groupFormationService.getGroupRecommendation(req.params.recommendationId, req.user) });

const accept = async (req, res) =>
  sendSuccess(res, { recommendation: await groupFormationService.acceptGroupRecommendation(req.params.recommendationId, req.user, req) }, "Response recorded");

const reject = async (req, res) =>
  sendSuccess(res, { recommendation: await groupFormationService.rejectGroupRecommendation(req.params.recommendationId, req.user, req) }, "Response recorded");

module.exports = { generate, listForTrip, detail, accept, reject };
