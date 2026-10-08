const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DIMENSION_WEIGHTS,
  CATEGORY_THRESHOLDS,
  calculateCompatibility,
  getCategory,
} = require("../src/ai/matching.engine");

const trip = {
  destination: { name: "Kyoto", city: "Kyoto", country: "Japan" },
  startDate: "2027-04-10T00:00:00.000Z",
  endDate: "2027-04-15T00:00:00.000Z",
  budget: { min: 1000, max: 1500, currency: "USD" },
  groupSize: { min: 3, max: 6 },
  currentMembers: 2,
  availableSlots: 4,
  interests: ["trekking", "camping", "photography"],
  travelStyle: ["adventure", "nature"],
  activities: ["hiking", "camping"],
  accommodationPreference: ["hostel"],
  transportPreference: ["train"],
  foodPreference: ["vegan"],
  languages: ["English"],
  travelPace: "MODERATE",
};

const user = {
  profile: {
    travelPreferences: {
      destinations: ["Kyoto"],
      availability: { startDate: "2027-04-10", endDate: "2027-04-20" },
      budgetRange: { min: 1000, max: 1400, currency: "USD" },
      groupSizeRange: { min: 3, max: 5 },
      interests: ["trekking", "camping", "photography"],
      travelStyle: "Adventure, nature",
      activities: ["hiking", "camping"],
      accommodationPreference: ["hostel"],
      transportPreference: ["train"],
      foodPreference: ["vegan"],
      languages: ["English"],
      travelPace: "MODERATE",
    },
  },
};

test("weights are configurable in one place and sum to 100", () => {
  assert.equal(Object.values(DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
});

test("complete compatible preferences produce a deterministic excellent score", () => {
  const first = calculateCompatibility(user, trip);
  const second = calculateCompatibility(user, trip);
  assert.deepEqual(first, second);
  assert.equal(first.overallScore, 100);
  assert.equal(first.category, "EXCELLENT");
  assert.deepEqual(first.unknownDimensions, []);
  assert.ok(first.reasons.includes("Same destination preference"));
});

test("missing preferences stay unknown and do not reduce the normalized score", () => {
  const result = calculateCompatibility({}, {
    destination: "Kyoto",
    interests: ["trekking"],
  });
  assert.equal(result.breakdown.destination, null);
  assert.equal(result.breakdown.dates, null);
  assert.ok(result.unknownDimensions.includes("destination"));
  assert.ok(result.unknownDimensions.includes("dates"));
  assert.equal(result.overallScore, 50);
  assert.equal(result.category, "LOW");
});

test("destination exclusions are mismatches while absent destination preferences are unknown", () => {
  const excluded = calculateCompatibility({
    profile: { travelPreferences: { excludedDestinations: ["Kyoto"] } },
  }, trip);
  assert.equal(excluded.breakdown.destination, 0);
  assert.equal(excluded.dimensionStatus.destination, "MISMATCH");
  assert.ok(excluded.reasons.includes("This destination is on your excluded destinations list"));
  assert.equal(calculateCompatibility({}, trip).dimensionStatus.destination, "UNKNOWN");
});

test("budget overlap uses range intersection and does not compare currencies", () => {
  assert.equal(calculateCompatibility(user, trip).breakdown.budget, 100);
  const mismatch = calculateCompatibility({
    profile: { travelPreferences: { budgetRange: { min: 50, max: 100, currency: "USD" } } },
  }, trip);
  assert.equal(mismatch.breakdown.budget, 0);
  const differentCurrency = calculateCompatibility({
    profile: { travelPreferences: { budgetRange: { min: 1000, max: 1500, currency: "INR" } } },
  }, trip);
  assert.equal(differentCurrency.breakdown.budget, null);
  assert.ok(differentCurrency.reasons.some((reason) => reason.includes("currencies differ")));
});

test("interests use normalized Jaccard similarity and empty sets stay unknown", () => {
  const result = calculateCompatibility({
    profile: { travelPreferences: { interests: ["Trekking", " CAMPING ", "photography", "food"] } },
  }, trip);
  assert.equal(result.breakdown.interests, 75);
  assert.ok(result.reasons.includes("3 shared interests: trekking, camping, photography"));
  assert.equal(calculateCompatibility({}, trip).breakdown.interests, null);
});

test("travel style and activity comparisons normalize case, whitespace, and separators", () => {
  const result = calculateCompatibility({
    profile: { travelPreferences: { travelStyle: "ADVENTURE, nature", activities: ["Hiking"] } },
  }, trip);
  assert.equal(result.breakdown.travelStyle, 100);
  assert.equal(result.breakdown.activities, 50);
});

test("date overlap scores partial availability and leaves missing availability unknown", () => {
  const partial = calculateCompatibility({
    profile: { travelPreferences: { availability: { startDate: "2027-04-12", endDate: "2027-04-14" } } },
  }, trip);
  assert.equal(partial.breakdown.dates, 40);
  assert.equal(partial.dimensionStatus.dates, "PARTIAL");
  assert.equal(calculateCompatibility({}, trip).breakdown.dates, null);
  assert.equal(calculateCompatibility({
    profile: { travelPreferences: { availability: { startDate: null, endDate: "2027-04-20" } } },
  }, trip).breakdown.dates, null);
  assert.equal(calculateCompatibility(user, { ...trip, startDate: null }).breakdown.dates, null);
});

test("group-size scoring accounts for current members and never recommends a full trip", () => {
  const matched = calculateCompatibility({
    profile: { travelPreferences: { groupSizeRange: { min: 4, max: 5 } } },
  }, trip);
  assert.equal(matched.breakdown.groupSize, 100);
  const full = calculateCompatibility(user, { ...trip, currentMembers: 6, availableSlots: 0 });
  assert.equal(full.breakdown.groupSize, 0);
  assert.ok(full.mismatchedAttributes.includes("available slots"));
  assert.ok(full.reasons.includes("This trip is full and is not recommended"));
});

test("food preferences distinguish vegan conflict and compatible vegetarian meals", () => {
  const conflict = calculateCompatibility(user, { ...trip, foodPreference: ["non-veg"] });
  assert.equal(conflict.preferenceBreakdown.foodPreference.score, 0);
  assert.ok(conflict.reasons.includes("Trip food preference conflicts with your vegan dietary preference"));
  const compatible = calculateCompatibility(user, { ...trip, foodPreference: ["vegetarian"] });
  assert.equal(compatible.preferenceBreakdown.foodPreference.score, 70);
});

test("travel pace rewards matches, scores adjacent paces, and lowers opposite paces", () => {
  const adjacent = calculateCompatibility({
    profile: { travelPreferences: { travelPace: "RELAXED" } },
  }, trip);
  const opposite = calculateCompatibility({
    profile: { travelPreferences: { travelPace: "FAST" } },
  }, { ...trip, travelPace: "RELAXED" });
  assert.equal(adjacent.preferenceBreakdown.travelPace.score, 70);
  assert.equal(opposite.preferenceBreakdown.travelPace.score, 25);
});

test("overall scores remain bounded and category thresholds are consistent", () => {
  for (const result of [
    calculateCompatibility(user, trip),
    calculateCompatibility({}, trip),
    calculateCompatibility({ profile: { travelPreferences: { interests: ["one"] } } }, { interests: ["two"] }),
  ]) {
    assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
    assert.equal(result.category, getCategory(result.overallScore));
  }
  assert.deepEqual(CATEGORY_THRESHOLDS.map(({ minimum }) => minimum), [90, 75, 60, 40, 0]);
  assert.deepEqual([95, 80, 65, 45, 10].map(getCategory), [
    "EXCELLENT", "GOOD", "MODERATE", "LOW", "POOR",
  ]);
});

test("accommodation, transport, language, food, and pace subdimensions are exposed independently", () => {
  const result = calculateCompatibility(user, trip);
  assert.deepEqual(result.preferenceBreakdown.accommodation, { score: 100, status: "MATCH" });
  assert.deepEqual(result.preferenceBreakdown.transport, { score: 100, status: "MATCH" });
  assert.deepEqual(result.preferenceBreakdown.foodPreference, { score: 100, status: "MATCH" });
  assert.deepEqual(result.preferenceBreakdown.languages, { score: 100, status: "MATCH" });
  assert.deepEqual(result.preferenceBreakdown.travelPace, { score: 100, status: "MATCH" });
});

test("reasons and matched/mismatched attributes are derived from evaluated inputs", () => {
  const result = calculateCompatibility({
    profile: { travelPreferences: { ...user.profile.travelPreferences, travelPace: "FAST" } },
  }, { ...trip, interests: ["food"], travelPace: "RELAXED" });
  assert.ok(result.matchedAttributes.includes("kyoto"));
  assert.ok(result.mismatchedAttributes.includes("trekking"));
  assert.ok(result.reasons.includes("No shared interests were found"));
  assert.ok(result.reasons.includes("Travel paces are very different"));
});
