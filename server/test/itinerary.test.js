const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Itinerary = require("../src/models/Itinerary");
const itineraryService = require("../src/services/itinerary.service");
const { generateSchema, updateSchema, planSchema } = require("../src/validators/itinerary.validator");

test("itinerary model indexes owner pagination and linked-trip ownership", () => {
  const indexes = Itinerary.schema.indexes();
  assert.ok(indexes.some(([fields]) => fields.owner === 1 && fields.archivedAt === 1 && fields.updatedAt === -1));
  assert.ok(indexes.some(([fields]) => fields.trip === 1 && fields.owner === 1));
  assert.equal(Itinerary.schema.path("owner").options.ref, "User");
  assert.equal(Itinerary.schema.path("trip").options.ref, "Trip");
});

test("itinerary input validation bounds trip span, notes, costs, and client-controlled fields", () => {
  const input = { destination: "Lisbon", startDate: "2027-05-01", endDate: "2027-05-03" };
  assert.equal(generateSchema.safeParse(input).success, true);
  assert.equal(generateSchema.safeParse({ ...input, endDate: "2027-06-15" }).success, false);
  assert.equal(generateSchema.safeParse({ ...input, owner: new mongoose.Types.ObjectId().toString() }).success, false);
  assert.equal(updateSchema.safeParse({ source: "GEMINI" }).success, false);
  assert.equal(updateSchema.safeParse({ title: "A changed title" }).success, true);
});

test("fallback plan is valid structured output with unknown costs and no live fact claims", () => {
  const plan = itineraryService.fallbackPlan({
    destination: "Lisbon", startDate: "2027-05-01", endDate: "2027-05-02",
    budget: { amount: 1000, currency: "EUR" }, preferences: { pace: "RELAXED", interests: [] },
  });
  assert.equal(planSchema.safeParse(plan).success, true);
  assert.equal(plan.days.length, 2);
  assert.equal(plan.days[0].morning.activities[0].estimatedCost.amount, null);
  assert.match(plan.unknowns.join(" "), /not verified/i);
});

test("an ineligible account cannot generate a saved plan", async () => {
  await assert.rejects(
    itineraryService.generate({ user: { _id: new mongoose.Types.ObjectId(), accountStatus: "SUSPENDED" } }, {}),
    { code: "ACCOUNT_INELIGIBLE", statusCode: 403 },
  );
});

test("a linked trip must belong to the plan owner", async (context) => {
  const actorId = new mongoose.Types.ObjectId();
  const tripId = new mongoose.Types.ObjectId();
  const query = { select() { return this; }, lean: async () => null };
  context.mock.method(require("../src/models/Trip"), "findOne", () => query);
  await assert.rejects(itineraryService.generate({ user: { _id: actorId, accountStatus: "ACTIVE" } }, { tripId: tripId.toString() }), { code: "TRIP_NOT_FOUND", statusCode: 404 });
});
