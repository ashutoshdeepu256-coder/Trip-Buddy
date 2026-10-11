const test = require("node:test");
const assert = require("node:assert/strict");
const { URLSearchParams } = require("node:url");

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
  const Trip = require("../src/models/Trip");
  const TripMember = require("../src/models/TripMember");
  const Connection = require("../src/models/Connection");
  const Itinerary = require("../src/models/Itinerary");

  test("MongoDB-backed Phase 4/5 and Phase 6 workflows", async (context) => {
    let databaseName = "";
    try { databaseName = new URL(process.env.MONGODB_TEST_URI).pathname.replace(/^\//, "").split("/")[0]; } catch { /* Mongoose reports malformed URIs. */ }
    assert.match(databaseName, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
    await mongoose.connect(process.env.MONGODB_TEST_URI, { serverSelectionTimeoutMS: 3000 });
    await Promise.all(
      [User, Verification, EmailVerificationToken, AuditLog, Block, Report, Destination, Trip, TripMember, Connection, Itinerary].map((model) =>
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

    await context.test("connection lifecycle enforces authorization, privacy, idempotency and reconnection policy", async () => {
      const unauthenticated = await request("POST", "/api/v1/connections", { body: { recipientId: other.user.id } });
      assert.equal(unauthenticated.response.status, 401);
      const self = await request("POST", "/api/v1/connections", { cookie: owner.cookie, body: { recipientId: owner.user.id } });
      assert.equal(self.response.status, 400);

      const created = await request("POST", "/api/v1/connections", {
        cookie: owner.cookie,
        body: { recipientId: other.user.id, score: 100 },
      });
      assert.equal(created.response.status, 400, "client-supplied scores are rejected by strict validation");
      const sent = await request("POST", "/api/v1/connections", { cookie: owner.cookie, body: { recipientId: other.user.id } });
      assert.equal(sent.response.status, 201);
      const connectionId = sent.payload.data.connection.id;
      const reverseDuplicate = await request("POST", "/api/v1/connections", { cookie: other.cookie, body: { recipientId: owner.user.id } });
      assert.equal(reverseDuplicate.response.status, 409);

      const incoming = await request("GET", "/api/v1/connections/requests/received", { cookie: other.cookie });
      const outgoing = await request("GET", "/api/v1/connections/requests/sent", { cookie: owner.cookie });
      assert.equal(incoming.payload.data.items[0].id, connectionId);
      assert.equal(outgoing.payload.data.items[0].id, connectionId);
      assert.equal("email" in incoming.payload.data.items[0].otherUser, false);

      const wrongAccept = await request("POST", `/api/v1/connections/${connectionId}/accept`, { cookie: owner.cookie });
      assert.equal(wrongAccept.response.status, 404);
      const wrongReject = await request("POST", `/api/v1/connections/${connectionId}/reject`, { cookie: owner.cookie });
      assert.equal(wrongReject.response.status, 404);
      const concurrentAccepts = await Promise.all([
        request("POST", `/api/v1/connections/${connectionId}/accept`, { cookie: other.cookie }),
        request("POST", `/api/v1/connections/${connectionId}/accept`, { cookie: other.cookie }),
      ]);
      assert.deepEqual(concurrentAccepts.map(({ response }) => response.status).sort(), [200, 409]);
      const bothLists = await Promise.all([
        request("GET", "/api/v1/connections", { cookie: owner.cookie }),
        request("GET", "/api/v1/connections", { cookie: other.cookie }),
      ]);
      assert.equal(bothLists[0].payload.data.items.length, 1);
      assert.equal(bothLists[1].payload.data.items.length, 1);
      const third = await register("third@tripbuddy.test", "Third Traveler");
      const hidden = await request("GET", `/api/v1/connections/${connectionId}`, { cookie: third.cookie });
      assert.equal(hidden.response.status, 404);
      const details = await request("GET", `/api/v1/connections/${connectionId}`, { cookie: owner.cookie });
      assert.equal(details.response.status, 200);
      assert.equal("email" in details.payload.data.connection.otherUser, false);
      const unmatched = await request("POST", `/api/v1/connections/${connectionId}/unmatch`, { cookie: owner.cookie });
      assert.equal(unmatched.response.status, 200);
      const invalidReaccept = await request("POST", `/api/v1/connections/${connectionId}/accept`, { cookie: other.cookie });
      assert.equal(invalidReaccept.response.status, 409);
      const reconnect = await request("POST", "/api/v1/connections", { cookie: owner.cookie, body: { recipientId: other.user.id } });
      assert.equal(reconnect.response.status, 201, "unmatched users can initiate a new request");
      const cancelledByRecipient = await request("POST", `/api/v1/connections/${reconnect.payload.data.connection.id}/cancel`, { cookie: other.cookie });
      assert.equal(cancelledByRecipient.response.status, 404);
      const cancelled = await request("POST", `/api/v1/connections/${reconnect.payload.data.connection.id}/cancel`, { cookie: owner.cookie });
      assert.equal(cancelled.response.status, 200);

      await User.updateOne({ _id: other.user.id }, { $set: { accountStatus: "SUSPENDED" } });
      const restricted = await request("POST", "/api/v1/connections", { cookie: owner.cookie, body: { recipientId: other.user.id } });
      assert.equal(restricted.response.status, 404);
      await User.updateOne({ _id: other.user.id }, { $set: { accountStatus: "ACTIVE" } });

      const blocked = await request("POST", `/api/v1/safety/block/${other.user.id}`, { cookie: owner.cookie, body: {} });
      assert.equal(blocked.response.status, 200);
      const blockedRequest = await request("POST", "/api/v1/connections", { cookie: other.cookie, body: { recipientId: owner.user.id } });
      assert.equal(blockedRequest.response.status, 404);
      await request("DELETE", `/api/v1/safety/block/${other.user.id}`, { cookie: owner.cookie });

      const rejectedRequest = await request("POST", "/api/v1/connections", { cookie: owner.cookie, body: { recipientId: third.user.id } });
      assert.equal(rejectedRequest.response.status, 201);
      const rejected = await request("POST", `/api/v1/connections/${rejectedRequest.payload.data.connection.id}/reject`, { cookie: third.cookie });
      assert.equal(rejected.response.status, 200);
      const freshAfterRejection = await request("POST", "/api/v1/connections", { cookie: owner.cookie, body: { recipientId: third.user.id } });
      assert.equal(freshAfterRejection.response.status, 201);
    });

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
            budgetRange: { min: 1000, max: 2500, currency: "INR" },
            groupPreference: "small group",
            groupSizeRange: { min: 2, max: 5 },
            availability: { startDate: "2027-04-01", endDate: "2027-04-15" },
            dateFlexibilityDays: 2,
            accommodationPreference: ["homestay"],
            transportPreference: ["train"],
            foodPreference: ["vegetarian"],
            languages: ["English", "Hindi"],
            travelPace: "MODERATE",
          },
        },
      });
      assert.equal(update.response.status, 200);
      assert.deepEqual(update.payload.data.user.profile.travelPreferences.destinations, ["Kyoto"]);
      assert.equal(update.payload.data.user.profile.travelPreferences.budgetRange.currency, "INR");
      assert.equal(update.payload.data.user.profile.travelPreferences.travelPace, "MODERATE");
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

    await context.test("trip drafts persist, enforce privacy and ownership, publish, cancel, and paginate", async () => {
      const tripBody = {
        destination: (await mongoose.model("Destination").findOne({ slug: "coastal-example" }))._id.toString(),
        title: "Coastal weekend plan",
        description: "A group journey with time for exploring and shared meals.",
        startDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString(),
        budget: { min: 200, max: 500, currency: "USD" },
        groupSize: { min: 1, max: 4 },
        travelStyle: ["slow travel"],
        interests: ["food", "walking"],
        activities: ["walking"],
        accommodationPreference: ["hotel"],
        transportPreference: ["train"],
        foodPreference: ["vegetarian"],
        privacy: "PRIVATE",
      };
      const created = await request("POST", "/api/v1/trips", { cookie: owner.cookie, body: tripBody });
      assert.equal(created.response.status, 201);
      assert.equal(created.payload.data.status, "DRAFT");
      assert.equal(await TripMember.countDocuments({ trip: created.payload.data.id, role: "OWNER", status: "ACTIVE" }), 1);
      assert.ok(await Trip.findById(created.payload.data.id));

      const updated = await request("PATCH", `/api/v1/trips/${created.payload.data.id}`, {
        cookie: owner.cookie,
        body: { title: "Updated coastal weekend" },
      });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.payload.data.title, "Updated coastal weekend");

      const hidden = await request("GET", `/api/v1/trips/${created.payload.data.id}`);
      assert.equal(hidden.response.status, 404);
      const otherUpdate = await request("PATCH", `/api/v1/trips/${created.payload.data.id}`, {
        cookie: other.cookie,
        body: { title: "Unauthorized edit" },
      });
      assert.equal(otherUpdate.response.status, 403);
      const otherDelete = await request("DELETE", `/api/v1/trips/${created.payload.data.id}`, { cookie: other.cookie });
      assert.equal(otherDelete.response.status, 403);

      const published = await request("POST", `/api/v1/trips/${created.payload.data.id}/publish`, {
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(published.response.status, 200);
      assert.equal(published.payload.data.status, "PUBLISHED");
      assert.ok(published.payload.data.publishedAt);
      const stillHidden = await request("GET", `/api/v1/trips/${created.payload.data.id}`, { cookie: other.cookie });
      assert.equal(stillHidden.response.status, 404);

      const cancelled = await request("POST", `/api/v1/trips/${created.payload.data.id}/cancel`, {
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.payload.data.status, "CANCELLED");
      const cancelAgain = await request("POST", `/api/v1/trips/${created.payload.data.id}/cancel`, {
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(cancelAgain.response.status, 409);

      const anotherDraft = await request("POST", "/api/v1/trips", {
        cookie: owner.cookie,
        body: { title: "Incomplete draft" },
      });
      assert.equal(anotherDraft.response.status, 201);
      const incompletePublish = await request("POST", `/api/v1/trips/${anotherDraft.payload.data.id}/publish`, {
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(incompletePublish.response.status, 400);
      assert.equal(incompletePublish.payload.error.code, "TRIP_VALIDATION_ERROR");
      const invalidImageForm = new FormData();
      invalidImageForm.append("images", new Blob(["not a PNG"], { type: "image/png" }), "client-name.png");
      const invalidImage = await request("POST", `/api/v1/trips/${anotherDraft.payload.data.id}/images`, {
        cookie: owner.cookie,
        form: invalidImageForm,
      });
      assert.equal(invalidImage.response.status, 400);
      assert.equal(invalidImage.payload.error.code, "INVALID_TRIP_IMAGE");
      const page = await request("GET", "/api/v1/users/me/trips?page=1&limit=1", { cookie: owner.cookie });
      assert.equal(page.response.status, 200);
      assert.equal(page.payload.data.items.length, 1);
      assert.equal(page.payload.data.limit, 1);
      assert.ok(page.payload.data.total >= 2);
      assert.equal(typeof page.payload.data.hasNextPage, "boolean");
      const deleted = await request("DELETE", `/api/v1/trips/${anotherDraft.payload.data.id}`, { cookie: owner.cookie });
      assert.equal(deleted.response.status, 200);
    });

    await context.test("published PUBLIC trips are visible while COMMUNITY trips require a session", async () => {
      const destination = await mongoose.model("Destination").findOne({ slug: "coastal-example" });
      const createAndPublish = async (privacy, title) => {
        const startDate = new Date(Date.now() + 55 * 24 * 60 * 60 * 1000);
        const endDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
        const created = await request("POST", "/api/v1/trips", {
          cookie: owner.cookie,
          body: {
            destination: destination._id.toString(),
            title,
            description: "A community trip listing with enough details to publish.",
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            budget: { min: 50, max: 100, currency: "USD" },
            groupSize: { min: 1, max: 3 },
            privacy,
          },
        });
        assert.equal(created.response.status, 201);
        const published = await request("POST", `/api/v1/trips/${created.payload.data.id}/publish`, {
          cookie: owner.cookie,
          body: {},
        });
        assert.equal(published.response.status, 200);
        return created.payload.data.id;
      };

      const publicTripId = await createAndPublish("PUBLIC", "Open coastal trip");
      const publicRead = await request("GET", `/api/v1/trips/${publicTripId}`);
      assert.equal(publicRead.response.status, 200);
      assert.equal(publicRead.payload.data.creator.email, undefined);
      assert.equal(publicRead.payload.data.images.length, 0);

      const communityTripId = await createAndPublish("COMMUNITY", "Community coastal trip");
      assert.equal((await request("GET", `/api/v1/trips/${communityTripId}`)).response.status, 404);
      assert.equal((await request("GET", `/api/v1/trips/${communityTripId}`, { cookie: other.cookie })).response.status, 200);

      const inviteOnlyTripId = await createAndPublish("INVITE_ONLY", "Invite-only coastal trip");
      assert.equal((await request("GET", `/api/v1/trips/${inviteOnlyTripId}`, { cookie: other.cookie })).response.status, 404);
    });

    await context.test("trip discovery uses published MongoDB records, filters overlap, and excludes private or full trips", async () => {
      const destination = await Destination.findOne({ slug: "coastal-example" });
      const startDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      startDate.setUTCHours(0, 0, 0, 0);
      const endDate = new Date(startDate.getTime() + 5 * 24 * 60 * 60 * 1000);
      const createTrip = async (privacy, title, shouldPublish = true) => {
        const created = await request("POST", "/api/v1/trips", {
          cookie: owner.cookie,
          body: {
            destination: destination._id.toString(),
            title,
            description: "An upcoming coastal trip with walks, local food, and enough details.",
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            budget: { min: 10000, max: 18000, currency: "INR" },
            groupSize: { min: 1, max: 4 },
            travelStyle: ["Adventure"],
            interests: ["Trekking", "Food"],
            activities: ["Hiking"],
            accommodationPreference: ["Hostel"],
            transportPreference: ["Train"],
            foodPreference: ["Vegan"],
            languages: ["Hindi"],
            privacy,
          },
        });
        assert.equal(created.response.status, 201);
        if (shouldPublish) {
          const published = await request("POST", `/api/v1/trips/${created.payload.data.id}/publish`, {
            cookie: owner.cookie,
            body: {},
          });
          assert.equal(published.response.status, 200);
        }
        return created.payload.data.id;
      };

      const publicId = await createTrip("PUBLIC", "Published discovery candidate");
      const communityId = await createTrip("COMMUNITY", "Community discovery candidate");
      const privateId = await createTrip("PRIVATE", "Private discovery candidate");
      const inviteId = await createTrip("INVITE_ONLY", "Invite-only discovery candidate");
      const draftId = await createTrip("PUBLIC", "Draft discovery candidate", false);
      const cancelledId = await createTrip("PUBLIC", "Cancelled discovery candidate");
      await request("POST", `/api/v1/trips/${cancelledId}/cancel`, { cookie: owner.cookie, body: {} });
      const fullId = await createTrip("PUBLIC", "Full discovery candidate");
      await TripMember.create([
        { trip: fullId, user: new mongoose.Types.ObjectId(), role: "MEMBER", status: "ACTIVE", joinedAt: new Date() },
        { trip: fullId, user: new mongoose.Types.ObjectId(), role: "MEMBER", status: "ACTIVE", joinedAt: new Date() },
        { trip: fullId, user: new mongoose.Types.ObjectId(), role: "MEMBER", status: "ACTIVE", joinedAt: new Date() },
      ]);

      const query = new URLSearchParams({
        destination: "Coastal Example",
        startDate: new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(endDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        dateFlexibility: "1",
        budgetMin: "12000",
        budgetMax: "15000",
        budgetCurrency: "INR",
        groupSize: "2",
        travelStyle: "adventure",
        interests: "trekking",
        activities: "hiking",
        accommodation: "hostel",
        transport: "train",
        foodPreference: "vegan",
        language: "hindi",
        sort: "date",
      });
      const discovery = await request("GET", `/api/v1/trips?${query}`);
      assert.equal(discovery.response.status, 200);
      assert.deepEqual(discovery.payload.data.items.map((trip) => trip.id), [publicId]);
      assert.equal(discovery.payload.data.items[0].currentMembers, 1);
      assert.equal(discovery.payload.data.items[0].availableSlots, 3);
      assert.equal(discovery.payload.data.items[0].creator.email, undefined);
      assert.equal(discovery.payload.data.items[0].creator.dateOfBirth, undefined);

      const signedInDiscovery = await request("GET", `/api/v1/trips?${query}`, { cookie: other.cookie });
      assert.deepEqual(
        signedInDiscovery.payload.data.items.map((trip) => trip.id).sort(),
        [publicId, communityId].sort(),
      );
      const wrongCurrency = await request(
        "GET",
        `/api/v1/trips?${new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString(), budgetMin: "10000", budgetCurrency: "USD" })}`,
      );
      assert.equal(wrongCurrency.response.status, 200);
      assert.equal(wrongCurrency.payload.data.items.some((trip) => trip.id === publicId), false);
      const verifiedOnly = await request("GET", `/api/v1/trips?${new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString(), verifiedOnly: "true" })}`);
      assert.equal(verifiedOnly.response.status, 200);
      assert.equal(verifiedOnly.payload.data.items.some((trip) => trip.id === publicId), false);
      for (const excludedId of [privateId, inviteId, draftId, cancelledId, fullId]) {
        assert.equal(discovery.payload.data.items.some((trip) => trip.id === excludedId), false);
      }
    });

    await context.test("logout invalidates the persisted session version", async () => {
      const logout = await request("POST", "/api/v1/auth/logout", { cookie: owner.cookie });
      assert.equal(logout.response.status, 200);
      const staleSession = await request("GET", "/api/v1/auth/me", { cookie: owner.cookie });
      assert.equal(staleSession.response.status, 401);
      const user = await User.findById(owner.user.id).select("+tokenVersion");
      assert.equal(user.tokenVersion, 1);
    });

    await context.test("itinerary generation persists owner-private plans with a safe fallback", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_MODEL;
      const created = await request("POST", "/api/v1/itineraries/generate", {
        cookie: owner.cookie,
        body: { destination: "Lisbon", startDate: "2027-05-01", endDate: "2027-05-02", budget: { amount: 500, currency: "EUR" } },
      });
      assert.equal(created.response.status, 201);
      assert.equal(created.payload.data.source, "DETERMINISTIC_FALLBACK");
      assert.equal(created.payload.data.plan.days.length, 2);
      assert.equal(created.payload.data.plan.days[0].morning.activities[0].estimatedCost.amount, null);
      const privateRead = await request("GET", `/api/v1/itineraries/${created.payload.data.id}`, { cookie: other.cookie });
      assert.equal(privateRead.response.status, 404);
      const ownRead = await request("GET", `/api/v1/itineraries/${created.payload.data.id}`, { cookie: owner.cookie });
      assert.equal(ownRead.response.status, 200);
      const changed = await request("PATCH", `/api/v1/itineraries/${created.payload.data.id}`, { cookie: owner.cookie, body: { title: "Saved Lisbon plan" } });
      assert.equal(changed.response.status, 200);
      assert.equal(changed.payload.data.title, "Saved Lisbon plan");
      const listing = await request("GET", "/api/v1/itineraries", { cookie: owner.cookie });
      assert.equal(listing.payload.data.total, 1);

      const destination = await Destination.create({ name: "Planner Test City", slug: `planner-test-${Date.now()}`, country: "Testland", description: "Test destination only." });
      const trip = await Trip.create({ creator: owner.user.id, destination: destination._id, title: "Private test trip", startDate: new Date("2027-06-01T00:00:00Z"), endDate: new Date("2027-06-02T00:00:00Z"), status: "PLANNING" });
      await TripMember.create([
        { trip: trip._id, user: owner.user.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() },
        { trip: trip._id, user: other.user.id, role: "MEMBER", status: "ACTIVE", joinedAt: new Date() },
      ]);
      const linked = await request("POST", "/api/v1/itineraries/generate", { cookie: owner.cookie, body: { tripId: trip._id.toString() } });
      assert.equal(linked.response.status, 201);
      const memberAttempt = await request("POST", "/api/v1/itineraries/generate", { cookie: other.cookie, body: { tripId: trip._id.toString() } });
      assert.equal(memberAttempt.response.status, 404, "membership does not permit linking a private plan");
      const linkedPlanAccess = await request("GET", `/api/v1/itineraries/${linked.payload.data.id}`, { cookie: other.cookie });
      assert.equal(linkedPlanAccess.response.status, 404, "trip membership does not share the creator's plan");
    });
  });
}
