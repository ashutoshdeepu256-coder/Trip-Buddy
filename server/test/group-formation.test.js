const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const GroupRecommendation = require("../src/models/GroupRecommendation");
const User = require("../src/models/User");
const TripMember = require("../src/models/TripMember");
const Block = require("../src/models/Block");
const AuditLog = require("../src/models/AuditLog");
const groupFormation = require("../src/services/groupFormation.service");
const tripService = require("../src/services/trip.service");
const safetyService = require("../src/services/safety.service");
const matchService = require("../src/services/match.service");
const { recommendationIdParamsSchema } = require("../src/validators/group-recommendation.validator");

const traveller = (id, preferences = {}) => ({
  _id: new mongoose.Types.ObjectId(id),
  profile: { travelPreferences: preferences },
});

const trip = {
  budget: { min: 500, max: 1000, currency: "USD" },
  startDate: "2027-04-10T00:00:00.000Z",
  endDate: "2027-04-15T00:00:00.000Z",
};

const result = (score) => ({
  overallScore: score,
  breakdown: { destination: score, dates: score, budget: score, interests: score, travelStyle: score, activities: score, groupSize: score, otherPreferences: null },
  dimensionStatus: { destination: "MATCH", dates: "MATCH", budget: "MATCH" },
  unknownDimensions: [],
});

const recommendationId = new mongoose.Types.ObjectId();
const ownerId = new mongoose.Types.ObjectId();
const firstId = new mongoose.Types.ObjectId();
const secondId = new mongoose.Types.ObjectId();
const tripId = new mongoose.Types.ObjectId();
const liveTrip = {
  id: tripId.toString(),
  creator: { id: ownerId.toString() },
  title: "Spring hike",
  destination: { name: "Kyoto" },
  status: "PUBLISHED",
  privacy: "PUBLIC",
  groupSize: { min: 1, max: 5 },
  budget: { min: null, max: null, currency: "USD" },
};
const pendingRecommendation = (proposedUsers = [
  { user: firstId, score: 90, scoreBreakdown: {}, dimensionStatus: {}, reasons: [], status: "PENDING" },
  { user: secondId, score: 80, scoreBreakdown: {}, dimensionStatus: {}, reasons: [], status: "PENDING" },
]) => ({
  _id: recommendationId,
  trip: tripId,
  proposedUsers,
  score: 85,
  scoreBreakdown: {},
  reasons: [],
  constraintsSatisfied: [],
  unknownConstraints: [],
  status: "VIEWED",
  algorithmVersion: "greedy-v1",
  generationKey: "a".repeat(64),
  expiresAt: new Date(Date.now() + 60000),
  currentMembers: 1,
});

const stubRecommendationAccess = (context, recommendation, trip = liveTrip) => {
  context.mock.method(GroupRecommendation, "findById", () => ({ lean: async () => recommendation }));
  context.mock.method(tripService, "getAccessibleTrip", async () => trip);
  context.mock.method(safetyService, "getInteractionBlockedIds", async () => []);
  context.mock.method(Block, "find", () => ({ select() { return { lean: async () => [] }; } }));
};

test("group recommendation model is separate from TripMember and has lifecycle and idempotency indexes", () => {
  assert.equal(GroupRecommendation.schema.path("trip").options.ref, "Trip");
  assert.equal(GroupRecommendation.schema.path("proposedUsers").schema.path("user").options.ref, "User");
  assert.ok(GroupRecommendation.schema.path("status").enumValues.includes("PROPOSED"));
  assert.ok(GroupRecommendation.schema.path("status").enumValues.includes("SUPERSEDED"));
  assert.ok(GroupRecommendation.schema.indexes().some(([fields, options]) => fields.activeKey === 1 && options.unique));
  assert.ok(GroupRecommendation.schema.indexes().some(([fields, options]) => fields.trip === 1 && fields.generationKey === 1 && options.unique));
  assert.deepEqual(User.schema.path("accountStatus").enumValues, ["ACTIVE", "SUSPENDED", "BANNED"]);
});

test("candidate query admits active and legacy accounts while excluding explicit suspended or banned accounts", () => {
  const excluded = [new mongoose.Types.ObjectId()];
  const query = groupFormation.buildEligibleUserQuery(excluded);
  assert.deepEqual(query._id.$nin, excluded);
  assert.deepEqual(query.$or, [
    { accountStatus: "ACTIVE" },
    { accountStatus: { $exists: false } },
  ]);
});

test("group-level budget constraints reject disjoint same-currency ranges and ignore unknown currencies", () => {
  const existing = [traveller("64b000000000000000000001", { budgetRange: { min: 600, max: 900, currency: "USD" } })];
  const compatible = traveller("64b000000000000000000002", { budgetRange: { min: 700, max: 950, currency: "USD" } });
  const incompatible = traveller("64b000000000000000000003", { budgetRange: { min: 1100, max: 1300, currency: "USD" } });
  const otherCurrency = traveller("64b000000000000000000004", { budgetRange: { min: 100, max: 200, currency: "INR" } });
  assert.equal(groupFormation.groupConstraintsAllow(trip, existing, compatible, new Set()).allowed, true);
  assert.equal(groupFormation.groupConstraintsAllow(trip, existing, incompatible, new Set()).reason, "GROUP_BUDGET_MISMATCH");
  assert.equal(groupFormation.groupConstraintsAllow(trip, existing, otherCurrency, new Set()).allowed, true);
  assert.equal(groupFormation.groupConstraintsAllow({ ...trip, budget: { min: null, max: null, currency: "USD" } }, [], incompatible, new Set()).allowed, true);
});

test("group-level date constraints reject no overlap and mark missing availability as unknown input", () => {
  const available = traveller("64b000000000000000000001", {
    availability: { startDate: "2027-04-10", endDate: "2027-04-14" },
  });
  const disjoint = traveller("64b000000000000000000002", {
    availability: { startDate: "2027-05-01", endDate: "2027-05-10" },
  });
  const unknown = traveller("64b000000000000000000003", {});
  assert.equal(groupFormation.groupConstraintsAllow(trip, [available], disjoint, new Set()).reason, "DATE_MISMATCH");
  assert.equal(groupFormation.groupConstraintsAllow(trip, [available], unknown, new Set()).allowed, true);
  const singleDay = traveller("64b000000000000000000004", {
    availability: { startDate: "2027-04-12", endDate: "2027-04-12" },
  });
  assert.equal(groupFormation.groupConstraintsAllow(trip, [], singleDay, new Set()).allowed, true);
});

test("blocked pairs prevent co-formation without excluding unrelated candidates", () => {
  const first = traveller("64b000000000000000000001");
  const blocked = traveller("64b000000000000000000002");
  const unrelated = traveller("64b000000000000000000003");
  const blockedPair = [first._id.toString(), blocked._id.toString()].sort().join(":");
  const blockSet = new Set([blockedPair]);
  assert.equal(groupFormation.groupConstraintsAllow(trip, [first], blocked, blockSet).allowed, false);
  assert.equal(groupFormation.groupConstraintsAllow(trip, [first], unrelated, blockSet).allowed, true);
});

test("bounded greedy group selection is deterministic, diverse, and deduplicates travellers", () => {
  const first = traveller("64b000000000000000000001", { interests: ["hiking"] });
  const duplicate = traveller("64b000000000000000000001", { interests: ["hiking"] });
  const second = traveller("64b000000000000000000002", { interests: ["food"] });
  const third = traveller("64b000000000000000000003", { interests: ["hiking"] });
  const candidates = [
    { user: first, result: result(92) },
    { user: duplicate, result: result(95) },
    { user: second, result: result(90) },
    { user: third, result: result(88) },
  ];
  const firstRun = groupFormation.buildGroup(trip, [], candidates, new Set(), 3);
  const secondRun = groupFormation.buildGroup(trip, [], candidates, new Set(), 3);
  assert.deepEqual(firstRun.map(({ user }) => user._id.toString()), secondRun.map(({ user }) => user._id.toString()));
  assert.equal(new Set(firstRun.map(({ user }) => user._id.toString())).size, firstRun.length);
  assert.ok(firstRun.length <= 3);
  assert.ok(firstRun.some(({ user }) => user._id.toString() === second._id.toString()));
});

test("empty candidate pool returns no fabricated group", () => {
  assert.deepEqual(groupFormation.buildGroup(trip, [], [], new Set(), 4), []);
});

test("group reasons expose only shared interests already listed on the trip", () => {
  const members = [
    { user: traveller("64b000000000000000000001", { interests: ["hiking", "private preference"] }), result: result(90) },
    { user: traveller("64b000000000000000000002", { interests: ["hiking", "private preference"] }), result: result(90) },
  ];
  const reasons = groupFormation.recommendationReasons({ ...trip, interests: ["hiking"] }, members, []);
  assert.ok(reasons.some((reason) => reason.includes("hiking")));
  assert.equal(reasons.some((reason) => reason.includes("private preference")), false);
});

test("recommendation route identifiers reject malformed IDs", () => {
  assert.equal(recommendationIdParamsSchema.safeParse({ recommendationId: "not-an-id" }).success, false);
  assert.equal(recommendationIdParamsSchema.safeParse({ recommendationId: "64b000000000000000000001" }).success, true);
});

test("only an included traveller can read a recommendation", async (context) => {
  stubRecommendationAccess(context, pendingRecommendation());
  await assert.rejects(
    groupFormation.getGroupRecommendation(recommendationId.toString(), { _id: new mongoose.Types.ObjectId() }),
    (error) => error.statusCode === 404 && error.code === "GROUP_RECOMMENDATION_NOT_FOUND",
  );
});

test("acceptance records only the actor's consent and does not create memberships", async (context) => {
  const recommendation = pendingRecommendation();
  const actor = { _id: firstId, accountStatus: "ACTIVE" };
  stubRecommendationAccess(context, recommendation);
  context.mock.method(User, "findById", () => ({ select() { return { lean: async () => actor }; } }));
  const users = [
    { _id: firstId, name: "Ari", accountStatus: "ACTIVE", profile: { travelPreferences: {} } },
    { _id: secondId, name: "Sam", accountStatus: "ACTIVE", profile: { travelPreferences: {} } },
  ];
  context.mock.method(User, "find", () => ({ select() { return { lean: async () => users }; } }));
  context.mock.method(TripMember, "countDocuments", async () => 1);
  context.mock.method(TripMember, "exists", async () => false);
  context.mock.method(TripMember, "find", () => ({ select() { return { lean: async () => [] }; } }));
  context.mock.method(matchService, "calculateTripCompatibility", async () => result(90));
  context.mock.method(AuditLog, "create", async () => ({}));
  const membershipInsert = context.mock.method(TripMember, "create", async () => { throw new Error("membership must not be created"); });
  let updateFilter;
  let update;
  context.mock.method(GroupRecommendation, "findOneAndUpdate", (filter, values) => {
    updateFilter = filter;
    update = values;
    const next = { ...recommendation, proposedUsers: recommendation.proposedUsers.map((member) => ({ ...member })) };
    next.proposedUsers[0].status = "ACCEPTED";
    next.status = "VIEWED";
    return { lean: async () => next };
  });
  const accepted = await groupFormation.acceptGroupRecommendation(recommendationId.toString(), actor, { user: actor, ip: null, get: () => null });
  assert.equal(updateFilter.proposedUsers.$elemMatch.status, "PENDING");
  assert.equal(update.$set["proposedUsers.$.status"], "ACCEPTED");
  assert.equal(accepted.status, "VIEWED");
  assert.equal(accepted.myCompatibility.response, "ACCEPTED");
  assert.equal(membershipInsert.mock.callCount(), 0);
});

test("one traveller accepting cannot mark a multi-person recommendation accepted", async (context) => {
  const recommendation = pendingRecommendation();
  const actor = { _id: firstId, accountStatus: "ACTIVE" };
  stubRecommendationAccess(context, recommendation);
  context.mock.method(User, "findById", () => ({ select() { return { lean: async () => actor }; } }));
  const users = [
    { _id: firstId, name: "Ari", accountStatus: "ACTIVE", profile: { travelPreferences: {} } },
    { _id: secondId, name: "Sam", accountStatus: "ACTIVE", profile: { travelPreferences: {} } },
  ];
  context.mock.method(User, "find", () => ({ select() { return { lean: async () => users }; } }));
  context.mock.method(TripMember, "countDocuments", async () => 1);
  context.mock.method(TripMember, "exists", async () => false);
  context.mock.method(TripMember, "find", () => ({ select() { return { lean: async () => [] }; } }));
  context.mock.method(matchService, "calculateTripCompatibility", async () => result(90));
  context.mock.method(AuditLog, "create", async () => ({}));
  context.mock.method(GroupRecommendation, "findOneAndUpdate", (filter) => {
    assert.equal(filter.proposedUsers.$not, undefined);
    const next = { ...recommendation, proposedUsers: recommendation.proposedUsers.map((member) => ({ ...member })) };
    next.proposedUsers[0].status = "ACCEPTED";
    return { lean: async () => next };
  });
  const response = await groupFormation.acceptGroupRecommendation(recommendationId.toString(), actor, { user: actor, ip: null, get: () => null });
  assert.equal(response.status, "VIEWED");
  assert.equal(response.members.filter(({ response: choice }) => choice === "ACCEPTED").length, 1);
});

test("owner cannot accept for a proposed traveller", async (context) => {
  stubRecommendationAccess(context, pendingRecommendation());
  await assert.rejects(
    groupFormation.acceptGroupRecommendation(recommendationId.toString(), { _id: ownerId }, { user: { _id: ownerId } }),
    (error) => error.statusCode === 403 && error.code === "GROUP_RESPONSE_FORBIDDEN",
  );
});

test("only the trip owner can generate a group recommendation", async (context) => {
  context.mock.method(tripService, "getAccessibleTrip", async () => liveTrip);
  await assert.rejects(
    groupFormation.generateGroupRecommendation(tripId.toString(), { _id: firstId, accountStatus: "ACTIVE" }, {}),
    (error) => error.statusCode === 403 && error.code === "GROUP_RECOMMENDATION_FORBIDDEN",
  );
});

test("generation persists one proposed recommendation and repeated generation reuses it", async (context) => {
  const generationTripId = new mongoose.Types.ObjectId();
  const generationOwnerId = new mongoose.Types.ObjectId();
  const firstCandidate = traveller(new mongoose.Types.ObjectId().toString(), { interests: ["hiking"] });
  firstCandidate.name = "Ari";
  firstCandidate.accountStatus = "ACTIVE";
  firstCandidate.updatedAt = new Date("2026-10-01T00:00:00.000Z");
  const secondCandidate = traveller(new mongoose.Types.ObjectId().toString(), { interests: ["food"] });
  secondCandidate.name = "Sam";
  secondCandidate.accountStatus = "ACTIVE";
  secondCandidate.updatedAt = new Date("2026-10-02T00:00:00.000Z");
  const owner = { _id: generationOwnerId, accountStatus: "ACTIVE", profile: { travelPreferences: {} } };
  const generationTrip = {
    ...liveTrip,
    id: generationTripId.toString(),
    creator: { id: generationOwnerId.toString() },
    updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    groupSize: { min: 1, max: 3 },
  };
  context.mock.method(tripService, "getAccessibleTrip", async () => generationTrip);
  context.mock.method(GroupRecommendation, "updateMany", async () => ({ modifiedCount: 0 }));
  context.mock.method(TripMember, "find", () => ({ select() { return { lean: async () => [{ user: generationOwnerId, status: "ACTIVE" }] }; } }));
  context.mock.method(GroupRecommendation, "find", () => ({ select() { return { lean: async () => [] }; } }));
  context.mock.method(User, "find", (query) => ({
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => query._id?.$nin
      ? [firstCandidate, secondCandidate]
      : query._id?.$in
        ? [owner]
        : [firstCandidate, secondCandidate],
  }));
  context.mock.method(safetyService, "getInteractionBlockedIds", async () => []);
  context.mock.method(Block, "find", () => ({ select() { return { lean: async () => [] }; } }));
  context.mock.method(matchService, "calculateTripCompatibility", async () => result(90));
  let saved;
  context.mock.method(GroupRecommendation, "findOne", (query) => ({
    lean: async () => query.activeKey ? saved : null,
  }));
  const create = context.mock.method(GroupRecommendation, "create", async (values) => {
    saved = { ...values, _id: new mongoose.Types.ObjectId(), createdAt: new Date(), updatedAt: new Date() };
    return saved;
  });
  const membershipInsert = context.mock.method(TripMember, "create", async () => { throw new Error("generation must not add members"); });
  context.mock.method(AuditLog, "create", async () => ({}));
  const req = { user: owner, ip: null, get: () => null };
  const generated = await groupFormation.generateGroupRecommendation(generationTripId.toString(), owner, req);
  const repeated = await groupFormation.generateGroupRecommendation(generationTripId.toString(), owner, req);
  assert.equal(generated.recommendation.status, "PROPOSED");
  assert.equal(generated.recommendation.proposedTravellerCount, 2);
  assert.equal(repeated.reused, true);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(membershipInsert.mock.callCount(), 0);
});

test("rejecting one proposed place rejects the proposal without adding a member", async (context) => {
  const recommendation = pendingRecommendation();
  const actor = { _id: secondId, accountStatus: "ACTIVE" };
  stubRecommendationAccess(context, recommendation);
  const next = { ...recommendation, status: "REJECTED", proposedUsers: recommendation.proposedUsers.map((member) => ({ ...member })) };
  next.proposedUsers[1].status = "REJECTED";
  let update;
  context.mock.method(GroupRecommendation, "findOneAndUpdate", (_filter, values) => {
    update = values;
    return { lean: async () => next };
  });
  context.mock.method(User, "find", () => ({ select() { return { lean: async () => [
    { _id: firstId, name: "Ari" },
    { _id: secondId, name: "Sam" },
  ] }; } }));
  context.mock.method(AuditLog, "create", async () => ({}));
  const membershipInsert = context.mock.method(TripMember, "create", async () => { throw new Error("membership must not be created"); });
  const response = await groupFormation.rejectGroupRecommendation(recommendationId.toString(), actor, { user: actor, ip: null, get: () => null });
  assert.equal(update.$set.status, "REJECTED");
  assert.equal(update.$set["proposedUsers.$.status"], "REJECTED");
  assert.equal(response.status, "REJECTED");
  assert.equal(membershipInsert.mock.callCount(), 0);
});

test("terminal recommendations reject further consent transitions", async (context) => {
  const recommendation = pendingRecommendation();
  recommendation.status = "ACCEPTED";
  stubRecommendationAccess(context, recommendation);
  await assert.rejects(
    groupFormation.acceptGroupRecommendation(recommendationId.toString(), { _id: firstId, accountStatus: "ACTIVE" }, {}),
    (error) => error.statusCode === 409 && error.code === "INVALID_RECOMMENDATION_STATE",
  );
});
