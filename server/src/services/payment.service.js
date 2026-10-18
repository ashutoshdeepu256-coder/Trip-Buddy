const crypto = require("node:crypto");
const mongoose = require("mongoose");
const ExpenseSettlement = require("../models/ExpenseSettlement");
const PaymentAttempt = require("../models/PaymentAttempt");
const PaymentWebhookEvent = require("../models/PaymentWebhookEvent");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Expense = require("../models/Expense");
const { HttpError } = require("../utils/http");
const { buildLedger } = require("./expenseLedger.service");
const expenseService = require("./expense.service");
const paymentProvider = require("./paymentProvider.service");
const notificationService = require("./notification.service");

const activeTripStatuses = ["PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING", "COMPLETED"];
const reservedStatuses = ["CREATED", "PENDING", "AUTHORIZED", "TRANSFER_PENDING", "REFUND_PENDING"];
const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const paymentKey = (req) => {
  const value = req.get("idempotency-key");
  if (!value || !/^[\w-]{8,64}$/.test(value)) throw new HttpError(400, "A valid Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
  return value;
};
const fingerprint = (data) => `${data.tripId}:${data.recipientUserId}:${data.amountMinorUnits}:${data.currency}`;

const safePayment = (payment) => ({
  id: idOf(payment._id), tripId: idOf(payment.trip), payerId: idOf(payment.payer), payerName: payment.payerNameAtCreation, recipientId: idOf(payment.recipient), recipientName: payment.recipientNameAtCreation,
  settlementId: idOf(payment.settlement), amountMinorUnits: payment.amountMinorUnits, currency: payment.currency,
  provider: payment.provider, status: payment.status, providerStatus: payment.providerStatus,
  orderId: payment.providerOrderId, paymentId: payment.providerPaymentId, refundId: payment.providerRefundId, transferId: payment.providerTransferId,
  checkoutKeyId: payment.checkoutKeyId, succeededAt: payment.succeededAt, refundedAt: payment.refundedAt,
  refundedAmountMinorUnits: payment.refundedAmountMinorUnits || 0,
  createdAt: payment.createdAt, updatedAt: payment.updatedAt,
});

const addAudit = async ({ actor, action, attempt, session, eventId = null }) => AuditLog.create([{
  actor: actor || null, action, resourceType: "PAYMENT", resourceId: attempt._id,
  metadata: { tripId: idOf(attempt.trip), paymentAttemptId: idOf(attempt._id), ...(eventId ? { providerEventId: eventId } : {}) },
}], { session });

const markTripChanged = (tripId, session) => Trip.updateOne({ _id: tripId }, { $inc: { expenseRevision: 1 } }, { session });

const getCurrentBalance = async (tripId, currency, session) => {
  const [expenses, settlements] = await Promise.all([
    Expense.find({ trip: tripId, status: "ACTIVE" }).session(session).lean(),
    ExpenseSettlement.find({ trip: tripId, status: "RECORDED" }).session(session).lean(),
  ]);
  return buildLedger({ expenses, settlements }).find((entry) => entry.currency === currency);
};

const serializeAttempt = (payment, { includeCheckout = false } = {}) => {
  const result = safePayment(payment);
  if (includeCheckout && payment.providerOrderId && payment.checkoutKeyId && ["PENDING", "AUTHORIZED"].includes(payment.status)) {
    result.checkout = { key: payment.checkoutKeyId, orderId: payment.providerOrderId, amountMinorUnits: payment.amountMinorUnits, currency: payment.currency };
  }
  return result;
};

const ensureProviderReady = () => {
  if (!paymentProvider.isConfigured()) throw new HttpError(503, "Razorpay is not configured for this environment", "PAYMENT_PROVIDER_UNAVAILABLE");
};

const ensureRouteReady = () => {
  ensureProviderReady();
  if (!paymentProvider.configuration().routeEnabled) throw new HttpError(503, "Razorpay Route is not enabled for this account", "PAYMENT_ROUTE_UNAVAILABLE");
};

const makeOrder = async (attempt) => {
  ensureRouteReady();
  const config = paymentProvider.configuration();
  const provider = paymentProvider.getProvider();
  const order = await provider.orders.create({
    amount: attempt.amountMinorUnits,
    currency: attempt.currency,
    receipt: attempt.providerReceipt,
    partial_payment: false,
    notes: { tripbuddy_payment_attempt: idOf(attempt._id), trip_id: idOf(attempt.trip) },
    transfers: [{ account: attempt.providerRecipientAccountId, amount: attempt.amountMinorUnits, currency: attempt.currency, notes: { tripbuddy_payment_attempt: idOf(attempt._id) } }],
  });
  if (!order?.id || order.amount !== attempt.amountMinorUnits || order.currency !== attempt.currency) {
    throw new HttpError(502, "Payment provider returned an invalid order", "PAYMENT_PROVIDER_INVALID_ORDER");
  }
  const transfer = (order.transfers?.items || order.transfers || []).find((item) => item.recipient === attempt.providerRecipientAccountId && item.amount === attempt.amountMinorUnits && item.currency === attempt.currency);
  if (!transfer?.id) throw new HttpError(502, "Razorpay did not create the requested recipient transfer", "PAYMENT_ROUTE_TRANSFER_MISSING");
  const updated = await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "CREATED", providerOrderId: null },
    { $set: { status: "PENDING", providerOrderId: order.id, providerTransferId: transfer.id, checkoutKeyId: config.keyId, providerStatus: order.status || "created" }, $push: { history: { status: "PENDING", source: "API" } } },
    { new: true, runValidators: true },
  );
  if (!updated) throw new HttpError(409, "Payment order is already being prepared; refresh the payment record", "PAYMENT_ORDER_PENDING");
  return updated;
};

const recoverOrder = async (attempt) => {
  if (attempt.providerOrderId) return attempt;
  ensureRouteReady();
  const response = await paymentProvider.getProvider().orders.all({ receipt: attempt.providerReceipt, count: 100 });
  const order = response.items?.find((item) => item.receipt === attempt.providerReceipt && item.amount === attempt.amountMinorUnits && item.currency === attempt.currency);
  if (!order?.id) return attempt;
  const routed = await paymentProvider.getProvider().orders.fetchTransferOrder(order.id);
  const transfer = routed.transfers?.items?.find((item) => item.recipient === attempt.providerRecipientAccountId && item.amount === attempt.amountMinorUnits && item.currency === attempt.currency);
  if (!transfer) throw new HttpError(409, "Recovered provider order does not contain the intended Route transfer", "PAYMENT_ROUTE_MISMATCH");
  return (await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: "CREATED", providerOrderId: null },
    { $set: { status: transfer.status === "processed" ? "TRANSFER_PENDING" : "PENDING", providerOrderId: order.id, providerTransferId: transfer.id, checkoutKeyId: paymentProvider.configuration().keyId, providerStatus: order.status || "created" }, $push: { history: { status: "PENDING", source: "RECONCILIATION" } } },
    { new: true, runValidators: true },
  )) || attempt;
};

const create = async (req, data) => {
  ensureRouteReady();
  const key = paymentKey(req);
  const actorId = idOf(req.user._id);
  const requestFingerprint = fingerprint(data);
  let attempt;
  let duplicate = false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const { trip } = await expenseService.assertActiveMember(data.tripId, req.user._id, session);
      if (!activeTripStatuses.includes(trip.status)) throw new HttpError(404, "Trip payment destination was not found", "PAYMENT_TRIP_NOT_FOUND");
      const prior = await PaymentAttempt.findOne({ payer: req.user._id, idempotencyKey: key }).session(session);
      if (prior) {
        if (prior.requestFingerprint !== requestFingerprint) throw new HttpError(409, "Idempotency-Key was already used for different payment details", "IDEMPOTENCY_KEY_REUSED");
        attempt = prior;
        duplicate = true;
        return;
      }
      const recipientId = new mongoose.Types.ObjectId(data.recipientUserId);
      if (actorId === data.recipientUserId) throw new HttpError(400, "A payment recipient must differ from the payer", "INVALID_PAYMENT_RECIPIENT");
      const [recipientMembership, recipient, payer] = await Promise.all([
        TripMember.findOne({ trip: data.tripId, user: recipientId, status: "ACTIVE", $or: [{ joinedAt: null }, { joinedAt: { $lte: new Date() } }] }).session(session).lean(),
        User.findById(recipientId).select("name accountStatus +razorpayLinkedAccountId").session(session).lean(),
        User.findById(req.user._id).select("name accountStatus").session(session).lean(),
      ]);
      if (!recipientMembership || !recipient || recipient.accountStatus !== "ACTIVE" || !payer || payer.accountStatus !== "ACTIVE") throw new HttpError(404, "Payment recipient is not an active Trip member", "PAYMENT_RECIPIENT_NOT_ACTIVE");
      if (!paymentProvider.configuration().routeEnabled || !/^acc_[A-Za-z0-9]+$/.test(recipient.razorpayLinkedAccountId || "")) throw new HttpError(409, "This Trip member is not onboarded as a Razorpay Route recipient", "PAYMENT_RECIPIENT_NOT_ONBOARDED");
      const ledger = await getCurrentBalance(data.tripId, data.currency, session);
      const payerBalance = ledger?.members.find((member) => member.userId === actorId)?.netMinorUnits || 0;
      const recipientBalance = ledger?.members.find((member) => member.userId === data.recipientUserId)?.netMinorUnits || 0;
      const reservations = await PaymentAttempt.find({ trip: data.tripId, currency: data.currency, status: { $in: reservedStatuses } }).session(session).lean();
      const payerReserved = reservations.filter((item) => idOf(item.payer) === actorId).reduce((sum, item) => sum + item.amountMinorUnits, 0);
      const recipientReserved = reservations.filter((item) => idOf(item.recipient) === data.recipientUserId).reduce((sum, item) => sum + item.amountMinorUnits, 0);
      const availableToPay = Math.max(0, -payerBalance - payerReserved);
      const availableToReceive = Math.max(0, recipientBalance - recipientReserved);
      if (payerBalance >= 0 || recipientBalance <= 0 || data.amountMinorUnits > Math.min(availableToPay, availableToReceive)) {
        throw new HttpError(409, "Payment exceeds the remaining Trip settlement obligation", "PAYMENT_EXCEEDS_OUTSTANDING_BALANCE", { maxAmountMinorUnits: Math.min(availableToPay, availableToReceive) });
      }
      [attempt] = await PaymentAttempt.create([{
        trip: trip._id, payer: req.user._id, payerNameAtCreation: payer.name, recipient: recipientId, recipientNameAtCreation: recipient.name, providerRecipientAccountId: recipient.razorpayLinkedAccountId, amountMinorUnits: data.amountMinorUnits,
        currency: data.currency, idempotencyKey: key, requestFingerprint,
        providerReceipt: `tb_${new mongoose.Types.ObjectId().toString()}`,
        history: [{ status: "CREATED", source: "API" }],
      }], { session });
      await markTripChanged(trip._id, session);
      await addAudit({ actor: req.user._id, action: "PAYMENT_CREATED", attempt, session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const prior = await PaymentAttempt.findOne({ payer: req.user._id, idempotencyKey: key });
    if (!prior) throw error;
    if (prior.requestFingerprint !== requestFingerprint) throw new HttpError(409, "Idempotency-Key was already used for different payment details", "IDEMPOTENCY_KEY_REUSED");
    attempt = prior;
    duplicate = true;
  } finally { await session.endSession(); }

  if (!duplicate && !attempt.providerOrderId && attempt.status === "CREATED") {
    try { attempt = await makeOrder(attempt); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      // Preserve the reservation when an upstream timeout leaves order creation ambiguous.
      throw new HttpError(503, "Payment order creation is pending provider confirmation. Retry with the same Idempotency-Key or reconcile the payment.", "PAYMENT_ORDER_CREATION_UNCERTAIN");
    }
  }
  if (!attempt.providerOrderId) attempt = await recoverOrder(attempt);
  return { payment: serializeAttempt(attempt, { includeCheckout: true }), duplicate, retryWithSameKey: attempt.status === "CREATED" };
};

const compareSignature = (expectedHex, actualHex) => {
  if (!/^[a-f\d]{64}$/i.test(actualHex || "")) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const verifyCheckoutSignature = ({ orderId, paymentId, signature, secret }) => {
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return compareSignature(expected, signature);
};

const assertProviderPaymentMatches = (attempt, providerPayment) => {
  if (!providerPayment || providerPayment.order_id !== attempt.providerOrderId || providerPayment.amount !== attempt.amountMinorUnits || providerPayment.currency !== attempt.currency) {
    throw new HttpError(409, "Provider payment does not match the reserved amount and order", "PAYMENT_PROVIDER_MISMATCH");
  }
};

const findMatchingTransfer = (attempt, providerOrder) => {
  const transfers = providerOrder.transfers?.items || providerOrder.transfers || [];
  return transfers.find((transfer) => transfer.recipient === attempt.providerRecipientAccountId && transfer.amount === attempt.amountMinorUnits && transfer.currency === attempt.currency);
};

const completeCapturedPayment = async ({ attempt, providerPayment, provider, providerOrder = null, source, actor = null, eventId = null, sharedSession = null, io = null }) => {
  assertProviderPaymentMatches(attempt, providerPayment);
  if (providerPayment.status !== "captured" || providerPayment.captured !== true) return { matched: true, payment: serializeAttempt(attempt), verified: false };
  const orderWithTransfers = providerOrder || await provider.orders.fetchTransferOrder(attempt.providerOrderId);
  const transfer = findMatchingTransfer(attempt, orderWithTransfers);
  if (!transfer || transfer.id !== attempt.providerTransferId) throw new HttpError(409, "Razorpay Route transfer does not match the intended recipient and amount", "PAYMENT_ROUTE_MISMATCH");
  if (transfer.status !== "processed") {
    const session = sharedSession || await mongoose.startSession();
    let current;
    const markPending = async (tx) => {
      current = await PaymentAttempt.findOneAndUpdate(
        { _id: attempt._id, status: { $in: ["PENDING", "AUTHORIZED", "TRANSFER_PENDING"] } },
        { $set: { status: transfer.status === "failed" || transfer.status === "reversed" ? "FAILED" : "TRANSFER_PENDING", providerPaymentId: providerPayment.id, providerTransferId: transfer.id, providerStatus: `transfer_${transfer.status}` }, $push: { history: { status: transfer.status === "failed" || transfer.status === "reversed" ? "FAILED" : "TRANSFER_PENDING", source: source === "WEBHOOK" ? "WEBHOOK" : source === "RECONCILIATION" ? "RECONCILIATION" : "API", providerEventId: eventId } } },
        { new: true, session: tx },
      );
      current ||= await PaymentAttempt.findById(attempt._id).session(tx);
      if (["failed", "reversed"].includes(transfer.status) && current.status === "FAILED") await addAudit({ actor, action: "PAYMENT_FAILED", attempt: current, session: tx, eventId });
    };
    if (sharedSession) await markPending(sharedSession);
    else { try { await session.withTransaction(() => markPending(session)); } finally { await session.endSession(); } }
    return { matched: true, payment: serializeAttempt(current || attempt), verified: false };
  }
  const result = await applyCapturedPayment({ providerPayment, providerTransfer: transfer, source, actor, eventId, sharedSession, io });
  return { ...result, verified: result.payment.status === "SUCCEEDED" };
};

const applyCapturedPayment = async ({ providerPayment, providerTransfer, source, actor = null, eventId = null, sharedSession = null, io = null }) => {
  const attemptBefore = await PaymentAttempt.findOne({ providerOrderId: providerPayment.order_id });
  if (!attemptBefore) return { matched: false };
  assertProviderPaymentMatches(attemptBefore, providerPayment);
  if (providerPayment.status !== "captured" || providerPayment.captured !== true) return { matched: true, payment: serializeAttempt(attemptBefore) };
  let attempt;
  const notificationKeys = [];
  const apply = async (session) => {
      attempt = await PaymentAttempt.findById(attemptBefore._id).session(session);
      if (!attempt) throw new HttpError(404, "Payment attempt was not found", "PAYMENT_NOT_FOUND");
      assertProviderPaymentMatches(attempt, providerPayment);
      if (providerTransfer.status !== "processed" || providerTransfer.recipient !== attempt.providerRecipientAccountId || providerTransfer.amount !== attempt.amountMinorUnits || providerTransfer.currency !== attempt.currency || providerTransfer.id !== attempt.providerTransferId) throw new HttpError(409, "Razorpay Route transfer has not been verified", "PAYMENT_ROUTE_TRANSFER_PENDING");
      if (attempt.status === "REFUNDED" || attempt.status === "REFUND_PENDING") return;
      if (attempt.status === "SUCCEEDED") {
        if (idOf(attempt.providerPaymentId) !== providerPayment.id) throw new HttpError(409, "Payment attempt already has a different captured payment", "PAYMENT_ALREADY_CAPTURED");
        return;
      }
      attempt.status = "SUCCEEDED";
      attempt.providerStatus = "captured";
      attempt.providerPaymentId = providerPayment.id;
      attempt.providerTransferId = providerTransfer.id;
      attempt.succeededAt = new Date();
      if (source === "CHECKOUT") attempt.checkoutSignatureVerifiedAt = new Date();
      attempt.history.push({ status: "SUCCEEDED", source: source === "WEBHOOK" ? "WEBHOOK" : source === "RECONCILIATION" ? "RECONCILIATION" : "API", providerEventId: eventId });
      const [settlement] = await ExpenseSettlement.create([{
        trip: attempt.trip, fromUser: attempt.payer, fromNameAtCreation: attempt.payerNameAtCreation,
        toUser: attempt.recipient, toNameAtCreation: attempt.recipientNameAtCreation, amountMinorUnits: attempt.amountMinorUnits,
        currency: attempt.currency, note: "Provider-verified Razorpay payment", source: "PROVIDER_VERIFIED",
        paymentAttempt: attempt._id, status: "RECORDED", recordedBy: attempt.payer,
        idempotencyKey: `razorpay_${attempt._id.toString()}`,
      }], { session });
      attempt.settlement = settlement._id;
      await attempt.save({ session });
      await markTripChanged(attempt.trip, session);
      await addAudit({ actor, action: "PAYMENT_SUCCEEDED", attempt, session, eventId });
      for (const recipientId of [attempt.payer, attempt.recipient]) {
        const key = `payment:${idOf(attempt._id)}:SUCCEEDED:${idOf(recipientId)}`;
        notificationKeys.push(key);
        await notificationService.persist({
          recipient: recipientId, actorId: attempt.payer, type: "PAYMENT_SUCCEEDED", category: "PAYMENTS",
          title: "Trip payment update", body: "A trip payment was verified. View payment details for more information.",
          metadata: { route: "/payments" }, relatedEntityType: "PaymentAttempt", relatedEntityId: attempt._id,
          deduplicationKey: key,
        }, { session });
      }
  };
  if (sharedSession) await apply(sharedSession);
  else {
    const session = await mongoose.startSession();
    try { await session.withTransaction(() => apply(session)); }
    finally { await session.endSession(); }
    await notificationService.dispatchByDeduplicationKeys(notificationKeys, io);
  }
  return { matched: true, payment: serializeAttempt(attempt || attemptBefore), notificationKeys };
};

const verifyCheckout = async (req, data) => {
  const attempt = await PaymentAttempt.findById(req.params.paymentId);
  if (!attempt || idOf(attempt.payer) !== idOf(req.user._id)) throw new HttpError(404, "Payment was not found", "PAYMENT_NOT_FOUND");
  if (data.razorpay_order_id !== attempt.providerOrderId) throw new HttpError(400, "Checkout order does not match this payment", "PAYMENT_ORDER_MISMATCH");
  const config = paymentProvider.configuration();
  if (!verifyCheckoutSignature({ orderId: data.razorpay_order_id, paymentId: data.razorpay_payment_id, signature: data.razorpay_signature, secret: config.keySecret })) {
    throw new HttpError(400, "Checkout signature is invalid", "PAYMENT_SIGNATURE_INVALID");
  }
  ensureRouteReady();
  const providerPayment = await paymentProvider.getProvider().payments.fetch(data.razorpay_payment_id);
  assertProviderPaymentMatches(attempt, providerPayment);
  const result = await completeCapturedPayment({ attempt, providerPayment, provider: paymentProvider.getProvider(), source: "CHECKOUT", actor: req.user._id, io: req.app?.get?.("io") });
  return { payment: result.payment, verified: result.verified };
};

const transitionRefunded = async ({ attemptId, providerRefund, providerPayment, providerTransfer, source, eventId = null, sharedSession = null }) => {
  let attempt;
  const apply = async (session) => {
      attempt = await PaymentAttempt.findById(attemptId).session(session);
      if (!attempt) throw new HttpError(404, "Payment attempt was not found", "PAYMENT_NOT_FOUND");
      if (attempt.status === "REFUNDED") return;
      const refundedTotal = providerPayment?.amount_refunded;
      if (Number.isSafeInteger(refundedTotal) && refundedTotal <= (attempt.refundedAmountMinorUnits || 0)) return;
      const transferReturned = providerTransfer && providerTransfer.id === attempt.providerTransferId && providerTransfer.recipient === attempt.providerRecipientAccountId && (
        (Number.isSafeInteger(refundedTotal) && refundedTotal > 0 && providerTransfer.amount_reversed >= refundedTotal && ["reversed", "partially_reversed"].includes(providerTransfer.status)) ||
        (providerPayment?.refund_status === "full" && providerTransfer.status === "failed" && (providerTransfer.amount_reversed || 0) === 0)
      );
      if (providerRefund.payment_id !== attempt.providerPaymentId || providerRefund.currency !== attempt.currency || providerRefund.status !== "processed" || !Number.isSafeInteger(refundedTotal) || refundedTotal <= attempt.refundedAmountMinorUnits || refundedTotal > attempt.amountMinorUnits || !transferReturned) {
        throw new HttpError(409, "Provider refund does not match the original captured payment", "PAYMENT_REFUND_MISMATCH");
      }
      if (attempt.status !== "REFUND_PENDING" && attempt.status !== "SUCCEEDED" && attempt.status !== "FAILED" && attempt.status !== "PARTIALLY_REFUNDED") return;
      const remainingPaid = attempt.amountMinorUnits - refundedTotal;
      attempt.status = remainingPaid === 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
      attempt.providerStatus = remainingPaid === 0 ? "refunded" : "partially_refunded";
      attempt.providerRefundId = providerRefund.id;
      attempt.refundedAmountMinorUnits = refundedTotal;
      attempt.refundedAt = remainingPaid === 0 ? new Date() : null;
      attempt.refundStartedFrom = null;
      attempt.history.push({ status: attempt.status, source: ["WEBHOOK", "API"].includes(source) ? source : "RECONCILIATION", providerEventId: eventId });
      await attempt.save({ session });
      await ExpenseSettlement.updateOne(
        { _id: attempt.settlement, paymentAttempt: attempt._id, source: "PROVIDER_VERIFIED", status: "RECORDED" },
        remainingPaid === 0
          ? { $set: { status: "REVERSED", reversedAt: new Date(), reversalReason: "Provider confirmed full refund" } }
          : { $set: { amountMinorUnits: remainingPaid } }, { session },
      );
      await markTripChanged(attempt.trip, session);
      await addAudit({ actor: null, action: "PAYMENT_REFUNDED", attempt, session, eventId });
  };
  if (sharedSession) await apply(sharedSession);
  else {
    const session = await mongoose.startSession();
    try { await session.withTransaction(() => apply(session)); }
    finally { await session.endSession(); }
  }
  return serializeAttempt(attempt);
};

const verifyWebhookSignature = (rawBody, signature, secret) => {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return compareSignature(expected, signature);
};

const processWebhook = async ({ rawBody, signature, eventId, provider, io = null }) => {
  const config = paymentProvider.configuration();
  if (!config.webhookSecret) throw new HttpError(503, "Razorpay webhook secret is not configured", "PAYMENT_WEBHOOK_UNAVAILABLE");
  if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) throw new HttpError(400, "Webhook signature is invalid", "PAYMENT_WEBHOOK_SIGNATURE_INVALID");
  if (!eventId || eventId.length > 128) throw new HttpError(400, "Webhook event ID is missing or invalid", "PAYMENT_WEBHOOK_EVENT_ID_INVALID");
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { throw new HttpError(400, "Webhook body is not valid JSON", "PAYMENT_WEBHOOK_INVALID_JSON"); }
  const eventType = payload?.event;
  const allowedEvents = ["payment.authorized", "payment.captured", "payment.failed", "order.paid", "transfer.processed", "transfer.reversed", "refund.processed", "refund.failed", "refund.created"];
  if (!allowedEvents.includes(eventType)) throw new HttpError(400, "Webhook event type is unsupported", "PAYMENT_WEBHOOK_EVENT_UNSUPPORTED");
  if (await PaymentWebhookEvent.exists({ provider: "RAZORPAY", eventId })) return { duplicate: true };
  let match = null;
  let providerPayment = null;
  let providerOrder = null;
  let providerRefund = null;
  const api = provider || paymentProvider.getProvider();
  if (["payment.authorized", "payment.captured", "payment.failed", "order.paid", "transfer.processed", "transfer.reversed"].includes(eventType)) {
    const entity = eventType === "order.paid" ? payload.payload?.order?.entity : ["transfer.processed", "transfer.reversed"].includes(eventType) ? payload.payload?.transfer?.entity : payload.payload?.payment?.entity;
    const orderId = entity?.order_id || entity?.source || entity?.id;
    if (orderId) match = await PaymentAttempt.findOne({ $or: [{ providerOrderId: orderId }, { providerTransferId: entity?.id }] });
    if (match) {
      if (eventType === "order.paid" || eventType === "transfer.processed") {
        providerOrder = await api.orders.fetchTransferOrder(match.providerOrderId);
        const payments = await api.orders.fetchPayments(match.providerOrderId);
        providerPayment = payments.items?.find((item) => item.status === "captured" && item.captured === true);
      } else if (eventType === "transfer.reversed") {
        providerOrder = await api.orders.fetchTransferOrder(match.providerOrderId);
        const payments = await api.orders.fetchPayments(match.providerOrderId);
        providerPayment = payments.items?.find((item) => item.status === "captured" && item.captured === true);
        if (providerPayment?.amount_refunded > 0) {
          const refunds = await api.payments.fetchMultipleRefund(providerPayment.id);
          providerRefund = refunds.items?.filter((item) => item.status === "processed").sort((left, right) => right.created_at - left.created_at)[0] || null;
        }
      } else if (entity?.id) {
        providerPayment = await api.payments.fetch(entity.id);
        if (providerPayment?.status === "captured" && providerPayment.captured === true) providerOrder = await api.orders.fetchTransferOrder(match.providerOrderId);
      }
    }
  } else {
    const entity = payload.payload?.refund?.entity;
    if (!entity?.id || !entity.payment_id) throw new HttpError(400, "Refund webhook is missing required fields", "PAYMENT_WEBHOOK_INVALID_EVENT");
    match = await PaymentAttempt.findOne({ $or: [{ providerRefundId: entity.id }, { providerPaymentId: entity.payment_id }] });
    if (match && eventType !== "refund.created") {
      [providerPayment, providerRefund] = await Promise.all([api.payments.fetch(entity.payment_id), api.payments.fetchRefund(entity.payment_id, entity.id)]);
      providerOrder = await api.orders.fetchTransferOrder(match.providerOrderId);
    }
  }
  const session = await mongoose.startSession();
  let duplicate = false;
  let notificationKeys = [];
  try {
    await session.withTransaction(async () => {
      if (await PaymentWebhookEvent.exists({ provider: "RAZORPAY", eventId }).session(session)) { duplicate = true; return; }
      let currentAttempt = match ? await PaymentAttempt.findById(match._id).session(session) : null;
      if (currentAttempt && providerPayment?.status === "captured" && providerPayment.captured === true && eventType !== "transfer.reversed") {
        const result = await completeCapturedPayment({ attempt: currentAttempt, providerPayment, provider: api, providerOrder, source: "WEBHOOK", eventId, sharedSession: session, io });
        notificationKeys = result.notificationKeys || [];
        currentAttempt = result.matched ? currentAttempt : null;
      } else if (currentAttempt && eventType === "transfer.reversed") {
        const transfer = findMatchingTransfer(currentAttempt, providerOrder);
        const verifiedRefund = providerRefund && ["partial", "full"].includes(providerPayment?.refund_status)
          && providerPayment.amount_refunded > (currentAttempt.refundedAmountMinorUnits || 0);
        if (verifiedRefund && transfer) {
          await transitionRefunded({ attemptId: currentAttempt._id, providerRefund, providerPayment, providerTransfer: transfer, source: "WEBHOOK", eventId, sharedSession: session });
        } else if (transfer?.status === "reversed" && transfer.amount_reversed >= currentAttempt.amountMinorUnits && currentAttempt.status === "SUCCEEDED") {
          await ExpenseSettlement.updateOne({ paymentAttempt: currentAttempt._id, source: "PROVIDER_VERIFIED", status: "RECORDED" }, { $set: { status: "REVERSED", reversedAt: new Date(), reversalReason: "Razorpay Route transfer was reversed" } }, { session });
          await PaymentAttempt.updateOne({ _id: currentAttempt._id, status: "SUCCEEDED" }, { $set: { status: "FAILED", providerStatus: "transfer_reversed" }, $push: { history: { status: "FAILED", source: "WEBHOOK", providerEventId: eventId } } }, { session });
          await markTripChanged(currentAttempt.trip, session);
          await addAudit({ actor: null, action: "PAYMENT_FAILED", attempt: currentAttempt, session, eventId });
        } else if (transfer?.status === "reversed" && transfer.amount_reversed >= currentAttempt.amountMinorUnits && ["PENDING", "AUTHORIZED", "TRANSFER_PENDING"].includes(currentAttempt.status)) {
          await PaymentAttempt.updateOne({ _id: currentAttempt._id, status: { $in: ["PENDING", "AUTHORIZED", "TRANSFER_PENDING"] } }, { $set: { status: "FAILED", providerStatus: "transfer_reversed" }, $push: { history: { status: "FAILED", source: "WEBHOOK", providerEventId: eventId } } }, { session });
        }
      } else if (currentAttempt && eventType === "payment.authorized" && providerPayment?.status === "authorized") {
        await PaymentAttempt.updateOne({ _id: currentAttempt._id, status: "PENDING" }, { $set: { status: "AUTHORIZED", providerStatus: "authorized" }, $push: { history: { status: "AUTHORIZED", source: "WEBHOOK", providerEventId: eventId } } }, { session });
      } else if (currentAttempt && eventType === "payment.failed" && providerPayment?.status === "failed") {
        // A failed payment try does not close the order; Checkout can retry the same reserved order.
        await PaymentAttempt.updateOne({ _id: currentAttempt._id, status: { $in: ["PENDING", "AUTHORIZED"] } }, { $set: { providerStatus: "failed" } }, { session });
      } else if (currentAttempt && eventType === "refund.processed" && ["partial", "full"].includes(providerPayment?.refund_status) && providerPayment.amount_refunded > (currentAttempt.refundedAmountMinorUnits || 0)) {
        const transfer = findMatchingTransfer(currentAttempt, providerOrder);
        if (transfer) await transitionRefunded({ attemptId: currentAttempt._id, providerRefund, providerPayment, providerTransfer: transfer, source: "WEBHOOK", eventId, sharedSession: session });
      } else if (currentAttempt && eventType === "refund.failed" && providerPayment?.refund_status !== "full") {
        const restoreStatus = currentAttempt.refundStartedFrom || (currentAttempt.settlement ? "SUCCEEDED" : "FAILED");
        const restoreProviderStatus = restoreStatus === "FAILED" ? "transfer_failed" : restoreStatus === "PARTIALLY_REFUNDED" ? "partially_refunded" : "refund_failed";
        await PaymentAttempt.updateOne({ _id: currentAttempt._id, status: "REFUND_PENDING" }, { $set: { status: restoreStatus, providerStatus: restoreProviderStatus, providerRefundId: null, refundStartedFrom: null }, $push: { history: { status: restoreStatus, source: "WEBHOOK", providerEventId: eventId } } }, { session });
      }
      await PaymentWebhookEvent.create([{ provider: "RAZORPAY", eventId, eventType, paymentAttempt: currentAttempt?._id || null, status: currentAttempt ? "PROCESSED" : "IGNORED" }], { session });
    });
  } catch (error) {
    if (error.code === 11000) return { duplicate: true };
    throw error;
  } finally { await session.endSession(); }
  if (duplicate) return { duplicate: true };
  await notificationService.dispatchByDeduplicationKeys(notificationKeys, io);
  return { duplicate: false, matched: Boolean(match) };
};

const getAuthorized = async (req) => {
  const payment = await PaymentAttempt.findById(req.params.paymentId);
  const actorId = idOf(req.user._id);
  if (!payment || (idOf(payment.payer) !== actorId && idOf(payment.recipient) !== actorId)) throw new HttpError(404, "Payment was not found", "PAYMENT_NOT_FOUND");
  return serializeAttempt(payment, { includeCheckout: idOf(payment.payer) === actorId });
};

const list = async (actor, { page, limit }) => {
  const filter = { $or: [{ payer: actor._id }, { recipient: actor._id }] };
  const [items, total] = await Promise.all([
    PaymentAttempt.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    PaymentAttempt.countDocuments(filter),
  ]);
  return { items: items.map((item) => safePayment(item)), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const getPayerAttempt = async (req) => {
  const payment = await PaymentAttempt.findOne({ _id: req.params.paymentId, payer: req.user._id });
  if (!payment) throw new HttpError(404, "Payment was not found", "PAYMENT_NOT_FOUND");
  return payment;
};

const reconcile = async (req) => {
  const attempt = await getPayerAttempt(req);
  ensureRouteReady();
  if (!attempt.providerOrderId) {
    const recovered = await recoverOrder(attempt);
    return { payment: serializeAttempt(recovered, { includeCheckout: true }), reconciled: false };
  }
  const provider = paymentProvider.getProvider();
  const order = await provider.orders.fetch(attempt.providerOrderId);
  if (order.amount !== attempt.amountMinorUnits || order.currency !== attempt.currency) throw new HttpError(409, "Provider order does not match the payment attempt", "PAYMENT_PROVIDER_MISMATCH");
  const payments = await provider.orders.fetchPayments(attempt.providerOrderId);
  const orderWithTransfers = await provider.orders.fetchTransferOrder(attempt.providerOrderId);
  const captured = payments.items?.find((item) => item.status === "captured" && item.captured === true);
  const providerPayment = captured ? await provider.payments.fetch(captured.id) : attempt.providerPaymentId ? await provider.payments.fetch(attempt.providerPaymentId) : null;
  if (["REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(attempt.status) && providerPayment && ["partial", "full"].includes(providerPayment.refund_status) && providerPayment.amount_refunded > (attempt.refundedAmountMinorUnits || 0)) {
    const refunds = await provider.payments.fetchMultipleRefund(attempt.providerPaymentId);
    const refund = refunds.items?.filter((item) => item.status === "processed").sort((left, right) => right.created_at - left.created_at)[0];
    const transfer = findMatchingTransfer(attempt, orderWithTransfers);
    if (refund && transfer) return { payment: await transitionRefunded({ attemptId: attempt._id, providerRefund: refund, providerPayment, providerTransfer: transfer, source: "RECONCILIATION" }), reconciled: true };
  }
  if (captured) {
    const result = await completeCapturedPayment({ attempt, providerPayment, provider, providerOrder: orderWithTransfers, source: "RECONCILIATION", actor: req.user._id, io: req.app?.get?.("io") });
    return { payment: result.payment, reconciled: result.verified };
  }
  await PaymentAttempt.updateOne({ _id: attempt._id, status: { $in: ["PENDING", "AUTHORIZED", "TRANSFER_PENDING"] } }, { $set: { providerStatus: order.status || "created" } });
  const current = await PaymentAttempt.findById(attempt._id);
  return { payment: serializeAttempt(current, { includeCheckout: true }), reconciled: false };
};

const refund = async (req, { reason }) => {
  const attempt = await getPayerAttempt(req);
  if (attempt.status === "REFUNDED") return { payment: serializeAttempt(attempt), duplicate: true };
  const transferFailure = attempt.status === "FAILED" && attempt.providerPaymentId && attempt.providerStatus?.startsWith("transfer_");
  const canRefundRemainder = ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(attempt.status) || transferFailure;
  if (!canRefundRemainder) throw new HttpError(409, "Only a verified payment or failed Route transfer can be refunded", "PAYMENT_NOT_REFUNDABLE");
  const session = await mongoose.startSession();
  let pending;
  try {
    await session.withTransaction(async () => {
      pending = await PaymentAttempt.findOneAndUpdate(
        { _id: attempt._id, payer: req.user._id, status: attempt.status },
        { $set: { status: "REFUND_PENDING", refundStartedFrom: attempt.status, refundRequestedAt: new Date(), providerStatus: "refund_pending" }, $push: { history: { status: "REFUND_PENDING", source: "API" } } },
        { new: true, session },
      );
      if (!pending) {
        pending = await PaymentAttempt.findById(attempt._id).session(session);
        if (pending?.status !== "REFUND_PENDING") throw new HttpError(409, "Payment refund is already being processed", "PAYMENT_REFUND_CONFLICT");
      } else {
        await markTripChanged(attempt.trip, session);
        await addAudit({ actor: req.user._id, action: "PAYMENT_REFUND_REQUESTED", attempt: pending, session });
      }
    });
  } finally { await session.endSession(); }
  if (pending.status === "REFUNDED") return { payment: serializeAttempt(pending), duplicate: true };
  try {
    const refundAmount = attempt.amountMinorUnits - (attempt.refundedAmountMinorUnits || 0);
    const providerRefund = await paymentProvider.getProvider().payments.refund(attempt.providerPaymentId, {
      amount: refundAmount,
      reverse_all: true,
      notes: { tripbuddy_payment_attempt: idOf(attempt._id), reason: reason.slice(0, 180) },
    });
    if (providerRefund.id) {
      await PaymentAttempt.updateOne({ _id: attempt._id, status: "REFUND_PENDING" }, { $set: { providerRefundId: providerRefund.id, providerStatus: providerRefund.status || "refund_pending" } });
    }
    if (providerRefund.status === "processed" && providerRefund.amount === refundAmount) {
      const provider = paymentProvider.getProvider();
      const [orderWithTransfers, providerPayment] = await Promise.all([provider.orders.fetchTransferOrder(attempt.providerOrderId), provider.payments.fetch(attempt.providerPaymentId)]);
      const transfer = findMatchingTransfer(attempt, orderWithTransfers);
      if (transfer) return { payment: await transitionRefunded({ attemptId: attempt._id, providerRefund, providerPayment, providerTransfer: transfer, source: "API" }), duplicate: false };
    }
    return { payment: serializeAttempt(await PaymentAttempt.findById(attempt._id)), duplicate: false };
  } catch (error) {
    // Unknown outcomes stay reserved until a verified webhook or reconciliation resolves them.
    if (error instanceof HttpError) throw error;
    return { payment: serializeAttempt(await PaymentAttempt.findById(attempt._id)), duplicate: false, refundPending: true };
  }
};

module.exports = {
  create, getAuthorized, list, verifyCheckout, reconcile, refund,
  verifyCheckoutSignature, verifyWebhookSignature, processWebhook,
};
