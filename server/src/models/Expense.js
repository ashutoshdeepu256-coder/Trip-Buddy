const mongoose = require("mongoose");
const { supportedCurrencies, MAX_MINOR_UNITS } = require("../utils/money");

const allocationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  nameAtCreation: { type: String, trim: true, required: true, maxlength: 80 },
  amountMinorUnits: { type: Number, min: 0, max: MAX_MINOR_UNITS, required: true, validate: Number.isSafeInteger },
}, { _id: false });
const historySchema = new mongoose.Schema({
  action: { type: String, enum: ["CREATED", "UPDATED", "VOIDED"], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  at: { type: Date, default: Date.now },
  financialSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const expenseSchema = new mongoose.Schema({
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  payer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  payerNameAtCreation: { type: String, trim: true, required: true, maxlength: 80 },
  description: { type: String, trim: true, required: true, maxlength: 160 },
  category: { type: String, enum: ["ACCOMMODATION", "TRANSPORT", "FOOD", "ACTIVITY", "OTHER"], required: true },
  amountMinorUnits: { type: Number, min: 1, max: MAX_MINOR_UNITS, required: true, validate: Number.isSafeInteger },
  currency: { type: String, enum: supportedCurrencies, required: true },
  expenseDate: { type: Date, required: true },
  splitMethod: { type: String, enum: ["EQUAL", "EXACT", "PERCENTAGE", "WEIGHTED"], required: true },
  allocations: { type: [allocationSchema], required: true, validate: (items) => items.length > 0 && items.length <= 100 },
  privateNote: { type: String, trim: true, maxlength: 1000, default: "" },
  status: { type: String, enum: ["ACTIVE", "VOIDED"], default: "ACTIVE", index: true },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, trim: true, maxlength: 240, default: "" },
  history: { type: [historySchema], default: [] },
  revision: { type: Number, default: 1, min: 1 },
  idempotencyKey: { type: String, required: true, maxlength: 64 },
}, { timestamps: true });

expenseSchema.index({ trip: 1, status: 1, expenseDate: -1, _id: -1 });
expenseSchema.index({ trip: 1, currency: 1, status: 1 });
expenseSchema.index({ creator: 1, createdAt: -1 });
expenseSchema.index({ trip: 1, creator: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
