const { sendSuccess } = require("../utils/http");
const assistant = require("../services/assistant.service");

const create = async (req, res) => sendSuccess(res, { conversation: await assistant.createConversation(req.user, req.body) }, "Assistant conversation created", 201);
const list = async (req, res) => sendSuccess(res, await assistant.listConversations(req.user, req.validatedQuery));
const history = async (req, res) => sendSuccess(res, await assistant.history(req.user, req.params.conversationId, req.validatedQuery));
const sendMessage = async (req, res) => sendSuccess(res, await assistant.sendMessage(req, req.params.conversationId, req.body), "Assistant response ready", 201);
const archive = async (req, res) => sendSuccess(res, await assistant.archiveConversation(req.user, req.params.conversationId, req.body.archived));
const remove = async (req, res) => sendSuccess(res, await assistant.deleteConversation(req.user, req.params.conversationId), "Conversation deleted");
const usage = async (req, res) => sendSuccess(res, await assistant.usage(req.user));

module.exports = { create, list, history, sendMessage, archive, remove, usage };
