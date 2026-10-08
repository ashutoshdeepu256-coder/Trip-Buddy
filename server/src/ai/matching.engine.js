const DIMENSION_WEIGHTS = Object.freeze({
  destination: 25,
  dates: 20,
  budget: 15,
  interests: 15,
  travelStyle: 10,
  activities: 5,
  groupSize: 5,
  otherPreferences: 5,
});

const CATEGORY_THRESHOLDS = Object.freeze([
  { minimum: 90, category: "EXCELLENT" },
  { minimum: 75, category: "GOOD" },
  { minimum: 60, category: "MODERATE" },
  { minimum: 40, category: "LOW" },
  { minimum: 0, category: "POOR" },
]);

const PACE_SCORES = Object.freeze({
  RELAXED: Object.freeze({ RELAXED: 100, MODERATE: 70, FAST: 25 }),
  MODERATE: Object.freeze({ RELAXED: 70, MODERATE: 100, FAST: 70 }),
  FAST: Object.freeze({ RELAXED: 25, MODERATE: 70, FAST: 100 }),
});

const normalizeValue = (value) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
    : "";

const normalizeSet = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : [values])
      .flatMap((value) => typeof value === "string" ? value.split(",") : [value])
      .map(normalizeValue)
      .filter(Boolean),
  ),
];

const safeNumber = (value) =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? null
    : Number(value);

const roundScore = (score) => Math.max(0, Math.min(100, Math.round(score)));

const statusForScore = (score) => {
  if (score >= 80) return "MATCH";
  if (score > 0) return "PARTIAL";
  return "MISMATCH";
};

const unknownDimension = (name) => ({
  name,
  score: null,
  status: "UNKNOWN",
  matchedAttributes: [],
  mismatchedAttributes: [],
  reasons: [],
  potentialDifferences: [],
});

const makeDimension = (
  name,
  score,
  matchedAttributes = [],
  mismatchedAttributes = [],
  reasons = [],
  potentialDifferences = [],
) => ({
  name,
  score: roundScore(score),
  status: statusForScore(score),
  matchedAttributes,
  mismatchedAttributes,
  reasons,
  potentialDifferences,
});

const getTravelPreferences = (user) => user?.profile?.travelPreferences || user?.travelPreferences || {};

const getDestinationParts = (destination) => {
  if (typeof destination === "string") return normalizeSet([destination]);
  if (!destination || typeof destination !== "object") return [];
  return normalizeSet([destination.name, destination.slug, destination.city, destination.state, destination.country]);
};

const scoreDestination = (trip, preferences) => {
  const destinationParts = getDestinationParts(trip?.destination);
  if (!destinationParts.length) return unknownDimension("destination");

  const excluded = normalizeSet(preferences.excludedDestinations);
  const excludedMatch = destinationParts.find((part) => excluded.includes(part));
  if (excludedMatch) {
    return makeDimension(
      "destination",
      0,
      [],
      [excludedMatch],
      ["This destination is on your excluded destinations list"],
      ["This destination is on your excluded destinations list"],
    );
  }

  const preferred = normalizeSet(preferences.destinations || preferences.preferredDestinations);
  if (!preferred.length) return unknownDimension("destination");

  const exactMatch = destinationParts.find((part) => preferred.includes(part));
  if (exactMatch) {
    return makeDimension("destination", 100, [exactMatch], [], ["Same destination preference"]);
  }

  const compatible = destinationParts.find((part) =>
    preferred.some((preference) => part.includes(preference) || preference.includes(part)),
  );
  if (compatible) {
    return makeDimension("destination", 75, [compatible], [], ["Destination is related to a listed preference"]);
  }

  return unknownDimension("destination");
};

const scoreDates = (trip, preferences) => {
  if (trip?.startDate == null || trip?.endDate == null) return unknownDimension("dates");
  const start = new Date(trip?.startDate).getTime();
  const end = new Date(trip?.endDate).getTime();
  const availability = preferences.availability;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !availability) {
    return unknownDimension("dates");
  }

  const windows = Array.isArray(availability) ? availability : [availability];
  const flexibilityDays = Math.min(Math.max(safeNumber(preferences.dateFlexibilityDays) || 0, 0), 31);
  const flexMs = flexibilityDays * 24 * 60 * 60 * 1000;
  let maximumOverlap = 0;
  let hasValidWindow = false;
  const tripDuration = end - start;

  for (const window of windows) {
    if (window?.startDate == null || window?.endDate == null) continue;
    const windowStart = new Date(window?.startDate).getTime();
    const windowEnd = new Date(window?.endDate).getTime();
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd < windowStart) continue;
    hasValidWindow = true;
    const overlap = Math.max(0, Math.min(end, windowEnd + flexMs) - Math.max(start, windowStart - flexMs));
    maximumOverlap = Math.max(maximumOverlap, Math.min(overlap / tripDuration, 1));
  }
  if (!hasValidWindow) return unknownDimension("dates");
  if (maximumOverlap === 0) {
    return makeDimension(
      "dates",
      0,
      [],
      ["travel dates"],
      ["Trip dates do not overlap your stated availability"],
      ["Trip dates do not overlap your stated availability"],
    );
  }
  if (maximumOverlap >= 1) {
    return makeDimension("dates", 100, ["travel dates"], [], ["Trip dates fit your stated availability"]);
  }
  const score = roundScore(maximumOverlap * 100);
  return makeDimension("dates", score, ["travel dates"], [], ["Part of the trip overlaps your stated availability"]);
};

const getBudgetRange = (range) => {
  const minimum = safeNumber(range?.min);
  const maximum = safeNumber(range?.max);
  if (minimum === null || maximum === null || minimum < 0 || maximum < minimum) return null;
  return { minimum, maximum, currency: normalizeValue(range?.currency).toUpperCase() };
};

const scoreBudget = (trip, preferences) => {
  const tripRange = getBudgetRange(trip?.budget);
  const userRange = getBudgetRange(preferences.budgetRange);
  if (!tripRange || !userRange || !tripRange.currency || !userRange.currency) return unknownDimension("budget");
  if (tripRange.currency !== userRange.currency) {
    return {
      ...unknownDimension("budget"),
      reasons: ["Budget currencies differ; no exchange-rate conversion is configured"],
    };
  }

  const intersection = Math.max(
    0,
    Math.min(tripRange.maximum, userRange.maximum) - Math.max(tripRange.minimum, userRange.minimum),
  );
  if (tripRange.maximum < userRange.minimum || userRange.maximum < tripRange.minimum) {
    return makeDimension(
      "budget",
      0,
      [],
      [`${tripRange.currency} budget ranges`],
      ["Trip budget does not overlap your preferred budget range"],
      ["Trip budget does not overlap your preferred budget range"],
    );
  }

  const narrowerWidth = Math.min(
    tripRange.maximum - tripRange.minimum,
    userRange.maximum - userRange.minimum,
  );
  const score = narrowerWidth === 0 ? 100 : (intersection / narrowerWidth) * 100;
  return makeDimension(
    "budget",
    score,
    [`${tripRange.currency} budget ranges`],
    [],
    [score === 100 ? "Budget ranges overlap significantly" : "Budget ranges overlap partially"],
  );
};

const scoreSets = (name, userValues, tripValues, label) => {
  const userSet = normalizeSet(userValues);
  const tripSet = normalizeSet(tripValues);
  if (!userSet.length || !tripSet.length) return unknownDimension(name);
  const shared = userSet.filter((value) => tripSet.includes(value));
  const unionSize = new Set([...userSet, ...tripSet]).size;
  const score = unionSize ? (shared.length / unionSize) * 100 : 0;
  const different = userSet.filter((value) => !tripSet.includes(value));
  const reasons = shared.length
    ? [`${shared.length} shared ${label}: ${shared.join(", ")}`]
    : [`No shared ${label.toLowerCase()} were found`];
  return makeDimension(
    name,
    score,
    shared,
    different,
    reasons,
    score < 60 ? reasons : [],
  );
};

const parseGroupPreference = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/i);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return min > 0 && max >= min ? { min, max } : null;
};

const scoreGroupSize = (trip, preferences) => {
  const maximum = safeNumber(trip?.groupSize?.max);
  const minimum = safeNumber(trip?.groupSize?.min);
  if (maximum === null || minimum === null || maximum < minimum) return unknownDimension("groupSize");
  const currentMembers = Math.max(0, safeNumber(trip?.currentMembers) || 0);
  if (currentMembers >= maximum || trip?.availableSlots === 0) {
    return makeDimension(
      "groupSize",
      0,
      [],
      ["available slots"],
      ["This trip is full and is not recommended"],
      ["This trip is full and is not recommended"],
    );
  }
  const preference = preferences.groupSizeRange || parseGroupPreference(preferences.groupPreference);
  const preferredMin = safeNumber(preference?.min);
  const preferredMax = safeNumber(preference?.max);
  if (preferredMin === null || preferredMax === null || preferredMax < preferredMin) {
    return unknownDimension("groupSize");
  }
  const feasibleMinimum = Math.max(minimum, currentMembers + 1);
  const overlap = Math.max(0, Math.min(maximum, preferredMax) - Math.max(feasibleMinimum, preferredMin));
  if (Math.min(maximum, preferredMax) < Math.max(feasibleMinimum, preferredMin)) {
    return makeDimension(
      "groupSize",
      0,
      [],
      ["preferred group size"],
      ["Preferred group size does not fit this trip's available group range"],
      ["Preferred group size does not fit this trip's available group range"],
    );
  }
  const preferredWidth = preferredMax - preferredMin;
  const score = preferredWidth === 0 ? 100 : (overlap / preferredWidth) * 100;
  return makeDimension("groupSize", score, ["preferred group size"], [], ["Preferred group size fits this trip"]);
};

const scoreFood = (userValues, tripValues) => {
  const userSet = normalizeSet(userValues);
  const tripSet = normalizeSet(tripValues);
  if (!userSet.length || !tripSet.length) return unknownDimension("foodPreference");
  const normalized = (value) => value.replace(/\s+/g, "");
  const match = userSet.find((userValue) => tripSet.some((tripValue) => normalized(userValue) === normalized(tripValue)));
  if (match) return makeDimension("foodPreference", 100, [match], [], ["Food preferences match"]);

  const vegan = userSet.includes("vegan");
  const vegetarian = userSet.includes("vegetarian");
  const incompatible = tripSet.some((value) => value === "non veg" || value === "nonvegetarian" || value === "non vegetarian");
  if (vegan && incompatible) {
    return makeDimension(
      "foodPreference",
      0,
      [],
      ["dietary preference"],
      ["Trip food preference conflicts with your vegan dietary preference"],
      ["Trip food preference conflicts with your vegan dietary preference"],
    );
  }
  if ((vegan && tripSet.includes("vegetarian")) || (vegetarian && tripSet.includes("vegan"))) {
    return makeDimension("foodPreference", 70, ["dietary preference"], [], ["Food preferences may be compatible but are not identical"]);
  }
  if (tripSet.includes("mixed") || tripSet.includes("any")) {
    return makeDimension("foodPreference", 60, ["dietary preference"], [], ["Trip food options are mixed and may need confirmation"]);
  }
  return scoreSets("foodPreference", userSet, tripSet, "Food preferences");
};

const scorePace = (userValue, tripValue) => {
  const userPace = normalizeValue(userValue).toUpperCase().replace(/\s+/g, "_");
  const tripPace = normalizeValue(tripValue).toUpperCase().replace(/\s+/g, "_");
  if (!PACE_SCORES[userPace] || !PACE_SCORES[tripPace]) return unknownDimension("travelPace");
  const score = PACE_SCORES[userPace][tripPace];
  const reason =
    score === 100 ? "Travel pace matches" : score >= 50 ? "Travel paces are adjacent" : "Travel paces are very different";
  return makeDimension(
    "travelPace",
    score,
    score === 100 ? [userPace] : [],
    score < 50 ? [tripPace] : [],
    [reason],
    score < 60 ? [reason] : [],
  );
};

const scoreOtherPreferences = (trip, preferences) => {
  const dimensions = [
    scoreSets("accommodation", preferences.accommodationPreference, trip?.accommodationPreference, "Accommodation preferences"),
    scoreSets("transport", preferences.transportPreference, trip?.transportPreference, "Transport preferences"),
    scoreFood(preferences.foodPreference, trip?.foodPreference),
    scoreSets("languages", preferences.languages, trip?.languages, "Languages"),
    scorePace(preferences.travelPace, trip?.travelPace),
  ];
  const evaluated = dimensions.filter((dimension) => dimension.status !== "UNKNOWN");
  if (!evaluated.length) return { dimension: unknownDimension("otherPreferences"), details: dimensions };
  const average = evaluated.reduce((total, dimension) => total + dimension.score, 0) / evaluated.length;
  const matched = dimensions.flatMap((dimension) => dimension.matchedAttributes);
  const mismatched = dimensions.flatMap((dimension) => dimension.mismatchedAttributes);
  const reasons = dimensions.flatMap((dimension) => dimension.reasons);
  const potentialDifferences = dimensions.flatMap((dimension) => dimension.potentialDifferences);
  return {
    dimension: makeDimension("otherPreferences", average, matched, mismatched, reasons, potentialDifferences),
    details: dimensions,
  };
};

const getCategory = (score) =>
  CATEGORY_THRESHOLDS.find(({ minimum }) => score >= minimum)?.category || "POOR";

const calculateCompatibility = (user, trip) => {
  const preferences = getTravelPreferences(user);
  const other = scoreOtherPreferences(trip, preferences);
  const dimensions = [
    scoreDestination(trip, preferences),
    scoreDates(trip, preferences),
    scoreBudget(trip, preferences),
    scoreSets("interests", preferences.interests, trip?.interests, "interests"),
    scoreSets("travelStyle", preferences.travelStyle, trip?.travelStyle, "travel styles"),
    scoreSets("activities", preferences.activities, trip?.activities, "activities"),
    scoreGroupSize(trip, preferences),
    other.dimension,
  ];
  const evaluated = dimensions.filter((dimension) => dimension.status !== "UNKNOWN");
  const totalWeight = evaluated.reduce((sum, dimension) => sum + DIMENSION_WEIGHTS[dimension.name], 0);
  const weightedScore = totalWeight
    ? evaluated.reduce((sum, dimension) => sum + dimension.score * DIMENSION_WEIGHTS[dimension.name], 0) / totalWeight
    : 50;
  const overallScore = roundScore(weightedScore);
  const breakdown = Object.fromEntries(dimensions.map(({ name, score }) => [name, score]));
  const dimensionStatus = Object.fromEntries(dimensions.map(({ name, status }) => [name, status]));
  const reasonDimensions = [...dimensions, ...other.details];
  const potentialDifferences = [...new Set([
    ...reasonDimensions.flatMap(({ potentialDifferences }) => potentialDifferences),
    ...reasonDimensions.flatMap(({ mismatchedAttributes }) => mismatchedAttributes),
  ])];
  const matchReasons = [...new Set(reasonDimensions
    .filter(({ score }) => score !== null && score >= 60)
    .flatMap(({ reasons }) => reasons))];

  return {
    overallScore,
    category: getCategory(overallScore),
    scoreBasis: totalWeight ? "EVALUATED_DIMENSIONS" : "NEUTRAL_NO_DATA",
    dataCoverage: totalWeight,
    breakdown,
    dimensionStatus,
    preferenceBreakdown: Object.fromEntries(other.details.map(({ name, score, status }) => [name, { score, status }])),
    evaluatedDimensions: dimensions.filter(({ status }) => status !== "UNKNOWN").map(({ name }) => name),
    unknownDimensions: dimensions.filter(({ status }) => status === "UNKNOWN").map(({ name }) => name),
    matchedAttributes: [...new Set([...dimensions, ...other.details].flatMap(({ matchedAttributes }) => matchedAttributes))],
    mismatchedAttributes: [...new Set([...dimensions, ...other.details].flatMap(({ mismatchedAttributes }) => mismatchedAttributes))],
    reasons: [...new Set([...dimensions, ...other.details].flatMap(({ reasons }) => reasons))],
    matchReasons,
    potentialDifferences,
  };
};

module.exports = {
  DIMENSION_WEIGHTS,
  CATEGORY_THRESHOLDS,
  PACE_SCORES,
  normalizeValue,
  normalizeSet,
  calculateCompatibility,
  getCategory,
};
