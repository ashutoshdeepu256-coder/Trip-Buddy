const test = require("node:test");
const assert = require("node:assert/strict");
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-with-at-least-thirty-two-characters";
const mongoose = require("mongoose");
const { randomToken, hashOtp, safeCompare, normalizePhone } = require("../src/utils/security");
const { registerSchema, loginSchema, profileSchema } = require("../src/validators/auth");
const { reportSchema, sendOtpSchema } = require("../src/validators/verification");
const User = require("../src/models/User");
const Verification = require("../src/models/Verification");
const Report = require("../src/models/Report");
const AuditLog = require("../src/models/AuditLog");
const authService = require("../src/services/auth.service");

test("secure token generation returns high-entropy hex and distinct values", () => {
  const first = randomToken(32);
  const second = randomToken(32);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("OTP hashes are salted and compared without accepting mismatches", () => {
  const firstHash = hashOtp("012345", "first-salt");
  assert.notEqual(firstHash, hashOtp("012345", "second-salt"));
  assert.equal(safeCompare(firstHash, hashOtp("012345", "first-salt")), true);
  assert.equal(safeCompare(firstHash, hashOtp("999999", "first-salt")), false);
  assert.equal(safeCompare("invalid", firstHash), false);
});

test("phone normalization requires a valid international-format number", () => {
  assert.equal(normalizePhone(" +1 (415) 555-2671 "), "+14155552671");
  assert.equal(normalizePhone("4155552671"), null);
  assert.equal(normalizePhone("+01234567"), null);
});

test("auth and profile schemas reject invalid input and unknown update fields", () => {
  assert.equal(registerSchema.safeParse({ name: "Traveler", email: "a@b.com", password: "long-enough-password" }).success, true);
  assert.equal(registerSchema.safeParse({ name: "T", email: "invalid", password: "x" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "a@b.com", password: "pw" }).success, true);
  assert.equal(profileSchema.safeParse({ role: "ADMIN" }).success, false);
});

test("verification and report validators constrain the accepted input", () => {
  assert.equal(sendOtpSchema.safeParse({ phone: "+14155552671" }).success, true);
  assert.equal(sendOtpSchema.safeParse({ phone: "123" }).success, false);
  assert.equal(reportSchema.safeParse({
    reportedUserId: new mongoose.Types.ObjectId().toString(),
    reason: "HARASSMENT",
    description: "Unsafe messages",
  }).success, true);
  assert.equal(reportSchema.safeParse({ reportedUserId: "not-an-id", reason: "FAKE", description: "" }).success, false);
});

test("sensitive model fields are excluded from normal selection and serialization", () => {
  assert.equal(User.schema.path("passwordHash").options.select, false);
  assert.equal(User.schema.path("phoneNumber").options.select, false);
  assert.equal(User.schema.path("role").options.select, false);
  assert.equal(Verification.schema.path("metadata").options.select, false);
  assert.equal(Verification.schema.path("reviewNotes").options.select, false);
  assert.equal(Report.schema.path("resolution").options.select, false);
  assert.equal(AuditLog.schema.path("action").options.required, true);
});

test("public trust serialization exposes factual verification only, never contact or secrets", () => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: "A Traveler",
    email: "private@example.test",
    phoneNumber: "+14155552671",
    passwordHash: "hashed",
    role: "ADMIN",
    profile: { bio: "Traveler" },
    verification: {
      email: { status: "VERIFIED", verifiedAt: new Date("2026-01-01") },
      phone: { status: "NOT_VERIFIED", verifiedAt: null },
      identity: { status: "PENDING", verifiedAt: null },
    },
    createdAt: new Date("2026-01-01"),
  };
  const result = authService.publicUser(user);
  assert.equal(result.verification.email.verified, true);
  assert.equal(result.verification.phone.verified, false);
  assert.equal("phoneNumber" in result, false);
  assert.equal("passwordHash" in result, false);
  assert.equal("role" in result, false);
});
