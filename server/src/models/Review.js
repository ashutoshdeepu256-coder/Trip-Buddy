const mongoose = require("mongoose");

const editSchema = new mongoose.Schema({
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, maxlength: 1000, default: "" },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
  rating: { type: Number, min: 1, max: 5, required: true, validate: Number.isInteger },
  comment: { type: String, trim: true, maxlength: 1000, default: "" },
  status: { type: String, enum: ["PUBLISHED", "HIDDEN", "REMOVED"], default: "PUBLISHED", required: true, index: true },
  editHistory: { type: [editSchema], default: [] },
  moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  moderatedAt: { type: Date, default: null },
  moderationReason: { type: String, maxlength: 500, default: "" },
}, { timestamps: true });

reviewSchema.index({ author: 1, reviewee: 1, trip: 1 }, { unique: true });
reviewSchema.index({ reviewee: 1, status: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ trip: 1, status: 1, createdAt: -1, _id: -1 });
reviewSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
