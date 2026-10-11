const { sendSuccess } = require("../utils/http");
const itineraryService = require("../services/itinerary.service");
const collaborationService = require("../services/collaborativeItinerary.service");

const generate = async (req, res) => sendSuccess(res, await itineraryService.generate(req, req.body), "Itinerary generated", 201);
const list = async (req, res) => sendSuccess(res, await itineraryService.list(req.user, req.validatedQuery));
const get = async (req, res) => sendSuccess(res, await itineraryService.get(req.user, req.params.itineraryId));
const update = async (req, res) => sendSuccess(res, await itineraryService.update(req, req.params.itineraryId, req.body), "Itinerary updated");
const regenerateDay = async (req, res) => sendSuccess(res, await itineraryService.regenerateDay(req, req.params.itineraryId, req.params.day, req.params.section), req.params.section ? "Itinerary section regenerated" : "Itinerary day regenerated");
const duplicate = async (req, res) => sendSuccess(res, await itineraryService.duplicate(req, req.params.itineraryId), "Itinerary duplicated", 201);
const archive = async (req, res) => sendSuccess(res, await itineraryService.archive(req, req.params.itineraryId), "Itinerary archived");
const remove = async (req, res) => sendSuccess(res, await itineraryService.remove(req, req.params.itineraryId), "Itinerary deleted");

const setCollaboration = async (req, res) => sendSuccess(res, await collaborationService.enable(req, req.params.itineraryId, req.body), "Collaboration policy updated");
const collaborators = async (req, res) => sendSuccess(res, await collaborationService.collaborators(req.user, req.params.itineraryId));
const grantCollaborator = async (req, res) => sendSuccess(res, await collaborationService.grant(req, req.params.itineraryId, req.body), "Collaborator permission updated");
const revokeCollaborator = async (req, res) => sendSuccess(res, await collaborationService.revoke(req, req.params.itineraryId, req.body), "Collaborator permission revoked");
const shared = async (req, res) => sendSuccess(res, await collaborationService.getShared(req.user, req.params.itineraryId));
const listShared = async (req, res) => sendSuccess(res, await collaborationService.listShared(req.user));
const addActivity = async (req, res) => sendSuccess(res, await collaborationService.addActivity(req, req.params.itineraryId, req.body), "Activity added", 201);
const updateActivity = async (req, res) => sendSuccess(res, await collaborationService.updateActivity(req, req.params.itineraryId, req.params.activityId, req.body), "Activity updated");
const removeActivity = async (req, res) => sendSuccess(res, await collaborationService.removeActivity(req, req.params.itineraryId, req.params.activityId, req.body), "Activity removed");
const reorderActivities = async (req, res) => sendSuccess(res, await collaborationService.reorderActivities(req, req.params.itineraryId, req.body), "Activities reordered");
const reorderDays = async (req, res) => sendSuccess(res, await collaborationService.reorderDays(req, req.params.itineraryId, req.body), "Days reordered");
const addDay = async (req, res) => sendSuccess(res, await collaborationService.addDay(req, req.params.itineraryId, req.body), "Day added", 201);
const updateDay = async (req, res) => sendSuccess(res, await collaborationService.updateDay(req, req.params.itineraryId, req.body.dayId, req.body), "Day updated");
const removeDay = async (req, res) => sendSuccess(res, await collaborationService.removeDay(req, req.params.itineraryId, req.body.dayId, req.body), "Day removed");
const history = async (req, res) => sendSuccess(res, await collaborationService.history(req.user, req.params.itineraryId, req.validatedQuery));
const restore = async (req, res) => sendSuccess(res, await collaborationService.restore(req, req.params.itineraryId, req.body), "Revision restored");

module.exports = { generate, list, get, update, regenerateDay, duplicate, archive, remove, setCollaboration, collaborators, grantCollaborator, revokeCollaborator, shared, listShared, addActivity, updateActivity, removeActivity, reorderActivities, reorderDays, addDay, updateDay, removeDay, history, restore };
