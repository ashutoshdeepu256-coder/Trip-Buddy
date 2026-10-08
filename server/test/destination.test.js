const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Destination = require("../src/models/Destination");
const cache = require("../src/services/destination-cache.service");
const destinationService = require("../src/services/destination.service");
const {
  listingQuerySchema,
  nearbyQuerySchema,
} = require("../src/validators/destination");

test("destination model defines a 2dsphere index and validates GeoJSON coordinates", async () => {
  assert.ok(
    Destination.schema
      .indexes()
      .some(([fields]) => fields.coordinates === "2dsphere"),
  );
  const valid = new Destination({
    name: "Sample place",
    slug: "sample-place",
    country: "Example",
    description: "A destination record used only for model validation tests.",
    coordinates: { type: "Point", coordinates: [120, 45] },
  });
  await valid.validate();

  const invalid = new Destination({
    name: "Invalid place",
    slug: "invalid-place",
    country: "Example",
    description: "Invalid coordinate range.",
    coordinates: { type: "Point", coordinates: [181, 45] },
  });
  await assert.rejects(invalid.validate(), (error) =>
    Boolean(error.errors["coordinates.coordinates"]),
  );
});

test("destination query schemas constrain pagination, months, budgets, and nearby coordinates", () => {
  assert.equal(
    listingQuerySchema.safeParse({
      page: "2",
      limit: "20",
      month: "6",
      maxBudget: "100",
    }).success,
    true,
  );
  assert.equal(listingQuerySchema.safeParse({ page: "0" }).success, false);
  assert.equal(listingQuerySchema.safeParse({ month: "13" }).success, false);
  assert.equal(
    nearbyQuerySchema.safeParse({ lat: "91", lng: "0" }).success,
    false,
  );
  assert.equal(
    nearbyQuerySchema.safeParse({ lat: "45", lng: "-120" }).success,
    true,
  );
});

test("search filters escape regular expression input and expose seasonal, budget, and category filters", () => {
  const filters = destinationService.buildFilters({
    search: "Paris.*",
    month: 5,
    maxBudget: 250,
    activity: "hiking",
    category: "ADVENTURE",
  });
  assert.equal(filters.published, true);
  assert.equal(filters.bestMonths, 5);
  assert.deepEqual(filters["estimatedBudget.min"], { $lte: 250 });
  assert.equal(filters.adventure, true);
  assert.equal(filters.$or[0].name.test("Paris.*"), true);
  assert.equal(filters.$or[0].name.test("Paris abc"), false);
  assert.deepEqual(
    destinationService.buildFilters({ hasBudget: true })["estimatedBudget.min"],
    {
      $type: "number",
    },
  );
});

test("destination result cache expires entries and returns isolated copies", () => {
  cache.clear();
  const value = { nested: { label: "original" } };
  cache.set("destination:test", value, 100, 1000);
  const cached = cache.get("destination:test", 1050);
  cached.nested.label = "changed";
  assert.equal(cache.get("destination:test", 1050).nested.label, "original");
  assert.equal(cache.get("destination:test", 1100), undefined);
  cache.clear();
});

test("destination listings are paginated and use cached read results", async (context) => {
  cache.clear();
  const id = new mongoose.Types.ObjectId();
  const items = [
    {
      _id: id,
      name: "Example",
      slug: "example",
      images: [{ url: "https://images.example.test/hero.jpg", alt: "Example" }],
      communityStatistics: { tripsCount: 2, buddiesCount: 1 },
    },
  ];
  const query = {
    sort(sortValue) {
      this.sortValue = sortValue;
      return this;
    },
    skip(skipValue) {
      this.skipValue = skipValue;
      return this;
    },
    limit(limitValue) {
      this.limitValue = limitValue;
      return this;
    },
    lean: async () => items,
  };
  const find = context.mock.method(Destination, "find", () => query);
  const count = context.mock.method(
    Destination,
    "countDocuments",
    async () => 13,
  );
  const result = await destinationService.listDestinations({
    search: "Example",
    page: 2,
    limit: 5,
  });
  assert.equal(find.mock.callCount(), 1);
  assert.equal(count.mock.callCount(), 1);
  assert.equal(query.skipValue, 5);
  assert.equal(query.limitValue, 5);
  assert.equal(result.pagination.pages, 3);
  assert.equal(result.items[0].id, id.toString());
  assert.deepEqual(result.items[0].heroImage, items[0].images[0]);
  assert.deepEqual(result.items[0].communityTrips, []);
  await destinationService.listDestinations({
    search: "Example",
    page: 2,
    limit: 5,
  });
  assert.equal(find.mock.callCount(), 1);
  cache.clear();
});

test("nearby destinations use longitude-latitude order and a bounded search radius", async (context) => {
  cache.clear();
  let filter;
  const query = {
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [],
  };
  context.mock.method(Destination, "find", (value) => {
    filter = value;
    return query;
  });
  context.mock.method(Destination, "countDocuments", async () => 0);
  const result = await destinationService.listNearby({
    lat: 37,
    lng: -122,
    radiusKm: 10,
    page: 1,
    limit: 12,
  });
  assert.deepEqual(filter.coordinates.$near.$geometry.coordinates, [-122, 37]);
  assert.equal(filter.coordinates.$near.$maxDistance, 10000);
  assert.equal(result.pagination.total, 0);
  cache.clear();
});

test("destination details reject absent unpublished slugs", async (context) => {
  cache.clear();
  context.mock.method(Destination, "findOne", () => ({
    lean: async () => null,
  }));
  await assert.rejects(
    destinationService.getDestination("not-published"),
    (error) =>
      error.code === "DESTINATION_NOT_FOUND" && error.statusCode === 404,
  );
  cache.clear();
});
