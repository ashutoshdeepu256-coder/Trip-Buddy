const mongoose = require("mongoose");
const { supportedCurrencies, MAX_MINOR_UNITS } = require("../utils/money");

const settlementSchema = new mongoose.Schema({
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromNameAtCreation: { type: String, trim: true, required: true, maxlength: 80 },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  toNameAtCreation: { type: String, trim: true, required: true, maxlength: 80 },
  amountMinorUnits: { type: Number, min: 1, max: MAX_MINOR_UNITS, required: true, validate: Number.isSafeInteger },
  currency: { type: String, enum: supportedCurrencies, required: true },
  note: { type: String, trim: true, maxlength: 240, default: "" },
  status: { type: String, enum: ["RECORDED", "REVERSED"], default: "RECORDED", index: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recordedAt: { type: Date, default: Date.now },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reversedAt: { type: Date, default: null },
  reversalReason: { type: String, trim: true, maxlength: 240, default: "" },
  idempotencyKey: { type: String, required: true, maxlength: 64 },
}, { timestamps: true });

settlementSchema.index({ trip: 1, status: 1, recordedAt: -1 });
settlementSchema.index({ trip: 1, currency: 1, status: 1 });
settlementSchema.index({ trip: 1, recordedBy: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.models.ExpenseSettlement || mongoose.model("ExpenseSettlement", settlementSchema);
