const mongoose = require("mongoose");

const budgetRangeSchema = new mongoose.Schema(
  {
    min: { type: Number, min: 0, default: null },
    max: { type: Number, min: 0, default: null },
    currency: { type: String, uppercase: true, trim: true, maxlength: 3, default: "USD" },
  },
  { _id: false },
);
const groupSizeRangeSchema = new mongoose.Schema(
  {
    min: { type: Number, min: 1, max: 100, default: null },
    max: { type: Number, min: 1, max: 100, default: null },
  },
  { _id: false },
);
const availabilitySchema = new mongoose.Schema(
  {
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
  },
  { _id: false },
);

const travelPreferencesSchema = new mongoose.Schema(
  {
    destinations: { type: [String], default: [] },
    excludedDestinations: { type: [String], default: [] },
    interests: { type: [String], default: [] },
    activities: { type: [String], default: [] },
    travelStyle: { type: String, trim: true, maxlength: 80, default: "" },
    budget: { type: String, trim: true, maxlength: 80, default: "" },
    budgetRange: { type: budgetRangeSchema, default: () => ({}) },
    groupPreference: { type: String, trim: true, maxlength: 80, default: "" },
    groupSizeRange: { type: groupSizeRangeSchema, default: () => ({}) },
    availability: { type: availabilitySchema, default: null },
    dateFlexibilityDays: { type: Number, min: 0, max: 31, default: 0 },
    accommodationPreference: { type: [String], default: [] },
    transportPreference: { type: [String], default: [] },
    foodPreference: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    travelPace: { type: String, enum: ["RELAXED", "MODERATE", "FAST", ""], default: "" },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    accountStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BANNED"],
      default: "ACTIVE",
      index: true,
    },
    safetySettings: {
      discoverable: { type: Boolean, default: true },
      allowConnectionRequests: { type: Boolean, default: true },
    },
    notificationPreferences: { type: Map, of: Boolean, default: () => new Map() },
    razorpayLinkedAccountId: { type: String, trim: true, maxlength: 80, match: /^acc_[A-Za-z0-9]+$/, select: false, default: null },
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

userSchema.index({ name: 1, createdAt: -1 });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
