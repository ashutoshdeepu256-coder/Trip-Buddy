const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Trip = require("../src/models/Trip");
const TripMember = require("../src/models/TripMember");
const GroupRecommendation = require("../src/models/GroupRecommendation");
const groupFormation = require("../src/services/groupFormation.service");

const mongoUri = process.env.MONGODB_TEST_URI;

test("Mongo-backed group recommendation generation and multi-party consent workflow", {
  skip: !mongoUri ? "Set MONGODB_TEST_URI to an isolated disposable test database" : false,
}, async () => {
  const databaseName = `tripbuddy_group_phase11_${process.pid}_${Date.now()}`;
  await mongoose.connect(mongoUri, { dbName: databaseName });
  try {
    await Promise.all([User.init(), Trip.init(), TripMember.init(), GroupRecommendation.init()]);
    const owner = await User.create({
      name: "Phase Eleven Owner",
      email: `owner-${databaseName}@example.test`,
      passwordHash: "test-only-hash",
      accountStatus: "ACTIVE",
    });
    const candidate = await User.create({
      name: "Phase Eleven Traveller",
      email: `traveller-${databaseName}@example.test`,
      passwordHash: "test-only-hash",
      accountStatus: "ACTIVE",
      profile: { travelPreferences: { interests: ["hiking"] } },
    });
    const trip = await Trip.create({
      creator: owner._id,
      title: "Group formation integration",
      status: "PUBLISHED",
      privacy: "PUBLIC",
      groupSize: { min: 1, max: 3 },
      interests: ["hiking"],
    });
    await TripMember.create({ trip: trip._id, user: owner._id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() });

    const req = { user: owner, ip: "127.0.0.1", get: () => null };
    const generated = await groupFormation.generateGroupRecommendation(trip._id.toString(), owner, req);
    assert.ok(generated.recommendation);
    assert.equal(generated.recommendation.status, "PROPOSED");
    assert.equal(generated.recommendation.proposedTravellerCount, 1);

    const accepted = await groupFormation.acceptGroupRecommendation(
      generated.recommendation.id,
      candidate,
      { user: candidate, ip: "127.0.0.1", get: () => null },
    );
    assert.equal(accepted.status, "ACCEPTED");
    assert.equal(await TripMember.countDocuments({ trip: trip._id, status: "ACTIVE" }), 1);
    assert.equal(await GroupRecommendation.countDocuments({ trip: trip._id, status: "ACCEPTED" }), 1);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
