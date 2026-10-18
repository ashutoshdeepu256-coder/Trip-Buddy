const { sendSuccess } = require("../utils/http");
const safetyService = require("../services/safety.service");
const safetyCenter = require("../services/safety-center.service");
const moderationService = require("../services/moderation.service");

const block = async (req, res) =>
  sendSuccess(res, await safetyService.blockUser(req.user, req.params.userId, req), "User blocked");

const unblock = async (req, res) =>
  sendSuccess(res, await safetyService.unblockUser(req.user, req.params.userId, req), "User unblocked");

const listBlocked = async (req, res) =>
  sendSuccess(res, await safetyService.getBlockedUsers(req.user));

const report = async (req, res) =>
  sendSuccess(res, await safetyService.createReport(req.user, req.body, req), "Report submitted", 201);

const listReports = async (req, res) =>
  sendSuccess(
    res,
    await safetyService.listReports({
      status: req.validatedQuery.status,
      page: req.validatedQuery.page,
      limit: req.validatedQuery.limit,
    }),
  );

const reviewReport = async (req, res) =>
  sendSuccess(
    res,
    await safetyService.reviewReport({
      reportId: req.params.reportId,
      moderator: req.user,
      status: req.body.status,
      resolution: req.body.moderatorNotes ?? req.body.resolution,
      req,
    }),
    "Report review saved",
  );

const myReports = async (req, res) => sendSuccess(res, await safetyService.listMyReports(req.user, req.validatedQuery));
const listModeration = async (req, res) => sendSuccess(res, await moderationService.listQueue(req.validatedQuery));
const decideModeration = async (req, res) => sendSuccess(res, await moderationService.decide({ recordId: req.params.recordId, moderator: req.user, action: req.body.action, reason: req.body.reason, req }), "Moderation decision saved");
const appealModeration = async (req, res) => sendSuccess(res, await moderationService.appeal({ recordId: req.params.recordId, user: req.user, reason: req.body.reason, req }), "Appeal submitted for moderator review", 202);
const listContacts = async (req, res) => sendSuccess(res, { items: (await safetyCenter.contacts(req.user)).map((item) => ({ id: item._id.toString(), name: item.name, relationship: item.relationship, phone: item.phone, email: item.email, primary: item.primary, createdAt: item.createdAt, updatedAt: item.updatedAt })) });
const addContact = async (req, res) => sendSuccess(res, { contact: await safetyCenter.saveContact(req.user, req.body, null, req) }, "Emergency contact saved", 201);
const updateContact = async (req, res) => sendSuccess(res, { contact: await safetyCenter.saveContact(req.user, req.body, req.params.contactId, req) }, "Emergency contact updated");
const removeContact = async (req, res) => sendSuccess(res, await safetyCenter.removeContact(req.user, req.params.contactId, req), "Emergency contact removed");
const settings = async (req, res) => sendSuccess(res, { settings: await safetyCenter.getSafetySettings(req.user) });
const updateSettings = async (req, res) => sendSuccess(res, { settings: await safetyCenter.updateSafetySettings(req.user, req.body, req) }, "Safety settings updated");
const tripSafety = async (req, res) => sendSuccess(res, await safetyCenter.getTripSafety(req.params.tripId, req.user));
const updateTripSafety = async (req, res) => sendSuccess(res, await safetyCenter.updateTripSafety(req.params.tripId, req.user, req.body, req), "Trip safety information updated");

module.exports = { block, unblock, listBlocked, report, listReports, reviewReport, myReports, listModeration, decideModeration, appealModeration, listContacts, addContact, updateContact, removeContact, settings, updateSettings, tripSafety, updateTripSafety };
