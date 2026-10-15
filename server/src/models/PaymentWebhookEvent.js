const mongoose = require("mongoose");

const paymentWebhookEventSchema = new mongoose.Schema({
  provider: { type: String, enum: ["RAZORPAY"], default: "RAZORPAY", required: true },
  eventId: { type: String, required: true, maxlength: 128 },
  eventType: { type: String, required: true, maxlength: 100 },
  paymentAttempt: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentAttempt", default: null },
  status: { type: String, enum: ["PROCESSED", "IGNORED"], required: true },
  processedAt: { type: Date, default: Date.now },
}, { timestamps: true });

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
paymentWebhookEventSchema.index({ paymentAttempt: 1, processedAt: -1 });

module.exports = mongoose.models.PaymentWebhookEvent || mongoose.model("PaymentWebhookEvent", paymentWebhookEventSchema);
