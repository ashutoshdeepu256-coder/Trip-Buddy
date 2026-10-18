const mongoose = require("mongoose");
const { supportedCurrencies, MAX_MINOR_UNITS } = require("../utils/money");

const historySchema = new mongoose.Schema({
  status: { type: String, required: true, maxlength: 32 },
  at: { type: Date, default: Date.now },
  source: { type: String, enum: ["API", "WEBHOOK", "RECONCILIATION"], required: true },
  providerEventId: { type: String, default: null, maxlength: 128 },
}, { _id: false });

const paymentAttemptSchema = new mongoose.Schema({
  provider: { type: String, enum: ["RAZORPAY"], default: "RAZORPAY", required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true, index: true },
  payer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  payerNameAtCreation: { type: String, trim: true, required: true, maxlength: 80 },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  recipientNameAtCreation: { type: String, trim: true, required: true, maxlength: 80 },
  providerRecipientAccountId: { type: String, maxlength: 80, required: true },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: "ExpenseSettlement", default: null },
  amountMinorUnits: { type: Number, min: 100, max: MAX_MINOR_UNITS, required: true, validate: Number.isSafeInteger },
  currency: { type: String, enum: supportedCurrencies, required: true },
  status: { type: String, enum: ["CREATED", "PENDING", "AUTHORIZED", "TRANSFER_PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"], default: "CREATED", required: true, index: true },
  providerStatus: { type: String, maxlength: 40, default: null },
  providerOrderId: { type: String, maxlength: 80, default: null },
  providerPaymentId: { type: String, maxlength: 80, default: null },
  providerRefundId: { type: String, maxlength: 80, default: null },
  providerTransferId: { type: String, maxlength: 80, default: null },
  checkoutKeyId: { type: String, maxlength: 80, default: null },
  idempotencyKey: { type: String, required: true, maxlength: 64 },
  requestFingerprint: { type: String, required: true, maxlength: 160 },
  providerReceipt: { type: String, required: true, maxlength: 40 },
  checkoutSignatureVerifiedAt: { type: Date, default: null },
  succeededAt: { type: Date, default: null },
  refundRequestedAt: { type: Date, default: null },
  refundedAt: { type: Date, default: null },
  refundedAmountMinorUnits: { type: Number, min: 0, max: MAX_MINOR_UNITS, default: 0, validate: Number.isSafeInteger },
  refundStartedFrom: { type: String, enum: ["SUCCEEDED", "PARTIALLY_REFUNDED", "FAILED", null], default: null },
  failureCode: { type: String, maxlength: 80, default: null },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

paymentAttemptSchema.index({ payer: 1, idempotencyKey: 1 }, { unique: true });
paymentAttemptSchema.index({ provider: 1, providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } } });
paymentAttemptSchema.index({ provider: 1, providerPaymentId: 1 }, { unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } } });
paymentAttemptSchema.index({ provider: 1, providerRefundId: 1 }, { unique: true, partialFilterExpression: { providerRefundId: { $type: "string" } } });
paymentAttemptSchema.index({ provider: 1, providerTransferId: 1 }, { unique: true, partialFilterExpression: { providerTransferId: { $type: "string" } } });
paymentAttemptSchema.index({ trip: 1, createdAt: -1 });
paymentAttemptSchema.index({ createdAt: 1 });
paymentAttemptSchema.index({ "history.at": 1, "history.status": 1, "history.source": 1 });
paymentAttemptSchema.index({ trip: 1, payer: 1, recipient: 1, currency: 1, status: 1 });

module.exports = mongoose.models.PaymentAttempt || mongoose.model("PaymentAttempt", paymentAttemptSchema);
