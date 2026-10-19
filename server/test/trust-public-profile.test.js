const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Trip = require("../src/models/Trip");
const TripMember = require("../src/models/TripMember");
const reviewReputation = require("../src/services/review-reputation.service");
const { getPublicProfile } = require("../src/services/trust.service");

test("public profiles exclude private travel preferences and account fields", async (context) => {
  const id = new mongoose.Types.ObjectId();
  context.mock.method(User, "findById", () => ({
    select(fields) {
      assert.doesNotMatch(fields, /(?:^|\s)(?:profile\.travelPreferences|email|phoneNumber|passwordHash)(?:\s|$)/);
      return Promise.resolve({
        _id: id,
        name: "Traveler",
        email: "private@example.test",
        phoneNumber: "+15555550123",
        passwordHash: "private-hash",
        profile: {
          bio: "Enjoys walking tours",
          city: "Pune",
          country: "India",
          travelPreferences: {
            availability: { startDate: new Date("2027-04-01"), endDate: new Date("2027-04-15") },
            budgetRange: { min: 1000, max: 2500, currency: "INR" },
            excludedDestinations: ["private destination"],
          },
        },
        verification: {},
        createdAt: new Date("2026-01-01"),
      });
    },
  }));
  context.mock.method(TripMember, "find", () => ({
    select() { return this; },
    lean: async () => [],
  }));
  context.mock.method(Trip, "find", () => ({
    select() { return this; },
    lean: async () => [],
  }));
  context.mock.method(reviewReputation, "getRatingSummary", async () => ({
    reviewCount: 0,
    averageRating: null,
  }));

  const profile = await getPublicProfile(id.toString());

  assert.deepEqual(profile.profile, {
    bio: "Enjoys walking tours",
    city: "Pune",
    country: "India",
  });
  for (const field of ["email", "phoneNumber", "passwordHash", "travelPreferences"]) {
    assert.equal(Object.hasOwn(profile, field), false);
    assert.equal(Object.hasOwn(profile.profile, field), false);
  }
});
