const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Itinerary = require("../src/models/Itinerary");
const ItineraryRevision = require("../src/models/ItineraryRevision");
const TripMember = require("../src/models/TripMember");
const Trip = require("../src/models/Trip");
const User = require("../src/models/User");
const collaboration = require("../src/services/collaborativeItinerary.service");
const schemas = require("../src/validators/itinerary.validator");

test("collaboration fields are private by default and grants have constrained roles", () => {
  const itinerary = new Itinerary({ owner: new mongoose.Types.ObjectId(), title: "Test", destination: "Rome", startDate: new Date(), endDate: new Date(), plan: { days: [] }, source: "DETERMINISTIC_FALLBACK" });
  assert.equal(itinerary.collaborationEnabled, false);
  assert.deepEqual(itinerary.collaborators, []);
  assert.equal(itinerary.revision, 1);
  assert.equal(Itinerary.schema.path("collaborators").schema.path("role").enumValues.includes("EDITOR"), true);
  assert.equal(Itinerary.schema.path("collaborators").schema.path("role").enumValues.includes("OWNER"), false);
  assert.ok(Itinerary.schema.indexes().some(([fields]) => fields["collaborators.user"] === 1 && fields.collaborationEnabled === 1));
  assert.ok(ItineraryRevision.schema.indexes().some(([fields, options]) => fields.itinerary === 1 && fields.revision === -1 && options.unique));
});

test("collaborative request schemas require revisions and reject unsafe roles and fields", () => {
  const userId = new mongoose.Types.ObjectId().toString();
  assert.equal(schemas.collaborationPolicySchema.safeParse({ enabled: true, expectedRevision: 1 }).success, true);
  assert.equal(schemas.collaboratorSchema.safeParse({ userId, role: "EDITOR", expectedRevision: 1 }).success, true);
  assert.equal(schemas.collaboratorSchema.safeParse({ userId, role: "OWNER", expectedRevision: 1 }).success, false);
  assert.equal(schemas.collaboratorSchema.safeParse({ userId, role: "VIEWER" }).success, false);
  assert.equal(schemas.reorderSchema.safeParse({ expectedRevision: 1, dayId: userId, section: "morning", activityIds: [userId] }).success, true);
});

test("shared activity fields and durations are validated", () => {
  const id = new mongoose.Types.ObjectId().toString();
  const body = { expectedRevision: 2, dayId: id, section: "morning", activity: { title: "Museum", description: "", durationMinutes: 90, estimatedCost: { amount: null, currency: "EUR" }, location: "Rome" } };
  assert.equal(schemas.editActivitySchema.safeParse(body).success, true);
  assert.equal(schemas.editActivitySchema.safeParse({ ...body, activity: { ...body.activity, durationMinutes: 5 } }).success, false);
  assert.equal(schemas.editActivitySchema.safeParse({ ...body, revision: 2 }).success, false);
});

test("shared reads require current active membership and an explicit grant; viewers cannot edit", async (context) => {
  const actorId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const tripId = new mongoose.Types.ObjectId();
  const itineraryId = new mongoose.Types.ObjectId();
  let member = { role: "MEMBER" };
  context.mock.method(Itinerary, "findById", async () => ({ _id: itineraryId, owner: ownerId, trip: tripId, collaborationEnabled: true, collaborators: [{ user: actorId, role: "VIEWER" }] }));
  context.mock.method(TripMember, "findOne", () => ({ select() { return this; }, lean: async () => member }));
  context.mock.method(Trip, "findById", () => ({ select() { return this; }, lean: async () => ({ creator: ownerId }) }));
  context.mock.method(User, "findById", () => ({ select() { return this; }, lean: async () => ({ accountStatus: "ACTIVE", role: "USER" }) }));

  await assert.rejects(collaboration.authorizeSocket(itineraryId, actorId, true), { code: "ITINERARY_READ_ONLY" });
  await collaboration.authorizeSocket(itineraryId, actorId, false);
  member = null;
  await assert.rejects(collaboration.authorizeSocket(itineraryId, actorId, false), { code: "ITINERARY_NOT_FOUND" });
});

test("MongoDB concurrency integration is skipped unless a dedicated test database URI is set", { skip: !process.env.MONGODB_TEST_URI ? "MONGODB_TEST_URI is not configured" : false }, async () => {
  const uri = process.env.MONGODB_TEST_URI;
  const databaseName = new URL(uri).pathname.replace(/^\//, "").split("?")[0];
  assert.match(databaseName, /(^|[_-])test([_-]|$)/i, "MONGODB_TEST_URI must name a dedicated test database");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const itinerary = await Itinerary.create({ owner: new mongoose.Types.ObjectId(), trip: new mongoose.Types.ObjectId(), collaborationEnabled: true, title: "Revision concurrency", destination: "Test", startDate: new Date("2030-01-01"), endDate: new Date("2030-01-01"), plan: { days: [] }, source: "DETERMINISTIC_FALLBACK", revision: 1 });
    const [first, second] = await Promise.all([
      Itinerary.findOneAndUpdate({ _id: itinerary._id, revision: 1 }, { $inc: { revision: 1 } }, { new: true }),
      Itinerary.findOneAndUpdate({ _id: itinerary._id, revision: 1 }, { $inc: { revision: 1 } }, { new: true }),
    ]);
    assert.equal([first, second].filter(Boolean).length, 1);
    await Itinerary.deleteOne({ _id: itinerary._id });
  } finally {
    await mongoose.disconnect();
  }
});
