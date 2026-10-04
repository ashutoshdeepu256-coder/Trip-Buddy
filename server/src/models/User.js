const mongoose = require("mongoose");

const travelPreferencesSchema = new mongoose.Schema(
  {
    destinations: { type: [String], default: [] },
    interests: { type: [String], default: [] },
    activities: { type: [String], default: [] },
    travelStyle: { type: String, trim: true, maxlength: 80, default: "" },
    budget: { type: String, trim: true, maxlength: 80, default: "" },
    groupPreference: { type: String, trim: true, maxlength: 80, default: "" },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    phoneNumber: { type: String, select: false, default: null },
    role: {
      type: String,
      enum: ["USER", "MODERATOR", "ADMIN"],
      default: "USER",
      select: false,
    },
    tokenVersion: { type: Number, default: 0, select: false },
    profile: {
      bio: { type: String, trim: true, maxlength: 1000, default: "" },
      city: { type: String, trim: true, maxlength: 100, default: "" },
      country: { type: String, trim: true, maxlength: 100, default: "" },
      travelPreferences: { type: travelPreferencesSchema, default: () => ({}) },
    },
    verification: {
      email: {
        status: {
          type: String,
          enum: ["NOT_VERIFIED", "PENDING", "VERIFIED", "REVOKED"],
          default: "NOT_VERIFIED",
        },
        verifiedAt: { type: Date, default: null },
      },
      phone: {
        status: {
          type: String,
          enum: ["NOT_VERIFIED", "PENDING", "VERIFIED", "REVOKED"],
          default: "NOT_VERIFIED",
        },
        verifiedAt: { type: Date, default: null },
        otpWindowStartedAt: { type: Date, default: null },
        otpSendCount: { type: Number, default: 0 },
      },
      identity: {
        status: {
          type: String,
          enum: ["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED"],
          default: "NOT_SUBMITTED",
        },
        verifiedAt: { type: Date, default: null },
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.role;
        delete ret.phoneNumber;
        delete ret.__v;
        return ret;
      },
    },
  },
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
