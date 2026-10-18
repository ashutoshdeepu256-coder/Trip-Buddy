const mongoose = require("mongoose");
const Match = require("../models/Match");
const User = require("../models/User");
const TripMember = require("../models/TripMember");
const { calculateCompatibility } = require("../ai/matching.engine");
const tripService = require("./trip.service");
const safetyService = require("./safety.service");
const { HttpError } = require("../utils/http");

const CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 1000;
const COMPATIBLE_TRIP_STATUSES = ["PUBLISHED", "PLANNING", "CONFIRMED"];
const compatibilityCache = new Map();

const objectIdString = (value) => value?._id?.toString?.() || value?.toString?.() || "";

const generateCompatibilityReasons = (result) => [...result.reasons];

const generateCompatibilityExplanation = async (result, provider = null) => {
  const deterministicText = generateCompatibilityReasons(result).join(". ") || "Not enough preference data is available for a detailed explanation.";
  if (!provider) return { text: deterministicText, source: "DETERMINISTIC" };

  const safeContext = {
    category: result.category,
    breakdown: result.breakdown,
    dimensionStatus: result.dimensionStatus,
    reasons: result.reasons,
  };
  try {
    const response = await provider(safeContext);
    const text = typeof response === "string" ? response : response?.explanation;
    if (typeof text !== "string" || !text.trim() || text.length > 1000) {
      throw new Error("Explanation provider returned an invalid explanation");
    }
    return { text: text.trim(), source: "OPTIONAL_PROVIDER" };
  } catch (error) {
    console.warn("Optional compatibility explanation failed; using deterministic reasons", {
      name: error.name,
    });
    return { text: deterministicText, source: "DETERMINISTIC_FALLBACK" };
  }
};

const pruneCache = (now = Date.now()) => {
  for (const [key, entry] of compatibilityCache) {
    if (entry.expiresAt <= now) compatibilityCache.delete(key);
  }
  while (compatibilityCache.size > CACHE_MAX_ENTRIES) {
    compatibilityCache.delete(compatibilityCache.keys().next().value);
  }
};

const calculateTripCompatibility = async ({ trip, user, currentMembers, force = false }) => {
  const userId = objectIdString(user?._id || user?.id);
  const tripId = objectIdString(trip?._id || trip?.id);
  if (!userId || !tripId) throw new HttpError(400, "A trip and signed-in user are required", "INVALID_MATCH_INPUT");

  const key = `${tripId}:${userId}:${trip.updatedAt?.toISOString?.() || trip.updatedAt || "unversioned"}:${user.updatedAt?.toISOString?.() || user.updatedAt || "unversioned"}`;
  const now = Date.now();
  pruneCache(now);
  const cached = compatibilityCache.get(key);
  if (!force && cached && cached.currentMembers === currentMembers && cached.expiresAt > now) {
    return { ...cached.result };
  }

  const tripWithMemberState = {
    ...trip,
    currentMembers,
    availableSlots: Math.max(0, Number(trip.groupSize?.max || 0) - currentMembers),
  };
  const result = calculateCompatibility(user, tripWithMemberState);
  compatibilityCache.set(key, {
    result,
    currentMembers,
    expiresAt: now + CACHE_TTL_MS,
  });
  pruneCache(now);
  return result;
};

const loadAccessibleTrip = async (tripId, user) => {
  const trip = await tripService.getAccessibleTrip(tripId, user);
  if (!COMPATIBLE_TRIP_STATUSES.includes(trip.status)) {
    throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  const creatorId = objectIdString(trip.creator?.id || trip.creator);
  if (creatorId === objectIdString(user._id)) {
    throw new HttpError(409, "A trip creator cannot request compatibility for their own trip", "SELF_MATCH_UNAVAILABLE");
  }
  const creatorSettings = await User.findById(creatorId).select("safetySettings.discoverable").lean();
  if (creatorSettings?.safetySettings?.discoverable === false) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  if (await safetyService.isInteractionBlocked(user._id, creatorId)) {
    throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  return trip;
};

const computeForUserAndTrip = async (tripId, user, { force = false } = {}) => {
  const trip = await loadAccessibleTrip(tripId, user);
  const currentMembers = await TripMember.countDocuments({ trip: trip.id, status: "ACTIVE" });
  if (Number(trip.groupSize?.max) <= currentMembers) {
    throw new HttpError(409, "This trip is full and cannot be recommended", "TRIP_FULL");
  }
  const result = await calculateTripCompatibility({ trip, user, currentMembers, force });
  return { trip, result };
};

const getTripCompatibility = async (tripId, user) => {
  const { result } = await computeForUserAndTrip(tripId, user);
  return {
    ...result,
    explanation: await generateCompatibilityExplanation(result),
  };
};

const persistCompatibility = async (tripId, user, result) => {
  const now = new Date();
  const values = {
    trip: tripId,
    user: user._id,
    score: result.overallScore,
    category: result.category,
    scoreBasis: result.scoreBasis,
    dataCoverage: result.dataCoverage,
    scoreBreakdown: result.breakdown,
    dimensionStatus: result.dimensionStatus,
    preferenceBreakdown: result.preferenceBreakdown,
    reasons: generateCompatibilityReasons(result),
    matchReasons: result.matchReasons,
    potentialDifferences: result.potentialDifferences,
    matchedAttributes: result.matchedAttributes,
    mismatchedAttributes: result.mismatchedAttributes,
    evaluatedDimensions: result.evaluatedDimensions,
    unknownDimensions: result.unknownDimensions,
    status: "CALCULATED",
    generatedAt: now,
  };
  const matchIdentity = { trip: tripId, user: user._id };
  try {
    return await Match.findOneAndUpdate(
      matchIdentity,
      { $set: values },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Match.findOneAndUpdate(matchIdentity, { $set: values }, { new: true, runValidators: true });
  }
};

const refreshTripCompatibility = async (tripId, user) => {
  const { result } = await computeForUserAndTrip(tripId, user, { force: true });
  const match = await persistCompatibility(tripId, user, result);
  return serializeMatch(match);
};

const serializeTripSummary = (trip) => {
  if (!trip) return null;
  const value = trip.toObject ? trip.toObject() : trip;
  const destination = value.destination;
  return {
    id: objectIdString(value),
    title: value.title,
    destination: destination && typeof destination === "object"
      ? { name: destination.name, slug: destination.slug }
      : null,
    startDate: value.startDate || null,
    endDate: value.endDate || null,
  };
};

const serializeMatch = (match) => {
  const value = match.toObject ? match.toObject() : match;
  return {
    id: objectIdString(value),
    trip: serializeTripSummary(value.trip),
    score: value.score,
    category: value.category,
    scoreBasis: value.scoreBasis,
    dataCoverage: value.dataCoverage,
    scoreBreakdown: value.scoreBreakdown,
    dimensionStatus: value.dimensionStatus,
    preferenceBreakdown: value.preferenceBreakdown,
    reasons: value.reasons || [],
    matchReasons: value.matchReasons || [],
    potentialDifferences: value.potentialDifferences || [],
    matchedAttributes: value.matchedAttributes || [],
    mismatchedAttributes: value.mismatchedAttributes || [],
    evaluatedDimensions: value.evaluatedDimensions || [],
    unknownDimensions: value.unknownDimensions || [],
    status: value.status,
    generatedAt: value.generatedAt,
    updatedAt: value.updatedAt,
  };
};

const listUserMatches = async (user, { page = 1, limit = 20, status } = {}) => {
  const query = { user: user._id };
  if (status) query.status = status;
  const [matches, total] = await Promise.all([
    Match.find(query)
      .sort({ generatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: "trip", select: "title destination startDate endDate" })
      .populate({ path: "trip.destination", select: "name slug" })
      .lean(),
    Match.countDocuments(query),
  ]);
  const totalPages = Math.ceil(total / limit);
  return {
    items: matches.map(serializeMatch),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

const getMatchById = async (matchId, user) => {
  if (!mongoose.isValidObjectId(matchId)) {
    throw new HttpError(400, "Invalid match ID", "INVALID_MATCH_ID");
  }
  const match = await Match.findOne({ _id: matchId, user: user._id })
    .populate({ path: "trip", select: "title destination startDate endDate" })
    .populate({ path: "trip.destination", select: "name slug" })
    .lean();
  if (!match) throw new HttpError(404, "Match was not found", "MATCH_NOT_FOUND");
  if (match.status === "CALCULATED") {
    const viewedAt = new Date();
    await Match.updateOne(
      { _id: match._id, user: user._id, status: "CALCULATED" },
      { $set: { status: "VIEWED", updatedAt: viewedAt } },
    );
    match.status = "VIEWED";
    match.updatedAt = viewedAt;
  }
  return serializeMatch(match);
};

module.exports = {
  CACHE_TTL_MS,
  generateCompatibilityReasons,
  generateCompatibilityExplanation,
  calculateTripCompatibility,
  getTripCompatibility,
  refreshTripCompatibility,
  listUserMatches,
  getMatchById,
  serializeMatch,
};
