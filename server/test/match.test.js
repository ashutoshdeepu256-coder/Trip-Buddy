const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Match = require("../src/models/Match");
const TripMember = require("../src/models/TripMember");
const User = require("../src/models/User");
const matchService = require("../src/services/match.service");
const tripService = require("../src/services/trip.service");
const safetyService = require("../src/services/safety.service");
const { requireMatchingAuth } = require("../src/middleware/auth");
const { profileSchema } = require("../src/validators/auth");
const { matchesQuerySchema, matchIdParamsSchema } = require("../src/validators/match.validator");

const userId = new mongoose.Types.ObjectId();
const tripId = new mongoose.Types.ObjectId();
const user = {
  _id: userId,
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  profile: { travelPreferences: { interests: ["hiking"] } },
};
const trip = {
  id: tripId.toString(),
  creator: { id: new mongoose.Types.ObjectId().toString() },
  status: "PUBLISHED",
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  interests: ["hiking"],
  groupSize: { min: 1, max: 4 },
};

test("match model references users and trips, stores bounded scores, and prevents duplicate pair records", () => {
  assert.equal(Match.schema.path("trip").options.ref, "Trip");
  assert.equal(Match.schema.path("user").options.ref, "User");
  assert.equal(Match.schema.path("score").options.min, 0);
  assert.equal(Match.schema.path("score").options.max, 100);
  assert.ok(Match.schema.path("status").enumValues.includes("CONNECTED"));
  assert.ok(Match.schema.path("status").enumValues.includes("DISMISSED"));
  assert.ok(Match.schema.indexes().some(([fields, options]) =>
    fields.trip === 1 && fields.user === 1 && options.unique,
  ));
  assert.ok(Match.schema.indexes().some(([fields]) => fields.score === -1));
  assert.ok(Match.schema.indexes().some(([fields]) => fields.status === 1));
});

test("preference validators accept additive matching fields and reject invalid ranges", () => {
  const valid = profileSchema.parse({
    travelPreferences: {
      budgetRange: { min: 100, max: 250, currency: "inr" },
      groupSizeRange: { min: 2, max: 6 },
      availability: { startDate: "2027-04-01", endDate: "2027-04-12" },
      dateFlexibilityDays: 3,
      accommodationPreference: ["Hostel"],
      travelPace: "MODERATE",
    },
  });
  assert.equal(valid.travelPreferences.budgetRange.currency, "INR");
  assert.equal(profileSchema.safeParse({
    travelPreferences: { budgetRange: { min: 300, max: 100, currency: "USD" } },
  }).success, false);
  assert.equal(profileSchema.safeParse({
    travelPreferences: { availability: { startDate: "2027-04-12", endDate: "2027-04-01" } },
  }).success, false);
  assert.equal(profileSchema.safeParse({
    travelPreferences: { travelPace: "TURBO" },
  }).success, false);
});

test("match endpoints validate bounded pagination and object identifiers", () => {
  assert.deepEqual(matchesQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.equal(matchesQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(matchesQuerySchema.safeParse({ status: "PENDING" }).success, false);
  assert.equal(matchIdParamsSchema.safeParse({ matchId: "not-an-id" }).success, false);
});

test("matching authentication projects preferences, account status, and session version", async (context) => {
  const secret = "test-only-matching-secret-with-at-least-thirty-two-characters";
  process.env.JWT_SECRET = secret;
  let selectedFields;
  const authenticatedUser = { _id: userId, tokenVersion: 0, accountStatus: "ACTIVE", profile: user.profile, updatedAt: user.updatedAt };
  context.mock.method(User, "findById", () => ({
    select(fields) {
      selectedFields = fields;
      return Promise.resolve(authenticatedUser);
    },
  }));
  const token = jwt.sign({ v: 0 }, secret, {
    subject: userId.toString(),
    issuer: "tripbuddy",
    audience: "tripbuddy-web",
    expiresIn: "1m",
  });
  const request = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const error = await new Promise((resolve) => requireMatchingAuth(request, {}, resolve));
  assert.equal(error, undefined);
  assert.equal(selectedFields, "_id profile.travelPreferences updatedAt accountStatus +tokenVersion");
  assert.equal("email" in request.user, false);
  assert.equal("phoneNumber" in request.user, false);
  assert.equal("role" in request.user, false);
});

test("matching authentication rejects a suspended account", async (context) => {
  const secret = "test-only-suspended-match-secret-with-at-least-thirty-two-characters";
  process.env.JWT_SECRET = secret;
  context.mock.method(User, "findById", () => ({
    select(fields) {
      assert.match(fields, /(?:^|\s)accountStatus(?:\s|$)/);
      return Promise.resolve({ _id: userId, tokenVersion: 0, accountStatus: "SUSPENDED" });
    },
  }));
  const token = jwt.sign({ v: 0 }, secret, {
    subject: userId.toString(),
    issuer: "tripbuddy",
    audience: "tripbuddy-web",
    expiresIn: "1m",
  });
  const request = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
  const error = await new Promise((resolve) => requireMatchingAuth(request, {}, resolve));
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, "ACCOUNT_RESTRICTED");
  assert.equal(request.user, undefined);
});

test("compatibility cache is keyed by user and trip updates and refresh forces recalculation", async () => {
  const first = await matchService.calculateTripCompatibility({ trip, user, currentMembers: 1 });
  const cached = await matchService.calculateTripCompatibility({ trip, user, currentMembers: 1 });
  assert.deepEqual(first, cached);
  const newTrip = { ...trip, updatedAt: new Date("2026-10-03T00:00:00.000Z"), interests: ["kayaking"] };
  const updated = await matchService.calculateTripCompatibility({ trip: newTrip, user, currentMembers: 1 });
  assert.notDeepEqual(updated, first);
  const forced = await matchService.calculateTripCompatibility({ trip, user, currentMembers: 1, force: true });
  assert.deepEqual(forced, first);
});

test("an optional Gemini explanation failure falls back without changing deterministic scores", async () => {
  const result = await matchService.calculateTripCompatibility({
    trip: { ...trip, destination: "Kyoto" },
    user,
    currentMembers: 1,
  });
  const scoreBefore = result.overallScore;
  const failed = await matchService.generateCompatibilityExplanation(result, async () => {
    throw new Error("Gemini unavailable");
  });
  assert.equal(failed.source, "DETERMINISTIC_FALLBACK");
  assert.equal(typeof failed.text, "string");
  assert.equal(result.overallScore, scoreBefore);

  const providerResponse = await matchService.generateCompatibilityExplanation(result, async () => ({
    overallScore: 0,
    explanation: "Shared interests support this trip.",
  }));
  assert.equal(providerResponse.text, "Shared interests support this trip.");
  assert.equal(result.overallScore, scoreBefore);
});

test("trip compatibility respects trip visibility and never calculates for the creator", async (context) => {
  const accessError = Object.assign(new Error("not found"), { statusCode: 404, code: "TRIP_NOT_FOUND" });
  const inaccessible = context.mock.method(tripService, "getAccessibleTrip", async () => { throw accessError; });
  const memberLookup = context.mock.method(TripMember, "countDocuments", async () => 1);
  await assert.rejects(
    matchService.getTripCompatibility(tripId.toString(), user),
    (error) => error === accessError,
  );
  assert.equal(inaccessible.mock.callCount(), 1);
  assert.equal(memberLookup.mock.callCount(), 0);
});

test("a creator cannot inspect compatibility for their own trip", async (context) => {
  context.mock.method(tripService, "getAccessibleTrip", async () => ({
    ...trip,
    creator: { id: userId.toString() },
  }));
  const memberLookup = context.mock.method(TripMember, "countDocuments", async () => 1);
  await assert.rejects(
    matchService.getTripCompatibility(tripId.toString(), user),
    (error) => error.code === "SELF_MATCH_UNAVAILABLE",
  );
  assert.equal(memberLookup.mock.callCount(), 0);
});

test("completed and full trips cannot produce compatibility recommendations", async (context) => {
  context.mock.method(User, "findById", () => ({ select() { return this; }, lean: async () => ({ safetySettings: { discoverable: true } }) }));
  let accessibleTrip = { ...trip, status: "COMPLETED" };
  context.mock.method(tripService, "getAccessibleTrip", async () => accessibleTrip);
  context.mock.method(safetyService, "isInteractionBlocked", async () => false);
  const activeMembers = 1;
  const memberLookup = context.mock.method(TripMember, "countDocuments", async () => activeMembers);
  await assert.rejects(
    matchService.getTripCompatibility(tripId.toString(), user),
    (error) => error.statusCode === 404 && error.code === "TRIP_NOT_FOUND",
  );
  assert.equal(memberLookup.mock.callCount(), 0);

  accessibleTrip = { ...trip, groupSize: { min: 1, max: 1 } };
  await assert.rejects(
    matchService.getTripCompatibility(tripId.toString(), user),
    (error) => error.statusCode === 409 && error.code === "TRIP_FULL",
  );
});

test("refresh recalculates and persists one match for the authenticated user-trip pair", async (context) => {
  context.mock.method(User, "findById", () => ({ select() { return this; }, lean: async () => ({ safetySettings: { discoverable: true } }) }));
  context.mock.method(tripService, "getAccessibleTrip", async () => ({ ...trip, destination: { name: "Kyoto" } }));
  context.mock.method(safetyService, "isInteractionBlocked", async () => false);
  context.mock.method(TripMember, "countDocuments", async () => 1);
  let query;
  let values;
  let options;
  context.mock.method(Match, "findOneAndUpdate", async (matchQuery, update, updateOptions) => {
    query = matchQuery;
    values = update.$set;
    options = updateOptions;
    return { _id: new mongoose.Types.ObjectId(), ...values };
  });

  const result = await matchService.refreshTripCompatibility(tripId.toString(), user);
  assert.equal(query.trip, tripId.toString());
  assert.equal(query.user, userId);
  assert.equal(values.status, "CALCULATED");
  assert.equal(options.upsert, true);
  assert.equal(result.score, 100);
  assert.equal(result.trip.id, tripId.toString());
});

test("match detail query is scoped to the requesting user to prevent IDOR", async (context) => {
  let query;
  context.mock.method(Match, "findOne", (filter) => {
    query = filter;
    return {
      populate() { return this; },
      lean: async () => null,
    };
  });
  await assert.rejects(
    matchService.getMatchById(new mongoose.Types.ObjectId().toString(), user),
    (error) => error.statusCode === 404 && error.code === "MATCH_NOT_FOUND",
  );
  assert.equal(query.user, userId);
});

test("serialized matches exclude viewer identity, contact information, and verification data", () => {
  const serialized = matchService.serializeMatch({
    _id: new mongoose.Types.ObjectId(),
    trip: { _id: tripId, title: "A public trip", destination: { name: "Kyoto", slug: "kyoto" } },
    user: { _id: userId, email: "private@example.test", phoneNumber: "+10000000000" },
    score: 80,
    category: "GOOD",
    status: "CALCULATED",
  });
  assert.equal("user" in serialized, false);
  assert.equal(JSON.stringify(serialized).includes("private@example.test"), false);
  assert.equal(JSON.stringify(serialized).includes("+10000000000"), false);
});
