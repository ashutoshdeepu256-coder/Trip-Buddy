const { sendSuccess } = require("../utils/http");
const itineraryService = require("../services/itinerary.service");

const generate = async (req, res) => sendSuccess(res, await itineraryService.generate(req, req.body), "Itinerary generated", 201);
const list = async (req, res) => sendSuccess(res, await itineraryService.list(req.user, req.validatedQuery));
const get = async (req, res) => sendSuccess(res, await itineraryService.get(req.user, req.params.itineraryId));
const update = async (req, res) => sendSuccess(res, await itineraryService.update(req, req.params.itineraryId, req.body), "Itinerary updated");
const regenerateDay = async (req, res) => sendSuccess(res, await itineraryService.regenerateDay(req, req.params.itineraryId, req.params.day, req.params.section), req.params.section ? "Itinerary section regenerated" : "Itinerary day regenerated");
const duplicate = async (req, res) => sendSuccess(res, await itineraryService.duplicate(req, req.params.itineraryId), "Itinerary duplicated", 201);
const archive = async (req, res) => sendSuccess(res, await itineraryService.archive(req, req.params.itineraryId), "Itinerary archived");
const remove = async (req, res) => sendSuccess(res, await itineraryService.remove(req, req.params.itineraryId), "Itinerary deleted");

module.exports = { generate, list, get, update, regenerateDay, duplicate, archive, remove };
