const test = require("node:test");
const assert = require("node:assert/strict");

const configuredUri = process.env.MONGODB_TEST_URI;
test("MongoDB geospatial indexes and nearby queries", { skip: !configuredUri ? "MONGODB_TEST_URI is not configured" : false }, async (context) => {
  const source = new URL(configuredUri);
  const base = source.pathname.replace(/^\//, "");
  assert.match(base, /test/i, "MONGODB_TEST_URI must point to a dedicated test database");
  source.pathname = `/${base}_phase16_geo_test`;
  process.env.NODE_ENV = "test";
  const mongoose = require("mongoose");
  const Destination = require("../src/models/Destination");
  const Trip = require("../src/models/Trip");
  await mongoose.connect(source.toString(), { serverSelectionTimeoutMS: 3000 });
  await Promise.all([Destination.init(), Trip.init()]);
  context.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  const destination = await Destination.create({ name: "Geo Test", slug: `geo-test-${Date.now()}`, country: "Testland", description: "A test destination", coordinates: { type: "Point", coordinates: [-73.9, 40.7] }, published: true });
  const nearby = await Destination.find({ published: true, coordinates: { $near: { $geometry: { type: "Point", coordinates: [-73.91, 40.7] }, $maxDistance: 5000 } } }).select("_id").lean();
  assert.ok(nearby.some((item) => item._id.equals(destination._id)));
  const creator = new mongoose.Types.ObjectId();
  await Trip.create({ creator, title: "Public geo trip", status: "PUBLISHED", privacy: "PUBLIC", groupSize: { min: 1, max: 4 }, location: { type: "Point", coordinates: [-73.9, 40.7] } });
  await Trip.create({ creator: new mongoose.Types.ObjectId(), title: "Private geo trip", status: "PUBLISHED", privacy: "PRIVATE", groupSize: { min: 1, max: 4 }, location: { type: "Point", coordinates: [-73.9, 40.7] } });
  const publicTrips = await Trip.aggregate([{ $geoNear: { near: { type: "Point", coordinates: [-73.91, 40.7] }, distanceField: "distanceMeters", maxDistance: 5000, spherical: true, key: "location", query: { status: { $in: ["PUBLISHED", "PLANNING", "CONFIRMED"] }, privacy: "PUBLIC" } } }]);
  assert.equal(publicTrips.length, 1);
  assert.equal(publicTrips[0].title, "Public geo trip");
  assert.ok(publicTrips[0].distanceMeters > 0);
});
