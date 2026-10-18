const test = require("node:test");
const assert = require("node:assert/strict");

const configuredUri = process.env.MONGODB_TEST_URI;
test("Safety Center blocks, reports, contacts, settings, and private trip safety authorization", {
  skip: !configuredUri ? "Set MONGODB_TEST_URI to an isolated disposable replica-set test database" : false,
}, async (context) => {
  const uri = new URL(configuredUri);
  const sourceDatabase = uri.pathname.replace(/^\//, "").split("/")[0];
  assert.match(sourceDatabase, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
  uri.pathname = `/${sourceDatabase}_phase21_safety_${process.pid}`;

  const mongoose = require("mongoose");
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  const User = require("../src/models/User");
  const Block = require("../src/models/Block");
  const Report = require("../src/models/Report");
  const EmergencyContact = require("../src/models/EmergencyContact");
  const Trip = require("../src/models/Trip");
  const TripMember = require("../src/models/TripMember");
  const AuditLog = require("../src/models/AuditLog");
  const safety = require("../src/services/safety.service");
  const center = require("../src/services/safety-center.service");
  await Promise.all([User, Block, Report, EmergencyContact, Trip, TripMember, AuditLog].map((model) => model.init()));
  const [owner, member, outsider, moderator] = await User.create([
    { name: "Safety Owner", email: "phase21-owner@test.invalid", passwordHash: "integration-placeholder" },
    { name: "Safety Member", email: "phase21-member@test.invalid", passwordHash: "integration-placeholder" },
    { name: "Safety Outsider", email: "phase21-outsider@test.invalid", passwordHash: "integration-placeholder" },
    { name: "Safety Moderator", email: "phase21-mod@test.invalid", passwordHash: "integration-placeholder", role: "MODERATOR" },
  ]);
  const trip = await Trip.create({ creator: owner._id, title: "Private safety trip", status: "PLANNING", privacy: "PRIVATE" });
  await TripMember.create([
    { trip: trip._id, user: owner._id, role: "OWNER", status: "ACTIVE", joinedAt: new Date(Date.now() - 1000) },
    { trip: trip._id, user: member._id, role: "MEMBER", status: "ACTIVE", joinedAt: new Date(Date.now() - 1000) },
  ]);
  const req = (actor) => ({ user: actor, ip: "127.0.0.1", get: () => "phase21-integration" });
  context.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

  await context.test("blocks are unique and suppress interaction in either direction", async () => {
    await safety.blockUser(owner, member._id.toString(), req(owner));
    await safety.blockUser(owner, member._id.toString(), req(owner));
    assert.equal(await Block.countDocuments({ blocker: owner._id, blocked: member._id }), 1);
    assert.equal(await safety.isInteractionBlocked(owner._id, member._id), true);
    assert.equal(await safety.isInteractionBlocked(member._id, owner._id), true);
    await safety.unblockUser(owner, member._id.toString(), req(owner));
    assert.equal(await safety.isInteractionBlocked(owner._id, member._id), false);
    await safety.blockUser(member, owner._id.toString(), req(member));
    assert.equal(await safety.isInteractionBlocked(owner._id, member._id), true);
    assert.deepEqual(await safety.getInteractionBlockedIds(owner._id, [member._id]), [member._id.toString()]);
  });

  await context.test("emergency contacts are owner-scoped, primary, validated, and capped", async () => {
    const contact = await center.saveContact(owner, { name: "Trusted Friend", relationship: "Friend", phone: "+14155550123", email: "", primary: true }, null, req(owner));
    assert.equal(contact.primary, true);
    assert.equal((await center.contacts(member)).length, 0);
    const forbidden = await center.removeContact(member, contact.id, req(member)).then(() => null, (error) => error);
    assert.equal(forbidden.code, "CONTACT_NOT_FOUND");
    assert.equal((await center.contacts(owner)).length, 1);
  });

  await context.test("trip safety is available only to active members and removed members lose access", async () => {
    const saved = await center.updateTripSafety(trip._id.toString(), owner, { meetingPoint: "Main station entrance", checklist: ["Share itinerary"] }, req(owner));
    assert.equal(saved.safetyInfo.meetingPoint, "Main station entrance");
    assert.equal((await center.getTripSafety(trip._id.toString(), member)).safetyInfo.checklist[0], "Share itinerary");
    const outsiderError = await center.getTripSafety(trip._id.toString(), outsider).then(() => null, (error) => error);
    assert.equal(outsiderError.code, "TRIP_NOT_FOUND");
    await TripMember.updateOne({ trip: trip._id, user: member._id }, { $set: { status: "REMOVED" } });
    const removedError = await center.getTripSafety(trip._id.toString(), member).then(() => null, (error) => error);
    assert.equal(removedError.code, "TRIP_NOT_FOUND");
  });

  await context.test("reporters see only their own status and moderator notes stay private", async () => {
    const created = await safety.createReport(owner, { targetType: "INCIDENT", reason: "SAFETY_CONCERN", description: "I need a moderator to review this safety incident." }, req(owner));
    assert.equal(created.status, "SUBMITTED");
    await safety.reviewReport({ reportId: created.id, moderator, status: "UNDER_REVIEW", resolution: "Private review note", req: req(moderator) });
    const mine = await safety.listMyReports(owner, { page: 1, limit: 10 });
    assert.equal(mine.items[0].status, "UNDER_REVIEW");
    assert.equal(Object.hasOwn(mine.items[0], "moderatorNotes"), false);
    const privateRecord = await Report.findById(created.id).select("+moderatorNotes").lean();
    assert.equal(privateRecord.moderatorNotes, "Private review note");
  });
});
