const { sendSuccess } = require("../utils/http");
const paymentService = require("../services/payment.service");

const create = async (req, res) => {
  const result = await paymentService.create(req, req.body);
  return sendSuccess(res, result, result.duplicate ? "Existing payment returned" : "Payment order created", result.duplicate ? 200 : 201);
};
const list = async (req, res) => sendSuccess(res, await paymentService.list(req.user, req.validatedQuery));
const get = async (req, res) => sendSuccess(res, await paymentService.getAuthorized(req));
const verify = async (req, res) => sendSuccess(res, await paymentService.verifyCheckout(req, req.body), "Provider payment status checked");
const reconcile = async (req, res) => sendSuccess(res, await paymentService.reconcile(req), "Provider status reconciled");
const refund = async (req, res) => sendSuccess(res, await paymentService.refund(req, req.body), "Refund request processed");
const webhook = async (req, res) => {
  const result = await paymentService.processWebhook({
    rawBody: req.body,
    signature: req.get("x-razorpay-signature"),
    eventId: req.get("x-razorpay-event-id"),
    io: req.app?.get?.("io"),
  });
  return sendSuccess(res, result, "Webhook accepted");
};

module.exports = { create, list, get, verify, reconcile, refund, webhook };
