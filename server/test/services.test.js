const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpError } = require("../src/utils/http");
const User = require("../src/models/User");
const Verification = require("../src/models/Verification");
const EmailVerificationToken = require("../src/models/EmailVerificationToken");
const Report = require("../src/models/Report");
const AuditLog = require("../src/models/AuditLog");
const authService = require("../src/services/auth.service");
const verificationService = require("../src/services/verification.service");
const safetyService = require("../src/services/safety.service");
const trustService = require("../src/services/trust.service");
const deliveryService = require("../src/services/delivery.service");
const identityStorage = require("../src/services/identity-storage.service");
const { requireModerator } = require("../src/middleware/auth");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-with-at-least-thirty-two-characters";

test("registration hashes the password and stores only the hash", async (context) => {
  let saved;
  context.mock.method(User, "exists", async () => false);
  context.mock.method(User, "create", async (values) => {
    saved = values;
    return { _id: "507f1f77bcf86cd799439011", ...values };
  });
  await authService.register({
    name: "Traveler",
    email: "Traveler@example.test",
    password: "correct-horse-battery-staple",
  });
  assert.equal(saved.email, "traveler@example.test");
  assert.notEqual(saved.passwordHash, "correct-horse-battery-staple");
  assert.match(saved.passwordHash, /^\$2[aby]\$/);
});

test("registration rejects existing email addresses", async (context) => {
  context.mock.method(User, "exists", async () => true);
  await assert.rejects(
    authService.register({ name: "Traveler", email: "taken@example.test", password: "correct-horse-battery-staple" }),
    (error) => error instanceof HttpError && error.statusCode === 409,
  );
});

test("login accepts a valid password and rejects an invalid password", async (context) => {
  const bcrypt = require("bcryptjs");
  const user = {
    _id: "507f1f77bcf86cd799439011",
    passwordHash: await bcrypt.hash("correct-horse-battery-staple", 4),
  };
  context.mock.method(User, "findOne", () => ({ select: async () => user }));
  assert.equal(await authService.login({ email: "user@example.test", password: "correct-horse-battery-staple" }), user);
  await assert.rejects(
    authService.login({ email: "user@example.test", password: "wrong-password" }),
    (error) => error instanceof HttpError && error.statusCode === 401,
  );
});

test("session tokens are audience-bound, issuer-bound, and short-lived", () => {
  const jwt = require("jsonwebtoken");
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-session-secret-with-at-least-thirty-two-characters";
  try {
    const token = authService.createSessionToken("507f1f77bcf86cd799439011", 3);
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "tripbuddy",
      audience: "tripbuddy-web",
      algorithms: ["HS256"],
    });
    assert.equal(payload.v, 3);
    assert.equal(payload.sub, "507f1f77bcf86cd799439011");
    assert.ok(payload.exp - payload.iat <= 7 * 24 * 60 * 60);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});

test("email verification rejects absent, expired, and consumed tokens", async (context) => {
  context.mock.method(EmailVerificationToken, "findOne", async () => null);
  await assert.rejects(
    verificationService.verifyEmail({ token: "a".repeat(64) }, {}),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("phone verification rejects invalid numbers before persistence", async () => {
  await assert.rejects(
    verificationService.sendPhoneOTP({ _id: "507f1f77bcf86cd799439011" }, "5551234"),
    (error) => error instanceof HttpError && error.code === "INVALID_PHONE",
  );
});

test("identity resubmission is rejected while an earlier review is pending", async () => {
  const user = {
    _id: "507f1f77bcf86cd799439011",
    verification: { identity: { status: "PENDING" } },
  };
  await assert.rejects(
    verificationService.submitIdentityVerification(user, {}),
    (error) => error instanceof HttpError && error.code === "IDENTITY_ALREADY_SUBMITTED",
  );
});

test("reviewer cannot approve their own identity request", async (context) => {
  const id = "507f1f77bcf86cd799439011";
  const item = {
    user: { _id: { equals: (value) => value === id } },
  };
  context.mock.method(Verification, "findOne", () => ({
    select() {
      return { populate: async () => item };
    },
  }));
  await assert.rejects(
    verificationService.reviewIdentity({
      id,
      reviewer: { _id: id },
      decision: "VERIFIED",
      notes: "",
      req: {},
    }),
    (error) => error instanceof HttpError && error.statusCode === 403,
  );
});

test("identity approval is rejected when there is no privately stored document", async (context) => {
  const item = {
    _id: { toString: () => "507f1f77bcf86cd799439012" },
    user: { _id: { equals: () => false } },
    status: "PENDING",
    metadata: {},
  };
  context.mock.method(Verification, "findOne", () => ({
    select() {
      return { populate: async () => item };
    },
  }));
  await assert.rejects(
    verificationService.reviewIdentity({
      id: "507f1f77bcf86cd799439012",
      reviewer: { _id: "507f1f77bcf86cd799439013" },
      decision: "VERIFIED",
      notes: "",
      req: {},
    }),
    (error) => error instanceof HttpError && error.code === "DOCUMENT_REQUIRED",
  );
});

test("users cannot block themselves", async () => {
  await assert.rejects(
    safetyService.blockUser(
      { _id: "507f1f77bcf86cd799439011" },
      "507f1f77bcf86cd799439011",
      {},
    ),
    (error) => error instanceof HttpError && error.code === "SELF_BLOCK_FORBIDDEN",
  );
});

test("users cannot report themselves", async () => {
  await assert.rejects(
    safetyService.createReport(
      { _id: "507f1f77bcf86cd799439011" },
      { reportedUserId: "507f1f77bcf86cd799439011", reason: "OTHER" },
      {},
    ),
    (error) => error instanceof HttpError && error.code === "SELF_REPORT_FORBIDDEN",
  );
});

test("a duplicate open report is rejected", async (context) => {
  context.mock.method(User, "findById", async () => ({ _id: "507f1f77bcf86cd799439012" }));
  context.mock.method(Report, "exists", async () => ({ _id: "existing-report" }));
  await assert.rejects(
    safetyService.createReport(
      { _id: "507f1f77bcf86cd799439011" },
      {
        reportedUserId: "507f1f77bcf86cd799439012",
        reason: "HARASSMENT",
        description: "Existing open report",
      },
      {},
    ),
    (error) => error instanceof HttpError && error.code === "DUPLICATE_REPORT",
  );
});

test("trust signals use factual verified fields and do not invent a score", async () => {
  const signals = await trustService.getTrustSignals({
    _id: "507f1f77bcf86cd799439011",
    verification: {
      email: { status: "VERIFIED" },
      phone: { status: "NOT_VERIFIED" },
      identity: { status: "PENDING" },
    },
  });
  assert.deepEqual(signals, {
    emailVerified: true,
    phoneVerified: false,
    identityVerified: false,
    tripsCompleted: 0,
    reviewsReceived: 0,
    averageRating: null,
  });
  assert.equal("trustScore" in signals, false);
});

test("verification history omits internal metadata, tokens, and reviewer notes", async (context) => {
  const query = {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => [{
      type: "IDENTITY",
      status: "PENDING",
      createdAt: new Date("2026-01-01"),
      metadata: { documentAssetId: "private-id" },
      reviewNotes: "internal",
      referenceId: "provider-secret",
    }],
  };
  context.mock.method(Verification, "find", () => query);
  const [item] = await verificationService.getVerificationHistory("507f1f77bcf86cd799439011");
  assert.equal(item.type, "IDENTITY");
  assert.equal("metadata" in item, false);
  assert.equal("reviewNotes" in item, false);
  assert.equal("referenceId" in item, false);
});

test("development delivery codes require explicit non-production opt-in", async () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalAllowed = process.env.ALLOW_DEV_VERIFICATION_CODES;
  const originalPhoneUrl = process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL;
  process.env.NODE_ENV = "development";
  delete process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL;
  delete process.env.ALLOW_DEV_VERIFICATION_CODES;
  try {
    await assert.rejects(
      deliveryService.sendPhoneOtp({ to: "+14155552671", otp: "123456" }),
      (error) => error instanceof HttpError && error.statusCode === 503,
    );
    process.env.ALLOW_DEV_VERIFICATION_CODES = "true";
    const result = await deliveryService.sendPhoneOtp({ to: "+14155552671", otp: "123456" });
    assert.equal(result.developmentCode, "123456");
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalAllowed === undefined) delete process.env.ALLOW_DEV_VERIFICATION_CODES;
    else process.env.ALLOW_DEV_VERIFICATION_CODES = originalAllowed;
    if (originalPhoneUrl === undefined) delete process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL;
    else process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL = originalPhoneUrl;
  }
});

test("production verification delivery refuses insecure HTTP provider endpoints", async () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalPhoneUrl = process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL;
  process.env.NODE_ENV = "production";
  process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL = "http://localhost:9000/send";
  try {
    await assert.rejects(
      deliveryService.sendPhoneOtp({ to: "+14155552671", otp: "123456" }),
      (error) => error instanceof HttpError && error.code === "DELIVERY_NOT_CONFIGURED",
    );
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalPhoneUrl === undefined) delete process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL;
    else process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL = originalPhoneUrl;
  }
});

test("production email delivery fails closed when no provider is configured", async () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalAllowed = process.env.ALLOW_DEV_VERIFICATION_CODES;
  const originalEmailUrl = process.env.EMAIL_PROVIDER_WEBHOOK_URL;
  process.env.NODE_ENV = "production";
  delete process.env.EMAIL_PROVIDER_WEBHOOK_URL;
  delete process.env.ALLOW_DEV_VERIFICATION_CODES;
  try {
    await assert.rejects(
      deliveryService.sendEmailVerification({ to: "person@example.test", token: "x".repeat(64) }),
      (error) => error instanceof HttpError && error.statusCode === 503,
    );
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalAllowed === undefined) delete process.env.ALLOW_DEV_VERIFICATION_CODES;
    else process.env.ALLOW_DEV_VERIFICATION_CODES = originalAllowed;
    if (originalEmailUrl === undefined) delete process.env.EMAIL_PROVIDER_WEBHOOK_URL;
    else process.env.EMAIL_PROVIDER_WEBHOOK_URL = originalEmailUrl;
  }
});

test("identity upload fails closed without a private storage provider", async () => {
  const originalCloudinaryUrl = process.env.CLOUDINARY_URL;
  delete process.env.CLOUDINARY_URL;
  try {
    await assert.rejects(
      identityStorage.uploadIdentityDocument({
        userId: "507f1f77bcf86cd799439011",
        file: { buffer: Buffer.from("document"), mimetype: "application/pdf" },
      }),
      (error) => error instanceof HttpError && error.code === "STORAGE_NOT_CONFIGURED",
    );
  } finally {
    if (originalCloudinaryUrl === undefined) delete process.env.CLOUDINARY_URL;
    else process.env.CLOUDINARY_URL = originalCloudinaryUrl;
  }
});

test("moderator middleware rejects standard users and permits authorized roles", () => {
  let error;
  let continued = false;
  requireModerator({ user: { role: "USER" } }, {}, (nextError) => { error = nextError; });
  assert.equal(error.statusCode, 403);
  requireModerator({ user: { role: "MODERATOR" } }, {}, () => { continued = true; });
  assert.equal(continued, true);
});

test("audit records include actor and request context without adding credential fields", async (context) => {
  let audit;
  context.mock.method(AuditLog, "create", async (record) => {
    audit = record;
    return record;
  });
  const { recordAudit } = require("../src/services/audit.service");
  await recordAudit(
    {
      user: { _id: "507f1f77bcf86cd799439011" },
      ip: "127.0.0.1",
      get: () => "test-agent",
    },
    {
      action: "USER_BLOCKED",
      resourceType: "User",
      resourceId: "507f1f77bcf86cd799439012",
      metadata: { reason: "user requested" },
    },
  );
  assert.equal(audit.actor, "507f1f77bcf86cd799439011");
  assert.equal(audit.ip, "127.0.0.1");
  assert.equal("token" in audit.metadata, false);
  assert.equal("otp" in audit.metadata, false);
});
