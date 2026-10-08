const { sendSuccess } = require("../utils/http");
const matchService = require("../services/match.service");

const compatibility = async (req, res) =>
  sendSuccess(res, await matchService.getTripCompatibility(req.params.tripId, req.user));

const refresh = async (req, res) =>
  sendSuccess(
    res,
    { match: await matchService.refreshTripCompatibility(req.params.tripId, req.user) },
    "Compatibility refreshed",
  );

const list = async (req, res) =>
  sendSuccess(res, await matchService.listUserMatches(req.user, req.validatedQuery));

const detail = async (req, res) =>
  sendSuccess(res, { match: await matchService.getMatchById(req.params.matchId, req.user) });

module.exports = { compatibility, refresh, list, detail };
