const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Destination = require("../src/models/Destination");
const Trip = require("../src/models/Trip");
const TripMember = require("../src/models/TripMember");
const tripDiscovery = require("../src/services/tripDiscovery.service");
const matchService = require("../src/services/match.service");
const safetyService = require("../src/services/safety.service");
const { discoveryQuerySchema } = require("../src/validators/trip-discovery.validator");

const parse = (query = {}) => discoveryQuerySchema.parse(query);

test("discovery query defaults, normalizes multi-value filters, and caps pagination", () => {
  const query = parse({
    interests: " Trekking,food, TREKKING ",
    travelStyle: "Adventure, relaxed",
    language: "EN, fr",
    verifiedOnly: "true",
    page: "2",
    limit: "50",
  });
  assert.deepEqual(query.interests, ["trekking", "food"]);
  assert.deepEqual(query.travelStyle, ["adventure", "relaxed"]);
  assert.deepEqual(query.language, ["en", "fr"]);
  assert.equal(query.verifiedOnly, true);
  assert.equal(query.page, 2);
  assert.equal(query.limit, 50);
  assert.equal(query.sort, "recent");
  assert.equal(parse().limit, 20);
});

test("discovery query rejects invalid ranges, currencies, booleans, filters, and limits", () => {
  assert.equal(discoveryQuerySchema.safeParse({ startDate: "2026-10-10" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ startDate: "2026-10-10", endDate: "2026-10-09" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ dateFlexibility: "2" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ budgetMin: "100" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ budgetMin: "200", budgetMax: "100", budgetCurrency: "USD" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ budgetMax: "100", budgetCurrency: "US" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ budgetFlexibility: "51", budgetCurrency: "USD", budgetMax: "100" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ groupMin: "5", groupMax: "2" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ groupSize: "2.5" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ verifiedOnly: "yes" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ limit: "51" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ $where: "sleep(1000)" }).success, false);
});

test("discovery pipeline limits publication and privacy before calculating open member slots", () => {
  const anonymous = tripDiscovery.buildDiscoveryPipeline(parse());
  assert.deepEqual(anonymous[0].$match, {
    status: { $in: ["PUBLISHED", "PLANNING", "CONFIRMED"] },
    moderationVisibility: { $ne: "HIDDEN" },
    privacy: "PUBLIC",
  });
  assert.ok(anonymous.some((stage) => stage.$match?.availableSlots?.$gt === 0));
  assert.ok(anonymous.some((stage) => stage.$lookup?.from === "tripmembers"));
  assert.ok(TripMember.schema.indexes().some(([fields]) => fields.trip === 1 && fields.status === 1));
  assert.ok(Trip.schema.path("languages"));

  const authenticated = tripDiscovery.buildDiscoveryPipeline(parse(), { _id: new mongoose.Types.ObjectId() });
  assert.deepEqual(authenticated[0].$match.privacy, { $in: ["PUBLIC", "COMMUNITY"] });
});

test("date overlap uses Date values and flexibility extends the requested range on both ends", () => {
  const filters = parse({
    startDate: "2026-10-10",
    endDate: "2026-10-15",
    dateFlexibility: "3",
  });
  const initialMatch = tripDiscovery.buildDiscoveryPipeline(filters)[0].$match;
  assert.ok(initialMatch.startDate.$lte instanceof Date);
  assert.ok(initialMatch.endDate.$gte instanceof Date);
  assert.equal(initialMatch.startDate.$lte.toISOString(), "2026-10-18T00:00:00.000Z");
  assert.equal(initialMatch.endDate.$gte.toISOString(), "2026-10-07T00:00:00.000Z");
});

test("budget overlap requires identical currency and applies the requested flexibility percentage", () => {
  const filters = parse({
    budgetMin: "10000",
    budgetMax: "15000",
    budgetCurrency: "inr",
    budgetFlexibility: "10",
  });
  const pipeline = tripDiscovery.buildDiscoveryPipeline(filters);
  assert.equal(pipeline[0].$match["budget.currency"], "INR");
  assert.deepEqual(pipeline[0].$match["budget.max"], { $gte: 9000 });
  assert.deepEqual(pipeline[0].$match["budget.min"], { $lte: 16500 });
});

test("discovery filters match any normalized value without allowing regex injection", () => {
  const pipeline = tripDiscovery.buildDiscoveryPipeline(parse({
    travelStyle: "Adventure,road trip",
    interests: "food,hack.*",
    activities: "hiking",
    accommodation: "hostel",
    transport: "train",
    foodPreference: "vegan",
    language: "English",
  }));
  for (const [field, expected] of [
    ["travelStyle", ["^adventure$", "^road trip$"]],
    ["interests", ["^food$", "^hack\\.\\*$"]],
    ["activities", ["^hiking$"]],
    ["accommodationPreference", ["^hostel$"]],
    ["transportPreference", ["^train$"]],
    ["foodPreference", ["^vegan$"]],
    ["languages", ["^english$"]],
  ]) {
    const match = pipeline.find((stage) => stage.$match?.[field]);
    assert.deepEqual(match.$match[field].$in.map((regex) => regex.source), expected);
    assert.equal(match.$match[field].$in[0].ignoreCase, true);
  }
});

test("nearby trip discovery uses GeoJSON longitude-latitude and filters eligibility in geoNear", () => {
  const filters = parse({ lat: "40.7", lng: "-73.9", radiusKm: "25" });
  const pipeline = tripDiscovery.buildDiscoveryPipeline(filters);
  assert.deepEqual(pipeline[0].$geoNear.near, { type: "Point", coordinates: [-73.9, 40.7] });
  assert.equal(pipeline[0].$geoNear.maxDistance, 25000);
  assert.equal(pipeline[0].$geoNear.key, "location");
  assert.deepEqual(pipeline[0].$geoNear.query, { status: { $in: ["PUBLISHED", "PLANNING", "CONFIRMED"] }, moderationVisibility: { $ne: "HIDDEN" }, privacy: "PUBLIC" });
  assert.ok(pipeline.some((stage) => stage.$lookup?.as === "destinationDoc"));
});

test("text search uses escaped case-insensitive patterns across trip and destination fields", () => {
  const pipeline = tripDiscovery.buildDiscoveryPipeline(parse({ q: "goa.*" }));
  const search = pipeline.find((stage) => stage.$match?.$or)?.$match.$or;
  assert.ok(search);
  assert.equal(search[0].title.source, "goa\\.\\*");
  assert.equal(search[0].title.ignoreCase, true);
  assert.equal(search.some((clause) => clause["destinationDoc.name"]), true);
});

test("verified-only is based on existing identity verification and sort options have stable definitions", () => {
  const pipeline = tripDiscovery.buildDiscoveryPipeline(parse({ verifiedOnly: "true" }));
  assert.ok(pipeline.some((stage) => stage.$match?.["creatorDoc.verification.identity.status"] === "VERIFIED"));
  assert.deepEqual(tripDiscovery.sortOptions.date, { startDate: 1, createdAt: -1, _id: -1 });
  assert.deepEqual(tripDiscovery.sortOptions.popularity, { currentMembers: -1, createdAt: -1, _id: -1 });
  assert.equal(tripDiscovery.sortOptions.compatibility, undefined);
});

test("anonymous compatibility sorting is rejected before any database query", async () => {
  await assert.rejects(
    tripDiscovery.discoverTrips(parse({ sort: "compatibility" })),
    (error) => error.statusCode === 401 && error.code === "UNAUTHENTICATED",
  );
});

test("compatibility sorting is authenticated, excludes the user's own trips, and caps scoring candidates", async (context) => {
  const viewerId = new mongoose.Types.ObjectId();
  const firstId = new mongoose.Types.ObjectId();
  const secondId = new mongoose.Types.ObjectId();
  const candidate = (id, title) => ({
    _id: id,
    title,
    destinationDoc: { _id: new mongoose.Types.ObjectId(), name: "Kyoto", slug: "kyoto", country: "Japan" },
    creatorDoc: { _id: new mongoose.Types.ObjectId(), name: "Traveler", verification: {} },
    startDate: new Date("2027-04-10"),
    endDate: new Date("2027-04-12"),
    groupSize: { min: 2, max: 5 },
    currentMembers: 1,
    availableSlots: 4,
    images: [],
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
  });
  let pipeline;
  context.mock.method(Trip, "aggregate", async (value) => {
    pipeline = value;
    return [candidate(firstId, "Lower match"), candidate(secondId, "Higher match")];
  });
  context.mock.method(safetyService, "getInteractionBlockedIds", async (_userId, creatorIds) => [creatorIds[0].toString()]);
  context.mock.method(matchService, "calculateTripCompatibility", async ({ trip: value }) => ({
    overallScore: value._id.equals(secondId) ? 95 : 72,
    category: value._id.equals(secondId) ? "EXCELLENT" : "MODERATE",
  }));

  const result = await tripDiscovery.discoverTrips(
    parse({ sort: "compatibility", limit: "2" }),
    { _id: viewerId, profile: { travelPreferences: { interests: ["hiking"] } } },
  );
  assert.equal(pipeline[0].$match.creator.$ne, viewerId);
  assert.ok(pipeline.some((stage) => stage.$limit === tripDiscovery.COMPATIBILITY_CANDIDATE_LIMIT + 1));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Higher match");
  assert.deepEqual(result.items.map(({ compatibility }) => compatibility.score), [95]);
  assert.equal(result.candidateLimit, 500);
});

test("destination lookup matches id, slug, or exact case-insensitive name", async (context) => {
  const selectors = [];
  context.mock.method(Destination, "find", (query) => {
    selectors.push(query);
    return {
      select() { return this; },
      limit() { return this; },
      lean: async () => [{ _id: new mongoose.Types.ObjectId() }],
    };
  });
  const ids = await tripDiscovery.resolveDestinationIds("A City");
  assert.equal(ids.length, 1);
  assert.equal(selectors[0].published, true);
  assert.equal(selectors[0].$or[0].slug, "a city");
  assert.equal(selectors[0].$or[1].name.source, "^A City$");
  assert.equal(selectors[0].$or[1].name.ignoreCase, true);
  const destinationId = new mongoose.Types.ObjectId().toString();
  await tripDiscovery.resolveDestinationIds(destinationId);
  assert.equal(selectors[1].$or[0]._id.toString(), destinationId);
  const slug = "coastal-example";
  await tripDiscovery.resolveDestinationIds(slug);
  assert.equal(selectors[2].$or[0].slug, slug);
});

test("discovery returns a paginated safe card from the aggregate result", async (context) => {
  const id = new mongoose.Types.ObjectId();
  let capturedPipeline;
  context.mock.method(Trip, "aggregate", async (pipeline) => {
    capturedPipeline = pipeline;
    return [{
      items: [{
        _id: id,
        title: "Coastal walk",
        destinationDoc: { _id: new mongoose.Types.ObjectId(), name: "Harbor", slug: "harbor", country: "Exampleland" },
        creatorDoc: {
          _id: new mongoose.Types.ObjectId(),
          name: "Traveler",
          email: "private@example.test",
          dateOfBirth: new Date("1990-01-01"),
          profile: { profileImage: "https://images.example.test/avatar.webp" },
          verification: { identity: { status: "VERIFIED" } },
        },
        startDate: new Date("2027-01-01"),
        endDate: new Date("2027-01-03"),
        budget: { min: 100, max: 200, currency: "USD" },
        groupSize: { min: 1, max: 4 },
        currentMembers: 1,
        availableSlots: 3,
        images: [{ url: "https://images.example.test/cover.webp", publicId: "private/public-id", format: "webp" }],
        status: "PUBLISHED",
        privacy: "PUBLIC",
        createdAt: new Date("2026-09-01"),
      }],
      metadata: [{ total: 3 }],
    }];
  });

  const result = await tripDiscovery.discoverTrips(parse({ page: "2", limit: "1", sort: "date" }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, id.toString());
  assert.equal(result.items[0].currentMembers, 1);
  assert.equal(result.items[0].availableSlots, 3);
  assert.equal(result.items[0].creator.verificationStatus.identity, true);
  assert.equal(result.items[0].coverImage.url, "https://images.example.test/cover.webp");
  assert.equal("email" in result.items[0].creator, false);
  assert.equal("dateOfBirth" in result.items[0].creator, false);
  assert.equal("publicId" in result.items[0].coverImage, false);
  assert.deepEqual(result, {
    items: [result.items[0]],
    page: 2,
    limit: 1,
    total: 3,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
  assert.deepEqual(capturedPipeline.at(-1).$facet.items.slice(0, 3), [
    { $sort: { startDate: 1, createdAt: -1, _id: -1 } },
    { $skip: 1 },
    { $limit: 1 },
  ]);
});

test("unsupported age filters fail explicitly and compatibility sorting requires authentication", async () => {
  await assert.rejects(
    tripDiscovery.discoverTrips(parse({ ageMin: "25" })),
    (error) => error.statusCode === 422 && error.code === "AGE_FILTER_UNAVAILABLE",
  );
  await assert.rejects(
    tripDiscovery.discoverTrips(parse({ sort: "compatibility" })),
    (error) => error.statusCode === 401 && error.code === "UNAUTHENTICATED",
  );
});
