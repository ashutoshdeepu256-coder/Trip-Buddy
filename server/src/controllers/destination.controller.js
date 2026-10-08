const { sendSuccess } = require("../utils/http");
const destinationService = require("../services/destination.service");

const list = async (req, res) =>
  sendSuccess(
    res,
    await destinationService.listDestinations(req.validatedQuery),
  );
const popular = async (req, res) =>
  sendSuccess(
    res,
    await destinationService.listByRank({
      ...req.validatedQuery,
      kind: "popular",
    }),
  );
const trending = async (req, res) =>
  sendSuccess(
    res,
    await destinationService.listByRank({
      ...req.validatedQuery,
      kind: "trending",
    }),
  );
const nearby = async (req, res) =>
  sendSuccess(res, await destinationService.listNearby(req.validatedQuery));
const seasonal = async (req, res) =>
  sendSuccess(res, await destinationService.listSeasonal(req.validatedQuery));
const budget = async (req, res) =>
  sendSuccess(res, await destinationService.listBudget(req.validatedQuery));
const adventure = async (req, res) =>
  sendSuccess(res, await destinationService.listAdventure(req.validatedQuery));
const detail = async (req, res) =>
  sendSuccess(res, await destinationService.getDestination(req.params.id));

module.exports = {
  list,
  popular,
  trending,
  nearby,
  seasonal,
  budget,
  adventure,
  detail,
};
