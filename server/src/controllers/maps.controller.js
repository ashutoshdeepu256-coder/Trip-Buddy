const { sendSuccess } = require("../utils/http");
const maps = require("../services/maps.service");

const getCapabilities = (_req, res) => sendSuccess(res, maps.capabilities());
const geocode = async (req, res) => sendSuccess(res, { items: await maps.geocode(req.validatedQuery.query) });
const reverse = async (req, res) => sendSuccess(res, { result: await maps.reverseGeocode(req.validatedQuery) });
const route = async (req, res) => sendSuccess(res, { route: await maps.route(req.body) });
const distance = (req, res) => sendSuccess(res, maps.straightLineDistance(req.body));

module.exports = { getCapabilities, geocode, reverse, route, distance };
