const { sendSuccess } = require("../utils/http");
const expenseService = require("../services/expense.service");

const participants = async (req, res) => sendSuccess(res, await expenseService.participants(req.user, req.params.tripId));
const summary = async (req, res) => sendSuccess(res, await expenseService.summary(req.user, req.params.tripId));
const list = async (req, res) => sendSuccess(res, await expenseService.list(req.user, req.params.tripId, req.validatedQuery));
const create = async (req, res) => {
  const result = await expenseService.create(req, req.params.tripId, req.body);
  return sendSuccess(res, result, result.duplicate ? "Existing expense returned" : "Expense created", result.duplicate ? 200 : 201);
};
const get = async (req, res) => sendSuccess(res, await expenseService.get(req.user, req.params.tripId, req.params.expenseId));
const update = async (req, res) => sendSuccess(res, await expenseService.update(req, req.params.tripId, req.params.expenseId, req.body), "Expense updated");
const voidExpense = async (req, res) => sendSuccess(res, await expenseService.voidExpense(req, req.params.tripId, req.params.expenseId, req.body), "Expense voided");
const suggestions = async (req, res) => sendSuccess(res, await expenseService.settlementSuggestions(req.user, req.params.tripId));
const settlements = async (req, res) => sendSuccess(res, await expenseService.listSettlements(req.user, req.params.tripId, req.validatedQuery));
const recordSettlement = async (req, res) => {
  const result = await expenseService.recordSettlement(req, req.params.tripId, req.body);
  return sendSuccess(res, result, result.duplicate ? "Existing settlement returned" : "User-reported settlement recorded", result.duplicate ? 200 : 201);
};
const reverseSettlement = async (req, res) => sendSuccess(res, await expenseService.reverseSettlement(req, req.params.tripId, req.params.settlementId, req.body), "Settlement record reversed");

module.exports = { participants, summary, list, create, get, update, voidExpense, suggestions, settlements, recordSettlement, reverseSettlement };
