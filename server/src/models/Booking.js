const mongoose = require("mongoose");

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, enum: ["USER_RECORDED", "EXTERNAL_HANDOFF", "CANCELLED"], required: true },
  changedAt: { type: Date, default: Date.now },
  note: { type: String, trim: true, maxlength: 240, default: "" },
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
  itinerary: { type: mongoose.Schema.Types.ObjectId, ref: "Itinerary", default: null },
  category: { type: String, enum: ["ACCOMMODATION", "TRANSPORT", "ACTIVITY"], required: true },
  provider: { type: String, enum: ["GOOGLE_TRAVEL", "GOOGLE_MAPS"], required: true },
  serviceName: { type: String, trim: true, required: true, maxlength: 160 },
  destination: { type: String, trim: true, required: true, maxlength: 160 },
  externalUrl: { type: String, trim: true, required: true, maxlength: 2048 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  travellers: { type: Number, min: 1, max: 20, required: true },
  userEstimate: {
    amount: { type: Number, min: 0, max: 100000000, default: null },
    currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: null },
    source: { type: String, enum: ["USER_ESTIMATE", null], default: null },
  },
  travellerNote: { type: String, trim: true, maxlength: 1000, default: "" },
  status: { type: String, enum: ["USER_RECORDED", "EXTERNAL_HANDOFF", "CANCELLED"], required: true },
  statusHistory: { type: [statusHistorySchema], default: [] },
  idempotencyKey: { type: String, required: true, maxlength: 64 },
}, { timestamps: true });

bookingSchema.index({ owner: 1, createdAt: -1 });
bookingSchema.index({ createdAt: 1 });
bookingSchema.index({ "statusHistory.changedAt": 1, "statusHistory.status": 1 });
bookingSchema.index({ trip: 1, status: 1, startDate: 1 });
bookingSchema.index({ status: 1, startDate: 1 });
bookingSchema.index({ provider: 1, createdAt: -1 });
bookingSchema.index({ owner: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
