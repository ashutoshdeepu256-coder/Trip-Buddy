const { sendSuccess } = require("../utils/http");
const reviewService = require("../services/review.service");

const listTraveller = async (req, res) => sendSuccess(res, await reviewService.list(req, { userId: req.params.userId, ...req.validatedQuery }));
const summaryTraveller = async (req, res) => sendSuccess(res, await reviewService.getSummary(req, { userId: req.params.userId }));
const listTrip = async (req, res) => sendSuccess(res, await reviewService.list(req, { tripId: req.params.tripId, ...req.validatedQuery }));
const summaryTrip = async (req, res) => sendSuccess(res, await reviewService.getSummary(req, { tripId: req.params.tripId }));
const eligibility = async (req, res) => sendSuccess(res, await reviewService.eligibility(req, req.params.tripId));
const create = async (req, res) => {
  const review = await reviewService.create(req, req.body);
  return sendSuccess(res, review, review.status === "HIDDEN" ? "Review saved for safety review" : "Review published", review.status === "HIDDEN" ? 202 : 201);
};
const get = async (req, res) => sendSuccess(res, await reviewService.get(req, req.params.reviewId));
const update = async (req, res) => sendSuccess(res, await reviewService.update(req, req.params.reviewId, req.body), "Review updated");
const remove = async (req, res) => sendSuccess(res, await reviewService.remove(req, req.params.reviewId), "Review removed");
const report = async (req, res) => sendSuccess(res, await reviewService.report(req, req.params.reviewId, req.body), "Review reported", 201);
const listReports = async (req, res) => sendSuccess(res, await reviewService.listReports(req.validatedQuery));
const moderate = async (req, res) => sendSuccess(res, await reviewService.moderate(req, req.params.reviewId, req.body), "Review moderation saved");
const resolveReport = async (req, res) => sendSuccess(res, await reviewService.resolveReport(req, req.params.reportId, req.body), "Review report resolved");

module.exports = { listTraveller, summaryTraveller, listTrip, summaryTrip, eligibility, create, get, update, remove, report, listReports, moderate, resolveReport };
