const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.MONGODB_TEST_URI) {
  test("MongoDB-backed workflows", { skip: "Set MONGODB_TEST_URI to an isolated disposable test database" }, () => {});
} else {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "integration-test-secret-with-more-than-thirty-two-characters";
  process.env.VERIFICATION_SECRET = "integration-verification-secret-with-more-than-32-characters";
  process.env.ALLOW_DEV_VERIFICATION_CODES = "true";
  delete process.env.EMAIL_PROVIDER_WEBHOOK_URL;
  delete process.env.PHONE_OTP_PROVIDER_WEBHOOK_URL;
  delete process.env.CLOUDINARY_URL;

  const mongoose = require("mongoose");
  const app = require("../app");
  const User = require("../src/models/User");
  const Verification = require("../src/models/Verification");
  const EmailVerificationToken = require("../src/models/EmailVerificationToken");
  const AuditLog = require("../src/models/AuditLog");
  const Block = require("../src/models/Block");
  const Report = require("../src/models/Report");
  const Destination = require("../src/models/Destination");

  test("MongoDB-backed Phase 4/5 and Phase 6 workflows", async (context) => {
    await mongoose.connect(process.env.MONGODB_TEST_URI, { serverSelectionTimeoutMS: 3000 });
    await Promise.all(
      [User, Verification, EmailVerificationToken, AuditLog, Block, Report, Destination].map((model) =>
        model.init(),
      ),
    );
    const server = app.listen(0, "127.0.0.1");
    context.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, { cookie, body, form } = {}) => {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers["content-type"] = "application/json";
      if (form) headers.origin = "http://localhost:5173";
      const response = await fetch(`${origin}${path}`, {
        method,
        headers,
        body: form || (body === undefined ? undefined : JSON.stringify(body)),
      });
      return {
        response,
        payload: response.status === 204 ? null : await response.json(),
      };
    };
    const register = async (email, name) => {
      const { response, payload } = await request("POST", "/api/v1/auth/register", {
        body: { email, name, password: "integration-test-password-123" },
      });
      assert.equal(response.status, 201);
      return {
        cookie: response.headers.get("set-cookie").split(";")[0],
        user: payload.data.user,
      };
    };

    const owner = await register("owner@tripbuddy.test", "Owner Traveler");
    const other = await register("other@tripbuddy.test", "Other Traveler");

    await context.test("register/login, cookie session, and current user persist safely", async () => {
      assert.equal(owner.user.email, "owner@tripbuddy.test");
      assert.equal("passwordHash" in owner.user, false);
      const { response, payload } = await request("GET", "/api/v1/auth/me", { cookie: owner.cookie });
      assert.equal(response.status, 200);
      assert.equal(payload.data.user.id, owner.user.id);
      const login = await request("POST", "/api/v1/auth/login", {
        body: { email: "OWNER@tripbuddy.test", password: "integration-test-password-123" },
      });
      assert.equal(login.response.status, 200);
      assert.ok(login.response.headers.get("set-cookie"));
    });

    await context.test("profile update and public profile privacy are database-backed", async () => {
      const update = await request("PATCH", "/api/v1/users/me", {
        cookie: owner.cookie,
        body: {
          bio: "Enjoys slow travel",
          city: "Pune",
          country: "India",
          travelPreferences: {
            destinations: ["Kyoto"],
            interests: ["food"],
            activities: ["walking"],
            travelStyle: "slow",
            budget: "mid-range",
            groupPreference: "small group",
          },
        },
      });
      assert.equal(update.response.status, 200);
      assert.deepEqual(update.payload.data.user.profile.travelPreferences.destinations, ["Kyoto"]);
      const publicResponse = await request("GET", `/api/v1/users/${owner.user.id}`);
      assert.equal(publicResponse.response.status, 200);
      assert.equal("email" in publicResponse.payload.data, false);
      assert.equal("phoneNumber" in publicResponse.payload.data, false);
      assert.equal("passwordHash" in publicResponse.payload.data, false);
      const persisted = await User.findById(owner.user.id);
      assert.equal(persisted.profile.bio, "Enjoys slow travel");
    });

    let emailToken;
    await context.test("email verification is hashed, one-time, and audited", async () => {
      const resend = await request("POST", "/api/v1/auth/resend-verification-email", {
        cookie: owner.cookie,
      });
      assert.equal(resend.response.status, 202);
      emailToken = resend.payload.data.developmentToken;
      assert.match(emailToken, /^[a-f0-9]{64}$/);
      const resendAgain = await request("POST", "/api/v1/auth/resend-verification-email", {
        cookie: owner.cookie,
      });
      assert.equal(resendAgain.response.status, 202);
      const firstToken = await request("POST", "/api/v1/auth/verify-email", {
        body: { token: emailToken },
      });
      assert.equal(firstToken.response.status, 400);
      emailToken = resendAgain.payload.data.developmentToken;
      assert.equal(
        await EmailVerificationToken.countDocuments({ user: owner.user.id, consumedAt: null }),
        1,
      );
      const savedToken = await EmailVerificationToken.findOne({ user: owner.user.id }).select("+tokenHash");
      assert.notEqual(savedToken.tokenHash, emailToken);
      const verified = await request("POST", "/api/v1/auth/verify-email", {
        body: { token: emailToken },
      });
      assert.equal(verified.response.status, 200);
      assert.equal(verified.payload.data.email.verified, true);
      const replay = await request("POST", "/api/v1/auth/verify-email", {
        body: { token: emailToken },
      });
      assert.equal(replay.response.status, 400);
      assert.equal(await AuditLog.countDocuments({ action: "EMAIL_VERIFIED" }), 1);
    });

    let phoneCode;
    await context.test("phone OTP is HMACed, cooldown-limited, and verified", async () => {
      const sent = await request("POST", "/api/v1/verifications/phone/send-otp", {
        cookie: owner.cookie,
        body: { phone: "+1 (415) 555-2671" },
      });
      assert.equal(sent.response.status, 202);
      phoneCode = sent.payload.data.developmentCode;
      assert.match(phoneCode, /^\d{6}$/);
      const saved = await Verification.findOne({ user: owner.user.id, type: "PHONE" }).select("+metadata");
      assert.notEqual(saved.metadata.otpHash, phoneCode);
      assert.equal("otp" in saved.metadata, false);
      const throttled = await request("POST", "/api/v1/verifications/phone/send-otp", {
        cookie: owner.cookie,
        body: { phone: "+14155552671" },
      });
      assert.equal(throttled.response.status, 429);
      const verified = await request("POST", "/api/v1/verifications/phone/verify-otp", {
        cookie: owner.cookie,
        body: { code: phoneCode },
      });
      assert.equal(verified.response.status, 200);
      assert.equal(verified.payload.data.phone.verified, true);
      assert.equal(await AuditLog.countDocuments({ action: "PHONE_VERIFIED" }), 1);
      const status = await request("GET", "/api/v1/verifications/me", { cookie: owner.cookie });
      assert.equal(status.payload.data.phone.verified, true);
    });

    await context.test("expired OTPs cannot verify and clear their pending state", async () => {
      const sent = await request("POST", "/api/v1/verifications/phone/send-otp", {
        cookie: other.cookie,
        body: { phone: "+14155552672" },
      });
      assert.equal(sent.response.status, 202);
      await Verification.updateOne(
        { user: other.user.id, type: "PHONE", status: "PENDING" },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      const expired = await request("POST", "/api/v1/verifications/phone/verify-otp", {
        cookie: other.cookie,
        body: { code: sent.payload.data.developmentCode },
      });
      assert.equal(expired.response.status, 400);
      assert.equal(expired.payload.error.code, "OTP_EXPIRED");
      assert.equal(
        (await Verification.findOne({ user: other.user.id, type: "PHONE" })).status,
        "EXPIRED",
      );
    });

    await context.test("invalid OTP reaches the attempt limit and expires the code", async () => {
      const sent = await request("POST", "/api/v1/verifications/phone/send-otp", {
        cookie: other.cookie,
        body: { phone: "+14155552672" },
      });
      assert.equal(sent.response.status, 202);
      const incorrectCode = String((Number(sent.payload.data.developmentCode) + 1) % 1000000).padStart(6, "0");
      const results = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await request("POST", "/api/v1/verifications/phone/verify-otp", {
          cookie: other.cookie,
          body: { code: incorrectCode },
        });
        results.push(result.response.status);
      }
      assert.deepEqual(results, [400, 400, 400, 400, 429]);
      const expired = await Verification.findOne({ user: other.user.id, type: "PHONE" }).select("+metadata");
      assert.equal(expired.status, "EXPIRED");
      assert.deepEqual(expired.metadata, {});
    });

    await context.test("phone sends are rate limited per account", async () => {
      await User.updateOne(
        { _id: other.user.id },
        {
          $set: {
            "verification.phone.otpWindowStartedAt": new Date(),
            "verification.phone.otpSendCount": 5,
          },
        },
      );
      const limited = await request("POST", "/api/v1/verifications/phone/send-otp", {
        cookie: other.cookie,
        body: { phone: "+14155552672" },
      });
      assert.equal(limited.response.status, 429);
      assert.equal(limited.payload.error.code, "OTP_SEND_LIMIT");
    });

    await context.test("identity submissions persist, reject duplicates, and require secure storage", async () => {
      const submitted = await request("POST", "/api/v1/verifications/identity", {
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(submitted.response.status, 201);
      assert.equal(submitted.payload.data.status, "PENDING");
      const duplicate = await request("POST", "/api/v1/verifications/identity", {
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(duplicate.response.status, 409);
      const form = new FormData();
      form.append("document", new Blob(["%PDF-1.7 test"], { type: "application/pdf" }), "id.pdf");
      const noStorage = await request("POST", "/api/v1/verifications/identity/document", {
        cookie: owner.cookie,
        form,
      });
      assert.equal(noStorage.response.status, 503);
      assert.equal((await Verification.findOne({ user: owner.user.id, type: "IDENTITY" })).status, "PENDING");
    });

    await context.test("identity status, history, and own-review prohibition work", async () => {
      const status = await request("GET", "/api/v1/verifications/identity/status", {
        cookie: owner.cookie,
      });
      assert.equal(status.payload.data.status, "PENDING");
      const history = await request("GET", "/api/v1/verifications/history", { cookie: owner.cookie });
      assert.equal(history.response.status, 200);
      assert.equal(history.payload.data.some((item) => "metadata" in item), false);
      const ownerRecord = await Verification.findOne({ user: owner.user.id, type: "IDENTITY" });
      await User.updateOne({ _id: owner.user.id }, { $set: { role: "ADMIN" } });
      const selfApprove = await request(
        "POST",
        `/api/v1/admin/verifications/${ownerRecord._id}/approve`,
        { cookie: owner.cookie, body: { notes: "self" } },
      );
      assert.equal(selfApprove.response.status, 403);
    });

    await context.test("admin review requires a reviewer role and logs approve/revoke decisions", async () => {
      const denied = await request("GET", "/api/v1/admin/verifications", { cookie: other.cookie });
      assert.equal(denied.response.status, 403);
      const targetRecord = await Verification.create({
        user: other.user.id,
        type: "IDENTITY",
        status: "PENDING",
        provider: "manual",
        metadata: { documentAssetId: "private/test-asset" },
      });
      const list = await request("GET", "/api/v1/admin/verifications?type=IDENTITY", {
        cookie: owner.cookie,
      });
      assert.equal(list.response.status, 200);
      assert.equal(list.payload.data.some((item) => "metadata" in item), false);
      const approve = await request(
        "POST",
        `/api/v1/admin/verifications/${targetRecord._id}/approve`,
        { cookie: owner.cookie, body: { notes: "Test approval" } },
      );
      assert.equal(approve.response.status, 200);
      assert.equal(approve.payload.data.status, "VERIFIED");
      assert.ok(approve.payload.data.reviewedAt);
      const revoke = await request(
        "POST",
        `/api/v1/admin/verifications/${targetRecord._id}/revoke`,
        { cookie: owner.cookie, body: { notes: "Test revocation" } },
      );
      assert.equal(revoke.response.status, 200);
      assert.equal(revoke.payload.data.status, "REVOKED");
      assert.equal(await AuditLog.countDocuments({ action: "IDENTITY_APPROVED" }), 1);
      assert.equal(await AuditLog.countDocuments({ action: "IDENTITY_REVOKED" }), 1);
    });

    await context.test("identity rejection records reviewer and review time", async () => {
      const target = await register("third@tripbuddy.test", "Third Traveler");
      const record = await Verification.create({
        user: target.user.id,
        type: "IDENTITY",
        status: "PENDING",
        provider: "manual",
      });
      const rejected = await request(
        "POST",
        `/api/v1/admin/verifications/${record._id}/reject`,
        { cookie: owner.cookie, body: { notes: "Document could not be matched" } },
      );
      assert.equal(rejected.response.status, 200);
      assert.equal(rejected.payload.data.status, "REJECTED");
      assert.ok(rejected.payload.data.reviewedAt);
      assert.equal(await AuditLog.countDocuments({ action: "IDENTITY_REJECTED" }), 1);
    });

    await context.test("block/unblock is idempotent and persisted", async () => {
      const path = `/api/v1/safety/block/${other.user.id}`;
      assert.equal((await request("POST", path, { cookie: owner.cookie, body: {} })).response.status, 200);
      assert.equal((await request("POST", path, { cookie: owner.cookie, body: {} })).response.status, 200);
      assert.equal(await Block.countDocuments({ blocker: owner.user.id, blocked: other.user.id }), 1);
      assert.equal((await request("POST", `/api/v1/safety/block/${owner.user.id}`, { cookie: owner.cookie, body: {} })).response.status, 400);
      const list = await request("GET", "/api/v1/safety/blocked-users", { cookie: owner.cookie });
      assert.equal(list.payload.data.length, 1);
      assert.equal((await request("DELETE", path, { cookie: owner.cookie })).response.status, 200);
      assert.equal((await request("DELETE", path, { cookie: owner.cookie })).response.status, 200);
      assert.equal(await Block.countDocuments({ blocker: owner.user.id, blocked: other.user.id }), 0);
      assert.equal(await AuditLog.countDocuments({ action: "USER_BLOCKED" }), 1);
      assert.equal(await AuditLog.countDocuments({ action: "USER_UNBLOCKED" }), 1);
    });

    await context.test("report self-protection, dedupe, moderator review, and audit work", async () => {
      const reportBody = {
        reportedUserId: other.user.id,
        reason: "SAFETY_CONCERN",
        description: "Integration test report",
      };
      const selfReport = await request("POST", "/api/v1/safety/reports", {
        cookie: owner.cookie,
        body: { ...reportBody, reportedUserId: owner.user.id },
      });
      assert.equal(selfReport.response.status, 400);
      const created = await request("POST", "/api/v1/safety/reports", {
        cookie: owner.cookie,
        body: reportBody,
      });
      assert.equal(created.response.status, 201);
      const duplicate = await request("POST", "/api/v1/safety/reports", {
        cookie: owner.cookie,
        body: reportBody,
      });
      assert.equal(duplicate.response.status, 409);
      const list = await request("GET", "/api/v1/safety/admin/reports?status=OPEN", {
        cookie: owner.cookie,
      });
      assert.equal(list.response.status, 200);
      assert.equal(list.payload.data.length, 1);
      const review = await request(
        "PATCH",
        `/api/v1/safety/admin/reports/${created.payload.data.id}`,
        { cookie: owner.cookie, body: { status: "RESOLVED", resolution: "Reviewed" } },
      );
      assert.equal(review.response.status, 200);
      assert.equal(review.payload.data.status, "RESOLVED");
      assert.equal(await AuditLog.countDocuments({ action: "USER_REPORTED" }), 1);
      assert.equal(await AuditLog.countDocuments({ action: "ADMIN_ACTION" }), 1);
    });

    await context.test("destination search, ranked feeds, geo search, pagination, and detail are data-backed", async () => {
      const destinations = await Destination.create([
        {
          name: "Coastal Example",
          slug: "coastal-example",
          country: "Exampleland",
          city: "Harbor",
          description: "Coastal walks and locally curated food.",
          coordinates: { type: "Point", coordinates: [-122.4, 37.8] },
          images: [{ url: "https://images.example.test/coast.jpg", alt: "Coastline" }],
          activities: ["walking", "food"],
          categories: ["BEACH"],
          bestMonths: [5, 6, 7],
          estimatedBudget: { min: 100, max: 200, currency: "USD", period: "DAY" },
          popularity: { score: 80, trendScore: 30 },
          communityStatistics: { tripsCount: 4, travelersCount: 10, buddiesCount: 2 },
        },
        {
          name: "Mountain Example",
          slug: "mountain-example",
          country: "Exampleland",
          description: "A place for climbing and hiking.",
          coordinates: { type: "Point", coordinates: [-122.3, 37.7] },
          activities: ["hiking", "climbing"],
          categories: ["ADVENTURE", "NATURE"],
          adventure: true,
          bestMonths: [6, 7, 8],
          estimatedBudget: { min: 70, max: 150, currency: "USD", period: "DAY" },
          popularity: { score: 40, trendScore: 90 },
        },
      ]);

      const search = await request("GET", "/api/v1/destinations?search=coastal&page=1&limit=1");
      assert.equal(search.response.status, 200);
      assert.equal(search.payload.data.items.length, 1);
      assert.equal(search.payload.data.items[0].slug, "coastal-example");
      assert.equal(search.payload.data.pagination.total, 1);
      assert.equal(search.payload.data.items[0].heroImage.alt, "Coastline");

      const popular = await request("GET", "/api/v1/destinations/popular");
      assert.equal(popular.payload.data.items[0].slug, "coastal-example");
      const trending = await request("GET", "/api/v1/destinations/trending");
      assert.equal(trending.payload.data.items[0].slug, "mountain-example");
      const seasonal = await request("GET", "/api/v1/destinations/seasonal?month=5");
      assert.deepEqual(seasonal.payload.data.items.map((item) => item.slug), ["coastal-example"]);
      const adventure = await request("GET", "/api/v1/destinations/adventure");
      assert.deepEqual(adventure.payload.data.items.map((item) => item.slug), ["mountain-example"]);
      const budget = await request("GET", "/api/v1/destinations/budget");
      assert.equal(budget.payload.data.items[0].slug, "mountain-example");
      const nearby = await request("GET", "/api/v1/destinations/nearby?lat=37.8&lng=-122.4&radiusKm=30");
      assert.equal(nearby.response.status, 200);
      assert.equal(nearby.payload.data.items.length, 2);
      const detail = await request("GET", `/api/v1/destinations/${destinations[0].slug}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.payload.data.communityStatistics.tripsCount, 4);
      assert.deepEqual(detail.payload.data.communityTrips, []);
    });

    await context.test("logout invalidates the persisted session version", async () => {
      const logout = await request("POST", "/api/v1/auth/logout", { cookie: owner.cookie });
      assert.equal(logout.response.status, 200);
      const staleSession = await request("GET", "/api/v1/auth/me", { cookie: owner.cookie });
      assert.equal(staleSession.response.status, 401);
      const user = await User.findById(owner.user.id).select("+tokenVersion");
      assert.equal(user.tokenVersion, 1);
    });
  });
}
