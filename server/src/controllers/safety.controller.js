const { sendSuccess } = require("../utils/http");
const safetyService = require("../services/safety.service");

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
      resolution: req.body.resolution,
      req,
    }),
    "Report review saved",
  );

module.exports = { block, unblock, listBlocked, report, listReports, reviewReport };
