const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["CONNECTION_REQUEST", "CONNECTION_ACCEPTED", "CONNECTION_REJECTED", "CHAT_MESSAGE", "EXPENSE_CREATED", "EXPENSE_UPDATED", "EXPENSE_VOIDED", "SETTLEMENT_RECORDED", "PAYMENT_SUCCEEDED", "SAFETY_REPORT_STATUS"], required: true },
  category: { type: String, enum: ["CONNECTIONS", "MESSAGES", "EXPENSES", "PAYMENTS", "SAFETY"], required: true, index: true },
  title: { type: String, required: true, maxlength: 120 },
  body: { type: String, required: true, maxlength: 240 },
  metadata: { route: { type: String, required: true, maxlength: 256 } },
  relatedEntityType: { type: String, enum: ["Connection", "Conversation", "Trip", "Expense", "ExpenseSettlement", "PaymentAttempt", "Report"], default: null },
  relatedEntityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  deduplicationKey: { type: String, maxlength: 200, default: null },
  readAt: { type: Date, default: null },
  dismissedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

notificationSchema.index({ recipient:  1, createdAt: -1, _id: -1 });
notificationSchema.index({ recipient: 1, readAt: 1, dismissedAt: 1, createdAt: -1 });
notificationSchema.index({ deduplicationKey: 1 }, { unique: true, partialFilterExpression: { deduplicationKey: { $type: "string" } } });
notificationSchema.index({ createdAt: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
