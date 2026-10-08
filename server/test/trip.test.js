const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Destination = require("../src/models/Destination");
const Trip = require("../src/models/Trip");
const TripMember = require("../src/models/TripMember");
const tripService = require("../src/services/trip.service");
const tripImages = require("../src/services/trip-image.service");
const {
  createTripSchema,
  updateTripSchema,
  updateTripSchema,
  publishTripSchema,
  statusChangeSchema,
  listMyTripsQuerySchema,
} = require("../src/validators/trip.validator");

const ownerId = new mongoose.Types.ObjectId();
const anotherUserId = new mongoose.Types.ObjectId();
const destinationId = new mongoose.Types.ObjectId();
const validTripInput = () => {
  const startDate = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  const endDate = new Date(startDate.getTime() + 5 * 24 * 60 * 60 * 1000);
  return {
    destination: destinationId.toString(),
    title: "A real planned journey",
    description: "A detailed trip description that is long enough to publish.",
    startDate,
    endDate,
    budget: { min: 500, max: 1200, currency: "usd" },
    groupSize: { min: 1, max: 4 },
    travelStyle: [" Slow travel ", "slow travel"],
    interests: ["food", "markets"],
    activities: ["walking"],
    accommodationPreference: ["hotel"],
    transportPreference: ["train"],
    foodPreference: ["vegetarian"],
    privacy: "PUBLIC",
  };
};

test("trip model links users and destinations and indexes discovery/matching queries", () => {
  assert.equal(Trip.schema.path("creator").options.ref, "User");
  assert.equal(Trip.schema.path("destination").options.ref, "Destination");
  const indexes = Trip.schema.indexes().map(([fields]) => fields);
  assert.ok(indexes.some((fields) => fields.creator === 1 && fields.createdAt === -1));
  assert.ok(indexes.some((fields) => fields.destination === 1 && fields.status === 1 && fields.startDate === 1));
  assert.ok(indexes.some((fields) => fields.status === 1 && fields.privacy === 1 && fields.startDate === 1));
  assert.ok(indexes.some((fields) => fields.location === "2dsphere"));
  assert.ok(TripMember.schema.indexes().some(([fields, options]) => fields.trip === 1 && fields.user === 1 && options.unique));
});

test("draft validation permits incomplete fields but strips client-controlled lifecycle status", () => {
  const draft = createTripSchema.parse({ title: "Draft", status: "PUBLISHED" });
  assert.equal(draft.title, "Draft");
  assert.equal("status" in draft, false);
  assert.equal(draft.destination, undefined);
});

test("trip validation rejects bad destination ids, date order, budget, group size, enums, and past publish dates", () => {
  const valid = validTripInput();
  assert.equal(createTripSchema.safeParse(valid).success, true);
  assert.equal(createTripSchema.safeParse({ destination: "not-an-id" }).success, false);
  assert.equal(createTripSchema.safeParse({ ...valid, endDate: valid.startDate }).success, false);
  assert.equal(createTripSchema.safeParse({ ...valid, budget: { min: 100, max: 99, currency: "USD" } }).success, false);
  assert.equal(createTripSchema.safeParse({ ...valid, groupSize: { min: 5, max: 4 } }).success, false);
  assert.equal(createTripSchema.safeParse({ ...valid, privacy: "WORLD" }).success, false);
  assert.equal(updateTripSchema.safeParse({ title: "Updated title", status: "CANCELLED" }).success, true);
  assert.equal("status" in updateTripSchema.parse({ title: "Updated title", status: "CANCELLED" }), false);
  assert.equal(statusChangeSchema.safeParse({ status: "DRAFT" }).success, true);
  assert.equal(statusChangeSchema.safeParse({ status: "PUBLISHED", role: "ADMIN" }).success, true);
  const pastStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
  assert.equal(publishTripSchema.safeParse({
    ...valid,
    startDate: pastStart,
    endDate: pastEnd,
    budget: { min: 10, max: 20, currency: "USD" },
  }).success, false);
});

test("trip preferences are trimmed and deduplicated case-insensitively", () => {
  const result = createTripSchema.parse({
    interests: ["Food", "food", "  Food tours  "],
    activities: [" hiking ", "hiking"],
  });
  assert.deepEqual(result.interests, ["food", "Food tours"]);
  assert.deepEqual(result.activities, ["hiking"]);
});

test("my-trip pagination validates bounded page and limit values", () => {
  assert.deepEqual(listMyTripsQuerySchema.parse({ page: "2", limit: "25", status: "DRAFT" }), {
    page: 2,
    limit: 25,
    status: "DRAFT",
  });
  assert.equal(listMyTripsQuerySchema.safeParse({ page: "0" }).success, false);
  assert.equal(listMyTripsQuerySchema.safeParse({ limit: "51" }).success, false);
});

test("image inspection requires matching JPEG, PNG, and WEBP signatures", () => {
  assert.equal(tripImages.detectFormat({
    mimetype: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]),
  }), "jpg");
  assert.equal(tripImages.detectFormat({
    mimetype: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  }), "png");
  const webp = Buffer.alloc(12);
  webp.write("RIFF", 0);
  webp.write("WEBP", 8);
  assert.equal(tripImages.detectFormat({ mimetype: "image/webp", buffer: webp }), "webp");
  assert.equal(tripImages.detectFormat({ mimetype: "image/png", buffer: Buffer.from("not a png") }), null);
});

test("trip creation validates destination and creates an owner membership", async (context) => {
  const id = new mongoose.Types.ObjectId();
  const destinationFind = context.mock.method(Destination, "findOne", () => ({
    select: async () => ({ _id: destinationId }),
  }));
  let savedTrip;
  context.mock.method(Trip, "create", async (values) => {
    savedTrip = { _id: id, ...values };
    return savedTrip;
  });
  let savedMember;
  context.mock.method(TripMember, "create", async (values) => { savedMember = values; });

  const result = await tripService.createTrip(
    { _id: ownerId },
    createTripSchema.parse({ ...validTripInput(), status: "PUBLISHED" }),
  );
  assert.equal(destinationFind.mock.callCount(), 1);
  assert.equal(savedTrip.status, "DRAFT");
  assert.equal(result.status, "DRAFT");
  assert.equal(savedMember.role, "OWNER");
  assert.equal(savedMember.status, "ACTIVE");
  assert.equal(savedMember.user.toString(), ownerId.toString());
});

test("trip creation rejects a destination that is missing or unpublished", async (context) => {
  context.mock.method(Destination, "findOne", () => ({ select: async () => null }));
  await assert.rejects(
    tripService.createTrip({ _id: ownerId }, createTripSchema.parse(validTripInput())),
    (error) => error.statusCode === 404 && error.code === "DESTINATION_NOT_FOUND",
  );
});

test("non-owners cannot edit, delete, or publish another user's trip", async (context) => {
  const id = new mongoose.Types.ObjectId();
  const trip = {
    _id: id,
    creator: ownerId,
    status: "DRAFT",
    images: [],
    save: async () => {},
  };
  context.mock.method(Trip, "findById", () => ({
    populate() { return this; },
    then(resolve) { resolve(trip); },
  }));
  const forbidden = (error) => error.statusCode === 403 && error.code === "TRIP_ACCESS_DENIED";
  await assert.rejects(tripService.updateTrip(id.toString(), { _id: anotherUserId }, { title: "No" }), forbidden);
  await assert.rejects(tripService.deleteTrip(id.toString(), { _id: anotherUserId }), forbidden);
  await assert.rejects(tripService.publishTrip(id.toString(), { _id: anotherUserId }), forbidden);
});

test("publishing an incomplete draft is rejected before changing its state", async (context) => {
  const trip = {
    _id: new mongoose.Types.ObjectId(),
    creator: ownerId,
    status: "DRAFT",
    title: "",
    description: "",
    destination: null,
    budget: { min: null, max: null, currency: "USD" },
    groupSize: { min: 1, max: 1 },
    startDate: null,
    endDate: null,
    privacy: "PUBLIC",
  };
  context.mock.method(Trip, "findById", async () => trip);
  await assert.rejects(
    tripService.publishTrip(trip._id.toString(), { _id: ownerId }),
    (error) => error.statusCode === 400 && error.code === "TRIP_VALIDATION_ERROR",
  );
  assert.equal(trip.status, "DRAFT");
});

test("private and invite-only trip access is concealed from non-members", async (context) => {
  const id = new mongoose.Types.ObjectId();
  const trip = {
    _id: id,
    creator: ownerId,
    destination: null,
    status: "PUBLISHED",
    privacy: "PRIVATE",
    images: [],
    toObject() {
      return this;
    },
  };
  context.mock.method(Trip, "findById", () => ({
    populate() { return this; },
    then(resolve) { resolve(trip); },
  }));
  context.mock.method(TripMember, "exists", async () => null);
  await assert.rejects(
    tripService.getAccessibleTrip(id.toString(), { _id: anotherUserId }),
    (error) => error.statusCode === 404 && error.code === "TRIP_NOT_FOUND",
  );
});

test("trip serialization does not expose Cloudinary public IDs", () => {
  const serialized = tripService.serializeTrip({
    _id: new mongoose.Types.ObjectId(),
    creator: ownerId,
    destination: destinationId,
    images: [{ url: "https://images.example.test/trip.jpg", publicId: "private/provider/id", format: "jpg" }],
    status: "DRAFT",
    privacy: "PRIVATE",
  });
  assert.equal(serialized.images[0].url, "https://images.example.test/trip.jpg");
  assert.equal("publicId" in serialized.images[0], false);
});
