const test = require("node:test");
const assert = require("node:assert/strict");

const configuredUri = process.env.MONGODB_TEST_URI;
test("booking ownership, handoff, idempotency, trip access, and cancellation", { skip: !configuredUri ? "Set MONGODB_TEST_URI to an isolated disposable test database" : false }, async (context) => {
  const parsedUri = new URL(configuredUri);
  const sourceDatabase = parsedUri.pathname.replace(/^\//, "").split("/")[0];
  assert.match(sourceDatabase, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
  parsedUri.pathname = `/${sourceDatabase}_phase17_booking_${process.pid}`;
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "booking-integration-test-secret-with-32-characters";

  const mongoose = require("mongoose");
  await mongoose.connect(parsedUri.toString(), { serverSelectionTimeoutMS: 3000 });
  const User = require("../src/models/User");
  const Booking = require("../src/models/Booking");
  const Trip = require("../src/models/Trip");
  const TripMember = require("../src/models/TripMember");
  const Itinerary = require("../src/models/Itinerary");
  const AuditLog = require("../src/models/AuditLog");
  const app = require("../app");
  const jwt = require("jsonwebtoken");
  await Promise.all([User, Booking, Trip, TripMember, Itinerary, AuditLog].map((model) => model.init()));
  const server = app.listen(0, "127.0.0.1");
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const createUser = async (email) => User.create({ name: "Booking Tester", email, passwordHash: "integration-placeholder" });
  const owner = await createUser("booking-owner@test.invalid");
  const member = await createUser("booking-member@test.invalid");
  const outsider = await createUser("booking-outsider@test.invalid");
  const tokenFor = (user) => jwt.sign({ v: 0 }, process.env.JWT_SECRET, { subject: user._id.toString(), issuer: "tripbuddy", audience: "tripbuddy-web", expiresIn: "1h" });
  const request = async (user, method, path, body, idempotencyKey) => {
    const headers = { cookie: `tripbuddy_session=${tokenFor(user)}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, payload: await response.json() };
  };

  await context.test("private records are idempotent, owner-only, auditable, and cancellable", async () => {
    const input = { serviceId: "accommodation-search", mode: "EXTERNAL_HANDOFF", serviceName: "Hotel search", destination: "Lisbon", startDate: "2027-05-01", endDate: "2027-05-03", travellers: 2 };
    const first = await request(owner, "POST", "/api/v1/bookings", input, "booking-request-0001");
    assert.equal(first.response.status, 201);
    assert.equal(first.payload.data.booking.status, "EXTERNAL_HANDOFF");
    assert.equal(new URL(first.payload.data.booking.externalUrl).hostname, "www.google.com");
    const duplicate = await request(owner, "POST", "/api/v1/bookings", input, "booking-request-0001");
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.payload.data.booking.id, first.payload.data.booking.id);
    const hidden = await request(outsider, "GET", `/api/v1/bookings/${first.payload.data.booking.id}`);
    assert.equal(hidden.response.status, 404);
    const cancelled = await request(owner, "POST", `/api/v1/bookings/${first.payload.data.booking.id}/cancel`);
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.payload.data.status, "CANCELLED");
    assert.match(cancelled.payload.data.statusHistory.at(-1).note, /Contact the external provider separately/);
    assert.equal(await AuditLog.countDocuments({ resourceType: "BOOKING", resourceId: first.payload.data.booking.id }), 2);
  });

  await context.test("association permits an active trip member but never shares private booking details", async () => {
    const trip = await Trip.create({ creator: owner._id, title: "Private booking trip", privacy: "PRIVATE", status: "PLANNING" });
    await TripMember.create({ trip: trip._id, user: member._id, role: "MEMBER", status: "ACTIVE", joinedAt: new Date() });
    const input = { serviceId: "activity-search", mode: "USER_RECORDED", serviceName: "Museum visit", destination: "Lisbon", startDate: "2027-05-01", endDate: "2027-05-01", travellers: 1, tripId: trip._id.toString(), travellerNote: "Private note" };
    const recorded = await request(member, "POST", "/api/v1/bookings", input, "booking-request-0002");
    assert.equal(recorded.response.status, 201);
    const hidden = await request(owner, "GET", `/api/v1/bookings/${recorded.payload.data.booking.id}`);
    assert.equal(hidden.response.status, 404);
    const denied = await request(outsider, "POST", "/api/v1/bookings", input, "booking-request-0003");
    assert.equal(denied.response.status, 404);
    const listing = await request(member, "GET", "/api/v1/bookings?page=1&limit=20");
    assert.equal(listing.payload.data.items.length, 1);
    assert.equal(listing.payload.data.items[0].travellerNote, "Private note");
  });
});
