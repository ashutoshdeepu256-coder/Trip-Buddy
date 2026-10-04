const crypto = require("crypto");
const User = require("../models/User");
const Verification = require("../models/Verification");
const EmailVerificationToken = require("../models/EmailVerificationToken");
const { HttpError } = require("../utils/http");
const {
  randomToken,
  hashValue,
  hashOtp,
  safeCompare,
  normalizePhone,
} = require("../utils/security");
const { sendEmailVerification, sendPhoneOtp } = require("./delivery.service");
const { recordAudit } = require("./audit.service");

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_SEND_WINDOW_MS = 60 * 60 * 1000;
const OTP_MAX_SENDS_PER_WINDOW = 5;

const getVerificationStatus = async (user) => {
  const now = new Date();
  const expired = await Verification.updateMany(
    { user: user._id, type: "PHONE", status: "PENDING", expiresAt: { $lte: now } },
    { $set: { status: "EXPIRED", metadata: {} } },
  );
  if (expired.modifiedCount) {
    user.verification.phone.status = "NOT_VERIFIED";
    user.verification.phone.verifiedAt = null;
    await user.save();
  }
  return {
    email: {
      status: user.verification?.email?.status || "NOT_VERIFIED",
      verified: user.verification?.email?.status === "VERIFIED",
      verifiedAt: user.verification?.email?.verifiedAt || null,
    },
    phone: {
      status: user.verification?.phone?.status || "NOT_VERIFIED",
      verified: user.verification?.phone?.status === "VERIFIED",
      verifiedAt: user.verification?.phone?.verifiedAt || null,
    },
    identity: {
      status: user.verification?.identity?.status || "NOT_SUBMITTED",
      verified: user.verification?.identity?.status === "VERIFIED",
      verifiedAt: user.verification?.identity?.verifiedAt || null,
    },
  };
};

const sendEmailVerificationForUser = async (user) => {
  if (user.verification?.email?.status === "VERIFIED") {
    throw new HttpError(409, "Email is already verified", "ALREADY_VERIFIED");
  }
  const now = new Date();
  await EmailVerificationToken.updateMany(
    { user: user._id, consumedAt: null },
    { $set: { consumedAt: now } },
  );
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const tokenRecord = await EmailVerificationToken.create({
    user: user._id,
    tokenHash: hashValue(token),
    expiresAt,
  });
  try {
    const delivery = await sendEmailVerification({ to: user.email, token });
    user.verification.email.status = "PENDING";
    await user.save();
    return { expiresAt, ...delivery };
  } catch (error) {
    await EmailVerificationToken.deleteOne({ _id: tokenRecord._id });
    throw error;
  }
};

const verifyEmail = async ({ token }, req) => {
  const now = new Date();
  const candidate = await EmailVerificationToken.findOne({
    tokenHash: hashValue(token),
    consumedAt: null,
    expiresAt: { $gt: now },
  });
  if (!candidate) {
    throw new HttpError(400, "Verification token is invalid or expired", "INVALID_TOKEN");
  }
  const consumed = await EmailVerificationToken.findOneAndUpdate(
    { _id: candidate._id, consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { returnDocument: "after" },
  );
  if (!consumed) {
    throw new HttpError(400, "Verification token is invalid or expired", "INVALID_TOKEN");
  }
  const user = await User.findById(candidate.user);
  if (!user) throw new HttpError(404, "Account was not found", "USER_NOT_FOUND");
  user.verification.email.status = "VERIFIED";
  user.verification.email.verifiedAt = now;
  await user.save();
  await Verification.create({
    user: user._id,
    type: "EMAIL",
    status: "VERIFIED",
    provider: "email-token",
    submittedAt: candidate.createdAt || now,
    verifiedAt: now,
  });
  await recordAudit(req, {
    action: "EMAIL_VERIFIED",
    resourceType: "User",
    resourceId: user._id,
  });
  return getVerificationStatus(user);
};

const sendPhoneOTP = async (user, phoneInput) => {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new HttpError(400, "Enter a valid international phone number", "INVALID_PHONE");
  if (user.verification?.phone?.status === "VERIFIED" && user.phoneNumber === phone) {
    throw new HttpError(409, "Phone number is already verified", "ALREADY_VERIFIED");
  }

  const now = new Date();
  const phoneVerification = user.verification.phone;
  const windowStartedAt = phoneVerification.otpWindowStartedAt
    ? new Date(phoneVerification.otpWindowStartedAt)
    : null;
  const sendCount =
    windowStartedAt && now.getTime() - windowStartedAt.getTime() < OTP_SEND_WINDOW_MS
      ? phoneVerification.otpSendCount || 0
      : 0;
  if (sendCount >= OTP_MAX_SENDS_PER_WINDOW) {
    throw new HttpError(429, "Hourly phone verification limit reached", "OTP_SEND_LIMIT");
  }
  let verification = await Verification.findOne({
    user: user._id,
    type: "PHONE",
    status: "PENDING",
  }).select("+metadata");
  if (
    verification?.metadata?.lastSentAt &&
    now.getTime() - new Date(verification.metadata.lastSentAt).getTime() < OTP_COOLDOWN_MS
  ) {
    throw new HttpError(429, "Wait before requesting another code", "OTP_COOLDOWN");
  }
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  const salt = randomToken(16);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  if (!verification) {
    verification = new Verification({
      user: user._id,
      type: "PHONE",
      status: "PENDING",
    });
  }
  verification.provider = process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL ? "webhook" : "development";
  verification.expiresAt = expiresAt;
  verification.metadata = {
    salt,
    otpHash: hashOtp(otp, salt),
    attempts: 0,
    lastSentAt: now,
    phone,
  };
  try {
    await verification.save();
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(429, "A phone verification request is already active", "OTP_COOLDOWN");
    }
    throw error;
  }
  try {
    const delivery = await sendPhoneOtp({ to: phone, otp });
    user.phoneNumber = phone;
    user.verification.phone.status = "PENDING";
    user.verification.phone.otpWindowStartedAt =
      sendCount === 0 ? now : windowStartedAt;
    user.verification.phone.otpSendCount = sendCount + 1;
    await user.save();
    return { expiresAt, resendAfterSeconds: OTP_COOLDOWN_MS / 1000, ...delivery };
  } catch (error) {
    verification.status = "EXPIRED";
    verification.metadata = {};
    await verification.save();
    throw error;
  }
};

const verifyPhoneOTP = async (user, code, req) => {
  const now = new Date();
  const verification = await Verification.findOne({
    user: user._id,
    type: "PHONE",
    status: "PENDING",
  }).select("+metadata");
  if (!verification) {
    throw new HttpError(400, "No active phone verification was found", "OTP_NOT_FOUND");
  }
  if (verification.expiresAt <= now) {
    verification.status = "EXPIRED";
    verification.metadata = {};
    await verification.save();
    user.verification.phone.status = "NOT_VERIFIED";
    await user.save();
    throw new HttpError(400, "The code has expired", "OTP_EXPIRED");
  }
  if (verification.metadata.attempts >= OTP_MAX_ATTEMPTS) {
    verification.status = "EXPIRED";
    verification.metadata = {};
    await verification.save();
    throw new HttpError(429, "Maximum code attempts exceeded", "OTP_ATTEMPTS_EXCEEDED");
  }

  const salt = verification.metadata.salt;
  const expected = verification.metadata.otpHash;
  const received = hashOtp(code, salt);
  if (!safeCompare(expected, received)) {
    const updated = await Verification.findOneAndUpdate(
      {
        _id: verification._id,
        status: "PENDING",
        "metadata.attempts": { $lt: OTP_MAX_ATTEMPTS },
      },
      { $inc: { "metadata.attempts": 1 } },
      { returnDocument: "after" },
    ).select("+metadata");
    if (!updated) {
      throw new HttpError(429, "Maximum code attempts exceeded", "OTP_ATTEMPTS_EXCEEDED");
    }
    if (updated.metadata.attempts >= OTP_MAX_ATTEMPTS) {
      await Verification.updateOne(
        { _id: updated._id, status: "PENDING" },
        { $set: { status: "EXPIRED", metadata: {} } },
      );
      user.verification.phone.status = "NOT_VERIFIED";
      user.verification.phone.verifiedAt = null;
      await user.save();
    }
    throw new HttpError(
      updated.metadata.attempts >= OTP_MAX_ATTEMPTS ? 429 : 400,
      updated.metadata.attempts >= OTP_MAX_ATTEMPTS
        ? "Maximum code attempts exceeded"
        : "The code is invalid",
      updated.metadata.attempts >= OTP_MAX_ATTEMPTS ? "OTP_ATTEMPTS_EXCEEDED" : "INVALID_OTP",
    );
  }

  const consumed = await Verification.findOneAndUpdate(
    {
      _id: verification._id,
      status: "PENDING",
      "metadata.otpHash": expected,
      "metadata.attempts": { $lt: OTP_MAX_ATTEMPTS },
      expiresAt: { $gt: now },
    },
    {
      $set: { status: "VERIFIED", verifiedAt: now },
      $unset: { metadata: 1 },
    },
    { returnDocument: "after" },
  );
  if (!consumed) {
    throw new HttpError(400, "The code is invalid, expired, or already used", "INVALID_OTP");
  }
  user.verification.phone.status = "VERIFIED";
  user.verification.phone.verifiedAt = now;
  await user.save();
  await recordAudit(req, {
    action: "PHONE_VERIFIED",
    resourceType: "User",
    resourceId: user._id,
  });
  return getVerificationStatus(user);
};

const submitIdentityVerification = async (user, req) => {
  if (["PENDING", "VERIFIED"].includes(user.verification.identity.status)) {
    throw new HttpError(409, "An active identity verification already exists", "IDENTITY_ALREADY_SUBMITTED");
  }
  let verification;
  try {
    verification = await Verification.create({
      user: user._id,
      type: "IDENTITY",
      status: "PENDING",
      provider: "manual",
      submittedAt: new Date(),
      metadata: { documentAssetId: null },
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(409, "An active identity verification already exists", "IDENTITY_ALREADY_SUBMITTED");
    }
    throw error;
  }
  user.verification.identity.status = "PENDING";
  user.verification.identity.verifiedAt = null;
  await user.save();
  await recordAudit(req, {
    action: "IDENTITY_SUBMITTED",
    resourceType: "Verification",
    resourceId: verification._id,
  });
  return { status: "PENDING", submittedAt: verification.submittedAt };
};

const getIdentityStatus = async (user) => ({
  status: user.verification?.identity?.status || "NOT_SUBMITTED",
  verifiedAt: user.verification?.identity?.verifiedAt || null,
});

const getVerificationHistory = async (userId) => {
  const items = await Verification.find({ user: userId })
    .select("type status provider submittedAt verifiedAt rejectedAt expiresAt createdAt")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return items.map((item) => ({
    type: item.type,
    status: item.status,
    provider: item.provider,
    submittedAt: item.submittedAt,
    verifiedAt: item.verifiedAt,
    rejectedAt: item.rejectedAt,
    expiresAt: item.expiresAt,
    createdAt: item.createdAt,
  }));
};

const adminVerificationView = (item) => ({
  id: item._id.toString(),
  user: item.user
    ? { id: item.user._id.toString(), name: item.user.name, email: item.user.email }
    : null,
  type: item.type,
  status: item.status,
  provider: item.provider,
  submittedAt: item.submittedAt,
  verifiedAt: item.verifiedAt,
  rejectedAt: item.rejectedAt,
  reviewedAt: item.reviewedAt,
  reviewedBy: item.reviewedBy,
  reviewNotes: item.reviewNotes,
  documentAvailable: Boolean(item.metadata?.documentAssetId),
});

const listAdminVerifications = async ({ status, type, page, limit }) => {
  const query = {};
  if (status) query.status = status;
  if (type) query.type = type;
  const items = await Verification.find(query)
    .select("+metadata +reviewNotes")
    .populate("user", "name email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  return items.map(adminVerificationView);
};

const getAdminVerification = async (id) => {
  const item = await Verification.findById(id)
    .select("+metadata +reviewNotes")
    .populate("user", "name email");
  if (!item) throw new HttpError(404, "Verification was not found", "VERIFICATION_NOT_FOUND");
  return adminVerificationView(item);
};

const reviewIdentity = async ({ id, reviewer, decision, notes, req }) => {
  const item = await Verification.findOne({ _id: id, type: "IDENTITY" })
    .select("+metadata +reviewNotes")
    .populate("user");
  if (!item) throw new HttpError(404, "Identity verification was not found", "VERIFICATION_NOT_FOUND");
  if (!item.user) throw new HttpError(404, "Account was not found", "USER_NOT_FOUND");
  if (item.user._id.equals(reviewer._id)) {
    throw new HttpError(403, "You cannot review your own identity verification", "SELF_REVIEW_FORBIDDEN");
  }
  if (item.status !== "PENDING") {
    throw new HttpError(409, "Only pending verifications can be reviewed", "INVALID_VERIFICATION_STATE");
  }
  if (decision === "VERIFIED" && !item.metadata?.documentAssetId) {
    throw new HttpError(409, "A secure identity document is required before approval", "DOCUMENT_REQUIRED");
  }
  const now = new Date();
  const reviewed = await Verification.findOneAndUpdate(
    { _id: item._id, status: "PENDING" },
    {
      $set: {
        status: decision,
        reviewedBy: reviewer._id,
        reviewNotes: notes || "",
        reviewedAt: now,
        verifiedAt: decision === "VERIFIED" ? now : null,
        rejectedAt: decision === "REJECTED" ? now : null,
      },
    },
    { returnDocument: "after", runValidators: true },
  )
    .select("+metadata +reviewNotes")
    .populate("user");
  if (!reviewed) {
    throw new HttpError(409, "This verification was already reviewed", "INVALID_VERIFICATION_STATE");
  }
  reviewed.user.verification.identity.status = decision;
  reviewed.user.verification.identity.verifiedAt = reviewed.verifiedAt;
  await reviewed.user.save();
  const action =
    decision === "VERIFIED" ? "IDENTITY_APPROVED" : "IDENTITY_REJECTED";
  await recordAudit(req, {
    action,
    resourceType: "Verification",
    resourceId: reviewed._id,
    metadata: { targetUserId: reviewed.user._id.toString() },
  });
  return adminVerificationView(reviewed);
};

const revokeVerification = async ({ id, reviewer, notes, req }) => {
  const item = await Verification.findById(id).select("+metadata +reviewNotes").populate("user");
  if (!item) throw new HttpError(404, "Verification was not found", "VERIFICATION_NOT_FOUND");
  if (!item.user) throw new HttpError(404, "Account was not found", "USER_NOT_FOUND");
  if (item.status !== "VERIFIED") {
    throw new HttpError(409, "Only verified records can be revoked", "INVALID_VERIFICATION_STATE");
  }
  const revokedAt = new Date();
  const revoked = await Verification.findOneAndUpdate(
    { _id: item._id, status: "VERIFIED" },
    {
      $set: {
        status: "REVOKED",
        reviewedBy: reviewer._id,
        reviewedAt: revokedAt,
        reviewNotes: notes || "",
      },
    },
    { returnDocument: "after", runValidators: true },
  )
    .select("+metadata +reviewNotes")
    .populate("user");
  if (!revoked) {
    throw new HttpError(409, "This verification was already changed", "INVALID_VERIFICATION_STATE");
  }
  revoked.user.verification[revoked.type.toLowerCase()].status = "REVOKED";
  revoked.user.verification[revoked.type.toLowerCase()].verifiedAt = null;
  await revoked.user.save();
  await recordAudit(req, {
    action: revoked.type === "IDENTITY" ? "IDENTITY_REVOKED" : "ADMIN_ACTION",
    resourceType: "Verification",
    resourceId: revoked._id,
    metadata: { targetUserId: revoked.user._id.toString(), action: "VERIFICATION_REVOKED" },
  });
  return adminVerificationView(revoked);
};

const getDocumentAssetId = async (id) => {
  const item = await Verification.findOne({ _id: id, type: "IDENTITY" }).select("+metadata");
  if (!item) throw new HttpError(404, "Identity verification was not found", "VERIFICATION_NOT_FOUND");
  if (!item.metadata?.documentAssetId) {
    throw new HttpError(404, "No document is attached to this verification", "DOCUMENT_NOT_FOUND");
  }
  return item.metadata.documentAssetId;
};

module.exports = {
  getVerificationStatus,
  sendEmailVerificationForUser,
  verifyEmail,
  sendPhoneOTP,
  verifyPhoneOTP,
  submitIdentityVerification,
  getIdentityStatus,
  getVerificationHistory,
  listAdminVerifications,
  getAdminVerification,
  reviewIdentity,
  revokeVerification,
  getDocumentAssetId,
};
