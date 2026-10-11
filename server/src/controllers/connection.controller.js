const { sendSuccess } = require("../utils/http");
const connectionService = require("../services/connection.service");

const create = async (req, res) => sendSuccess(res, { connection: await connectionService.sendRequest(req.user, req.body, req) }, "Connection request sent", 201);
const list = async (req, res) => sendSuccess(res, await connectionService.listAccepted(req.user, req.validatedQuery));
const received = async (req, res) => sendSuccess(res, await connectionService.listReceived(req.user, req.validatedQuery));
const sent = async (req, res) => sendSuccess(res, await connectionService.listSent(req.user, req.validatedQuery));
const detail = async (req, res) => sendSuccess(res, { connection: await connectionService.getDetails(req.params.connectionId, req.user) });
const accept = async (req, res) => sendSuccess(res, { connection: await connectionService.accept(req.params.connectionId, req.user, req) }, "Connection accepted");
const reject = async (req, res) => sendSuccess(res, { connection: await connectionService.reject(req.params.connectionId, req.user, req) }, "Connection request rejected");
const cancel = async (req, res) => sendSuccess(res, { connection: await connectionService.cancel(req.params.connectionId, req.user, req) }, "Connection request cancelled");
const unmatch = async (req, res) => sendSuccess(res, { connection: await connectionService.unmatch(req.params.connectionId, req.user, req) }, "Connection removed");

module.exports = { create, list, received, sent, detail, accept, reject, cancel, unmatch };
