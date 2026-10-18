const { sendSuccess } = require("../utils/http");
const adminService = require("../services/admin.service");

const overview = async (_req, res) => sendSuccess(res, await adminService.overview());
const users = async (req, res) => sendSuccess(res, await adminService.listUsers(req.validatedQuery));
const trips = async (req, res) => sendSuccess(res, await adminService.listTrips(req.validatedQuery));
const audits = async (req, res) => sendSuccess(res, await adminService.listAudits(req.validatedQuery));
const changeStatus = async (req, res) => sendSuccess(res, await adminService.changeUserStatus(req, req.params.userId, req.body.status, req.body.reason), "Account status updated");
const changeRole = async (req, res) => sendSuccess(res, await adminService.changeUserRole(req, req.params.userId, req.body.role, req.body.reason), "Account role updated");

module.exports = { overview, users, trips, audits, changeStatus, changeRole };
