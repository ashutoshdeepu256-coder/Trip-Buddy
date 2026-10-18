const crypto = require("node:crypto");
const mongoose = require("mongoose");
const TripMember = require("../models/TripMember");
const User = require("../models/User");
const Block = require("../models/Block");
const GroupRecommendation = require("../models/GroupRecommendation");
const matchService = require("./match.service");
const tripService = require("./trip.service");
const safetyService = require("./safety.service");
const { recordAudit } = require("./audit.service");
const { HttpError } = require("../utils/http");
const { normalizeSet } = require("../ai/matching.engine");

const ALGORITHM_VERSION = "greedy-v1";
const MAX_CANDIDATES = 100;
const MAX_PROPOSED_USERS = 8;
const RECOMMENDATION_TTL_DAYS = 7;
const DECLINE_SUPPRESSION_DAYS = 30;
const ELIGIBLE_TRIP_STATUSES = ["PUBLISHED", "PLANNING", "CONFIRMED"];

const idOf = (value) => value?._id?.toString?.() || value?.id?.toString?.() || value?.toString?.() || "";
const travelPreferences = (user) => user?.profile?.travelPreferences || {};
const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

const getAuthorizedTrip = async (tripId, actor, { ownerOnly = false } = {}) => {
  if (!mongoose.isValidObjectId(tripId)) throw new HttpError(400, "Invalid trip ID", "INVALID_TRIP_ID");
  const trip = await tripService.getAccessibleTrip(tripId, actor);
  const isOwner = idOf(trip.creator) === idOf(actor._id);
  if (ownerOnly && !isOwner) throw new HttpError(403, "Only the trip creator can manage group recommendations", "GROUP_RECOMMENDATION_FORBIDDEN");
  if (!ownerOnly && !isOwner && !ELIGIBLE_TRIP_STATUSES.includes(trip.status)) {
    throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  if (!ELIGIBLE_TRIP_STATUSES.includes(trip.status) || !["PUBLIC", "COMMUNITY"].includes(trip.privacy)) {
    throw new HttpError(409, "This trip is not eligible for group recommendations", "TRIP_NOT_RECOMMENDABLE");
  }
  return { trip, isOwner };
};

const completeRange = (range) => {
  if (range?.min === null || range?.min === undefined || range?.max === null || range?.max === undefined || range.min === "" || range.max === "") return null;
  const min = Number(range?.min);
  const max = Number(range?.max);
  return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min
    ? { min, max, currency: String(range?.currency || "").toUpperCase() }
    : null;
};

const tripDateWindow = (trip) => {
  const start = asDate(trip.startDate);
  const end = asDate(trip.endDate);
  return start && end && end > start ? { start: start.getTime(), end: end.getTime() } : null;
};

const userDateWindow = (user, trip) => {
  const tripWindow = tripDateWindow(trip);
  const availability = travelPreferences(user).availability;
  const start = asDate(availability?.startDate);
  const end = asDate(availability?.endDate);
  if (!tripWindow || !start || !end || end < start) return null;
  const flexibility = Math.min(31, Math.max(0, Number(travelPreferences(user).dateFlexibilityDays) || 0)) * 86400000;
  const overlap = {
    start: Math.max(tripWindow.start, start.getTime() - flexibility),
    end: Math.min(tripWindow.end, end.getTime() + 86400000 + flexibility),
  };
  return overlap.end > overlap.start ? overlap : { start: 1, end: 0 };
};

const blockPairKey = (first, second) => [idOf(first), idOf(second)].sort().join(":");

const groupConstraintsAllow = (trip, allUsers, candidate, blockedPairs) => {
  if (allUsers.some((user) => blockedPairs.has(blockPairKey(user, candidate)))) {
    return { allowed: false, reason: "BLOCKED_GROUP_PAIR" };
  }

  const participants = [...allUsers, candidate];
  const tripBudget = completeRange(trip.budget);
  if (tripBudget) {
    let minimum = tripBudget.min;
    let maximum = tripBudget.max;
    for (const participant of participants) {
      const range = completeRange(travelPreferences(participant).budgetRange);
      if (!range || !range.currency || range.currency !== tripBudget.currency) continue;
      minimum = Math.max(minimum, range.min);
      maximum = Math.min(maximum, range.max);
    }
    if (maximum < minimum) return { allowed: false, reason: "GROUP_BUDGET_MISMATCH" };
  }

  const windows = participants.map((participant) => userDateWindow(participant, trip));
  if (windows.some((window) => window?.end < window?.start)) {
    return { allowed: false, reason: "DATE_MISMATCH" };
  }
  const knownWindows = windows.filter(Boolean);
  if (knownWindows.length > 1) {
    const start = Math.max(...knownWindows.map((window) => window.start));
    const end = Math.min(...knownWindows.map((window) => window.end));
    if (end <= start) return { allowed: false, reason: "GROUP_DATE_MISMATCH" };
  }
  return { allowed: true };
};

const blockedPairsFor = async (userIds) => {
  const ids = [...new Set(userIds.map(idOf).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length < 2) return new Set();
  const blocks = await Block.find({ blocker: { $in: ids }, blocked: { $in: ids } })
    .select("blocker blocked")
    .lean();
  const pairs = new Set();
  for (const block of blocks) {
    pairs.add(blockPairKey(block.blocker, block.blocked));
  }
  return pairs;
};

const aggregateBreakdown = (members) => {
  const keys = ["destination", "dates", "budget", "interests", "travelStyle", "activities", "groupSize", "otherPreferences"];
  return Object.fromEntries(keys.map((key) => {
    const values = members.map(({ result }) => result.breakdown[key]).filter(Number.isFinite);
    return [key, values.length ? Math.round(values.reduce((sum, score) => sum + score, 0) / values.length) : null];
  }));
};

const recommendationReasons = (trip, members, unknownConstraints) => {
  const reasons = [
    `${members.length} eligible traveller${members.length === 1 ? "" : "s"} fit within the available trip capacity`,
    `Average individual trip compatibility is ${Math.round(members.reduce((sum, member) => sum + member.result.overallScore, 0) / members.length)}%`,
  ];
  const interests = members.map(({ user }) => normalizeSet(travelPreferences(user).interests));
  const tripInterests = normalizeSet(trip.interests);
  if (interests.length && interests.every((items) => items.length)) {
    const shared = interests[0].filter((interest) =>
      tripInterests.includes(interest) && interests.every((items) => items.includes(interest)),
    );
    if (shared.length) reasons.push(`Shared group interests: ${shared.slice(0, 8).join(", ")}`);
  }
  const budget = completeRange(trip.budget);
  if (budget && members.some(({ user }) => {
    const range = completeRange(travelPreferences(user).budgetRange);
    return range?.currency === budget.currency;
  })) reasons.push(`Known budget ranges overlap in ${budget.currency}`);
  if (members.some(({ user }) => travelPreferences(user).availability)) {
    reasons.push("Known travel availability overlaps the trip dates");
  }
  if (unknownConstraints.length) reasons.push("Some group preferences are unknown and were not treated as mismatches");
  return reasons;
};

const createGenerationKey = (trip, activeMembers, candidates, blockedPairs) => crypto
  .createHash("sha256")
  .update(JSON.stringify({
    algorithm: ALGORITHM_VERSION,
    trip: [idOf(trip), trip.updatedAt || null],
    activeMembers: activeMembers.map(idOf).sort(),
    candidates: candidates.map((user) => [idOf(user), user.updatedAt || null]).sort(([left], [right]) => left.localeCompare(right)),
    blockedPairs: [...blockedPairs].sort(),
  }))
  .digest("hex");

const buildEligibleUserQuery = (excludedIds) => ({
  _id: { $nin: excludedIds },
  $or: [{ accountStatus: "ACTIVE" }, { accountStatus: { $exists: false } }],
});

const expireStale = async (tripId, now = new Date()) => {
  await GroupRecommendation.updateMany(
    { trip: tripId, activeKey: tripId, expiresAt: { $lte: now } },
    { $set: { status: "EXPIRED", activeKey: null } },
  );
};

const calculateCandidate = async (trip, user, currentMembers) => {
  const result = await matchService.calculateTripCompatibility({ trip, user, currentMembers });
  if (result.dimensionStatus.destination === "MISMATCH" || result.dimensionStatus.dates === "MISMATCH" || result.dimensionStatus.budget === "MISMATCH") {
    return null;
  }
  return { user, result };
};

const buildGroup = (trip, activeUsers, candidates, blockedPairs, slots) => {
  const targetSize = Math.min(slots, MAX_PROPOSED_USERS);
  const selected = [];
  const selectedIds = new Set();
  const remaining = [...candidates];
  const groupUsers = [...activeUsers];

  while (remaining.length && selected.length < targetSize) {
    const chosen = remaining
      .map((candidate) => {
        if (selectedIds.has(idOf(candidate.user)) || groupUsers.some((user) => idOf(user) === idOf(candidate.user))) {
          return { candidate, utility: -Infinity };
        }
        const constraint = groupConstraintsAllow(trip, groupUsers, candidate.user, blockedPairs);
        if (!constraint.allowed) return { candidate, utility: -Infinity };
        const candidateInterests = normalizeSet(travelPreferences(candidate.user).interests);
        const covered = new Set(groupUsers.flatMap((user) => normalizeSet(travelPreferences(user).interests)));
        const novelty = candidateInterests.filter((interest) => !covered.has(interest)).length;
        return {
          candidate,
          utility: candidate.result.overallScore + Math.min(10, novelty * 2),
        };
      })
      .filter(({ utility }) => Number.isFinite(utility))
      .sort((left, right) => right.utility - left.utility || right.candidate.result.overallScore - left.candidate.result.overallScore || idOf(left.candidate.user).localeCompare(idOf(right.candidate.user)))[0];
    if (!chosen) break;
    selected.push(chosen.candidate);
    selectedIds.add(idOf(chosen.candidate.user));
    groupUsers.push(chosen.candidate.user);
    remaining.splice(remaining.indexOf(chosen.candidate), 1);
  }
  return selected;
};

const eligibleSnapshot = async (trip, actor, now) => {
  const memberRecords = await TripMember.find({ trip: trip.id }).select("user status").lean();
  const memberIds = memberRecords.map(({ user }) => user);
  const activeMemberIds = memberRecords.filter(({ status }) => status === "ACTIVE").map(({ user }) => user);
  const currentMembers = activeMemberIds.length;
  const maximum = Number(trip.groupSize?.max || 0);
  const slots = Math.max(0, maximum - currentMembers);
  if (!slots) throw new HttpError(409, "This trip has no remaining capacity", "TRIP_FULL");

  const suppressedSince = new Date(now.getTime() - DECLINE_SUPPRESSION_DAYS * 86400000);
  const rejected = await GroupRecommendation.find({ trip: trip.id, status: "REJECTED", createdAt: { $gte: suppressedSince } })
    .select("proposedUsers.user proposedUsers.status")
    .lean();
  const declinedIds = rejected.flatMap((item) => item.proposedUsers
    .filter(({ status }) => status === "REJECTED")
    .map(({ user }) => user.toString()));
  const excludedIds = [...new Set([idOf(actor), ...memberIds.map(idOf), ...declinedIds])]
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));
  const candidateDocs = await User.find({ ...buildEligibleUserQuery(excludedIds), "safetySettings.discoverable": { $ne: false } })
    .select("_id accountStatus safetySettings.discoverable profile.travelPreferences updatedAt")
    .sort({ updatedAt: -1, _id: 1 })
    .limit(MAX_CANDIDATES + 1)
    .lean();
  const truncated = candidateDocs.length > MAX_CANDIDATES;
  const candidates = candidateDocs.slice(0, MAX_CANDIDATES);
  const blockedByOwner = new Set(await safetyService.getInteractionBlockedIds(idOf(actor), candidates.map(({ _id }) => _id)));
  const currentUserDocs = activeMemberIds.length
    ? await User.find({ _id: { $in: activeMemberIds } }).select("_id accountStatus profile.travelPreferences updatedAt").lean()
    : [];
  const activeUsers = [...new Map([actor, ...currentUserDocs]
    .filter((user) => !user.accountStatus || user.accountStatus === "ACTIVE")
    .map((user) => [idOf(user), user])).values()];
  const allIds = [...candidates.map(({ _id }) => _id), ...activeMemberIds, idOf(actor)];
  const blockPairs = await blockedPairsFor(allIds);
  const currentGroupIds = new Set(activeUsers.map(idOf));
  const ranked = await Promise.all(candidates
    .filter((candidate) => !blockedByOwner.has(candidate._id.toString()))
    .map(async (candidate) => {
      const scored = await calculateCandidate(trip, candidate, currentMembers);
      return scored && { ...scored, user: candidate };
    }));
  return {
    memberIds,
    activeMemberIds,
    currentMembers,
    slots,
    candidates: ranked.filter(Boolean),
    activeUsers: activeUsers.filter((user) => currentGroupIds.has(idOf(user))),
    blockPairs,
    truncated,
  };
};

const serializeRecommendation = async (recommendation, actor, trip, isOwner) => {
  const value = recommendation.toObject ? recommendation.toObject() : recommendation;
  const ids = value.proposedUsers.map(({ user }) => user);
  const names = await User.find({ _id: { $in: ids } }).select("_id name").lean();
  const nameById = new Map(names.map((user) => [user._id.toString(), user.name]));
  const actorId = idOf(actor);
  const own = value.proposedUsers.find(({ user }) => idOf(user) === actorId);
  return {
    id: idOf(value),
    trip: { id: idOf(trip), title: trip.title, destination: trip.destination?.name || null },
    status: value.status,
    score: value.score,
    scoreBreakdown: value.scoreBreakdown,
    groupSize: value.proposedUsers.length + Number(value.currentMembers || 0),
    proposedTravellerCount: value.proposedUsers.length,
    members: value.proposedUsers.map(({ user, status }) => ({ name: nameById.get(idOf(user)) || "TripBuddy traveller", response: status })),
    myCompatibility: own ? {
      score: own.score,
      scoreBreakdown: own.scoreBreakdown,
      dimensionStatus: own.dimensionStatus,
      reasons: own.reasons,
      response: own.status,
    } : null,
    reasons: value.reasons,
    constraintsSatisfied: value.constraintsSatisfied,
    unknownConstraints: value.unknownConstraints,
    algorithmVersion: value.algorithmVersion,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    canRespond: !isOwner && Boolean(own) && own.status === "PENDING" && ["PROPOSED", "VIEWED"].includes(value.status),
    actorIsOwner: isOwner,
  };
};

const getRecommendationAndAccess = async (recommendationId, actor, { allowBlocked = false } = {}) => {
  if (!mongoose.isValidObjectId(recommendationId)) throw new HttpError(400, "Invalid recommendation ID", "INVALID_GROUP_RECOMMENDATION_ID");
  const recommendation = await GroupRecommendation.findById(recommendationId).lean();
  if (!recommendation) throw new HttpError(404, "Recommendation was not found", "GROUP_RECOMMENDATION_NOT_FOUND");
  const { trip, isOwner } = await getAuthorizedTrip(recommendation.trip, actor);
  const isProposed = recommendation.proposedUsers.some(({ user }) => idOf(user) === idOf(actor));
  if (!isOwner && !isProposed) throw new HttpError(404, "Recommendation was not found", "GROUP_RECOMMENDATION_NOT_FOUND");
  if (!allowBlocked) {
    const relatedIds = [...recommendation.proposedUsers.map(({ user }) => user), trip.creator];
    const blocked = await blockedPairsFor(relatedIds);
    if (blocked.size) throw new HttpError(404, "Recommendation was not found", "GROUP_RECOMMENDATION_NOT_FOUND");
  }
  return { recommendation, trip, isOwner, isProposed };
};

const recommendationUserValues = (selected) => selected.map(({ user, result }) => ({
  user: user._id,
  score: result.overallScore,
  scoreBreakdown: result.breakdown,
  dimensionStatus: result.dimensionStatus,
  reasons: result.reasons,
  status: "PENDING",
  respondedAt: null,
}));

const generateGroupRecommendation = async (tripId, actor, req) => {
  if (actor.accountStatus && actor.accountStatus !== "ACTIVE") throw new HttpError(403, "An active account is required", "ACCOUNT_INELIGIBLE");
  const { trip, isOwner } = await getAuthorizedTrip(tripId, actor, { ownerOnly: true });
  const now = new Date();
  await expireStale(trip.id, now);
  const snapshot = await eligibleSnapshot(trip, actor, now);
  const generationKey = createGenerationKey(
    trip,
    snapshot.activeMemberIds,
    snapshot.candidates.map(({ user }) => user),
    snapshot.blockPairs,
  );
  const current = await GroupRecommendation.findOne({ activeKey: trip.id }).lean();
  if (current?.generationKey === generationKey) {
    return { recommendation: await serializeRecommendation(current, actor, trip, isOwner), reused: true, candidateLimit: MAX_CANDIDATES, truncated: snapshot.truncated };
  }
  if (current) {
    await GroupRecommendation.updateOne(
      { _id: current._id, activeKey: trip.id, status: { $in: ["PROPOSED", "VIEWED"] } },
      { $set: { status: "SUPERSEDED", activeKey: null } },
    );
  }
  const processed = await GroupRecommendation.findOne({ trip: trip.id, generationKey }).lean();
  if (processed) {
    return { recommendation: await serializeRecommendation(processed, actor, trip, isOwner), reused: true, candidateLimit: MAX_CANDIDATES, truncated: snapshot.truncated };
  }
  const selected = buildGroup(trip, snapshot.activeUsers, snapshot.candidates, snapshot.blockPairs, snapshot.slots);
  const minimumNeeded = Math.max(0, Number(trip.groupSize?.min || 1) - snapshot.currentMembers);
  if (selected.length < minimumNeeded || !selected.length) {
    await recordAudit(req, {
      action: "GROUP_RECOMMENDATION_GENERATED",
      resourceType: "Trip",
      resourceId: trip.id,
      metadata: { result: "INSUFFICIENT_CANDIDATES", eligibleCandidateCount: snapshot.candidates.length },
    });
    return {
      recommendation: null,
      reused: false,
      result: "INSUFFICIENT_CANDIDATES",
      eligibleCandidateCount: snapshot.candidates.length,
      requiredTravellerCount: minimumNeeded,
      candidateLimit: MAX_CANDIDATES,
      truncated: snapshot.truncated,
    };
  }

  const breakdown = aggregateBreakdown(selected);
  const score = Math.round(selected.reduce((sum, member) => sum + member.result.overallScore, 0) / selected.length);
  const unknownConstraints = [];
  if (!tripDateWindow(trip)) unknownConstraints.push("TRIP_DATES_UNKNOWN");
  if (!completeRange(trip.budget)) unknownConstraints.push("TRIP_BUDGET_UNKNOWN");
  if ([...snapshot.activeUsers, ...selected.map(({ user }) => user)].some((user) => !travelPreferences(user).availability)) {
    unknownConstraints.push("GROUP_DATE_PREFERENCES_PARTIALLY_UNKNOWN");
  }
  const tripBudget = completeRange(trip.budget);
  if (tripBudget && [...snapshot.activeUsers, ...selected.map(({ user }) => user)].some((user) => {
    const range = completeRange(travelPreferences(user).budgetRange);
    return !range || !range.currency || range.currency !== tripBudget.currency;
  })) unknownConstraints.push("GROUP_BUDGET_PREFERENCES_PARTIALLY_UNKNOWN");
  if (selected.some(({ result }) => result.unknownDimensions.length)) unknownConstraints.push("TRAVELLER_PREFERENCES_INCOMPLETE");
  const constraintsSatisfied = ["TRIP_STATUS", "TRIP_PRIVACY", "ACTIVE_ACCOUNTS", "NO_BLOCKED_PAIRS", "NO_DUPLICATE_MEMBERS", "TRIP_CAPACITY", "GROUP_DATE_OVERLAP", "GROUP_BUDGET_OVERLAP"];
  if (snapshot.currentMembers + selected.length >= Number(trip.groupSize?.min || 1)) constraintsSatisfied.push("MINIMUM_GROUP_SIZE");
  const record = {
    trip: trip.id,
    activeKey: trip.id,
    proposedUsers: recommendationUserValues(selected),
    score,
    currentMembers: snapshot.currentMembers,
    scoreBreakdown: breakdown,
    reasons: recommendationReasons(trip, selected, unknownConstraints),
    constraintsSatisfied,
    unknownConstraints,
    status: "PROPOSED",
    algorithmVersion: ALGORITHM_VERSION,
    generationKey,
    expiresAt: new Date(now.getTime() + RECOMMENDATION_TTL_DAYS * 86400000),
  };
  let saved;
  try {
    saved = await GroupRecommendation.create(record);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await GroupRecommendation.findOne({ activeKey: trip.id }).lean();
    if (!duplicate) throw error;
    return { recommendation: await serializeRecommendation(duplicate, actor, trip, isOwner), reused: true, candidateLimit: MAX_CANDIDATES, truncated: snapshot.truncated };
  }
  await recordAudit(req, {
    action: "GROUP_RECOMMENDATION_GENERATED",
    resourceType: "GroupRecommendation",
    resourceId: saved._id,
    metadata: { proposedTravellerCount: selected.length, score },
  });
  return { recommendation: await serializeRecommendation(saved, actor, trip, isOwner), reused: false, candidateLimit: MAX_CANDIDATES, truncated: snapshot.truncated };
};

const listTripRecommendations = async (tripId, actor) => {
  const { trip, isOwner } = await getAuthorizedTrip(tripId, actor);
  const query = { trip: trip.id };
  if (!isOwner) query["proposedUsers.user"] = actor._id;
  await expireStale(trip.id);
  const items = await GroupRecommendation.find(query).sort({ createdAt: -1, _id: -1 }).limit(20).lean();
  const relatedIds = [...new Set(items.flatMap((item) => [
    ...item.proposedUsers.map(({ user }) => idOf(user)),
    idOf(trip.creator),
  ]).filter(Boolean))];
  const blockedPairs = await blockedPairsFor(relatedIds);
  const visible = [];
  for (const item of items) {
    if (!isOwner && !item.proposedUsers.some(({ user }) => idOf(user) === idOf(actor))) continue;
    const related = [...item.proposedUsers.map(({ user }) => user), trip.creator];
    const hasBlockedPair = related.some((user, index) =>
      related.slice(index + 1).some((other) => blockedPairs.has(blockPairKey(user, other))),
    );
    if (!hasBlockedPair) visible.push(item);
  }
  const serialized = await Promise.all(visible.map(async (item) => {
    const own = item.proposedUsers.find(({ user }) => idOf(user) === idOf(actor));
    if (own && item.status === "PROPOSED") {
      const viewed = await GroupRecommendation.findOneAndUpdate(
        { _id: item._id, status: "PROPOSED", "proposedUsers.user": actor._id },
        { $set: { status: "VIEWED" } },
        { new: true },
      ).lean();
      if (viewed) Object.assign(item, viewed);
    }
    return serializeRecommendation(item, actor, trip, isOwner);
  }));
  return { items: serialized };
};

const getGroupRecommendation = async (recommendationId, actor) => {
  const { recommendation, trip, isOwner, isProposed } = await getRecommendationAndAccess(recommendationId, actor);
  if (["PROPOSED", "VIEWED"].includes(recommendation.status) && recommendation.expiresAt <= new Date()) {
    await GroupRecommendation.updateOne(
      { _id: recommendation._id, activeKey: trip.id, status: { $in: ["PROPOSED", "VIEWED"] } },
      { $set: { status: "EXPIRED", activeKey: null } },
    );
    recommendation.status = "EXPIRED";
    recommendation.activeKey = null;
  }
  if (isProposed && recommendation.status === "PROPOSED") {
    const viewed = await GroupRecommendation.findOneAndUpdate(
      { _id: recommendation._id, status: "PROPOSED", "proposedUsers.user": actor._id },
      { $set: { status: "VIEWED" } },
      { new: true },
    ).lean();
    if (viewed) Object.assign(recommendation, viewed);
  }
  return serializeRecommendation(recommendation, actor, trip, isOwner);
};

const revalidateAcceptance = async (recommendation, actor, trip) => {
  const freshActor = await User.findById(actor._id).select("_id accountStatus profile.travelPreferences updatedAt").lean();
  if (!freshActor || (freshActor.accountStatus && freshActor.accountStatus !== "ACTIVE")) {
    throw new HttpError(403, "An active account is required", "ACCOUNT_INELIGIBLE");
  }
  if (!ELIGIBLE_TRIP_STATUSES.includes(trip.status)) throw new HttpError(409, "The trip is no longer accepting recommendations", "TRIP_NOT_RECOMMENDABLE");
  const activeCount = await TripMember.countDocuments({ trip: trip.id, status: "ACTIVE" });
  const maximum = Number(trip.groupSize?.max || 0);
  if (activeCount + recommendation.proposedUsers.length > maximum) {
    await GroupRecommendation.updateOne(
      { _id: recommendation._id, status: { $in: ["PROPOSED", "VIEWED"] }, activeKey: trip.id },
      { $set: { status: "EXPIRED", activeKey: null } },
    );
    throw new HttpError(409, "Trip capacity changed; this recommendation expired", "RECOMMENDATION_CAPACITY_CHANGED");
  }
  const existing = await TripMember.exists({ trip: trip.id, user: actor._id });
  if (existing) throw new HttpError(409, "You are already associated with this trip", "ALREADY_TRIP_MEMBER");
  const activeMembers = await TripMember.find({ trip: trip.id, status: "ACTIVE" }).select("user").lean();
  const allIds = [...recommendation.proposedUsers.map(({ user }) => user), ...activeMembers.map(({ user }) => user)];
  const allUsers = await User.find({ _id: { $in: allIds } })
    .select("_id accountStatus profile.travelPreferences updatedAt")
    .lean();
  if (allUsers.length !== new Set(allIds.map(idOf)).size || allUsers.some((user) => user.accountStatus && user.accountStatus !== "ACTIVE")) {
    throw new HttpError(409, "A proposed traveller is no longer eligible", "GROUP_MEMBER_INELIGIBLE");
  }
  const blocks = await blockedPairsFor(allUsers);
  if (allUsers.some((user, index) => allUsers.slice(index + 1).some((other) => blocks.has(blockPairKey(user, other))))) {
    throw new HttpError(409, "A safety block prevents accepting this recommendation", "GROUP_BLOCKED");
  }
  for (const member of recommendation.proposedUsers) {
    const candidate = allUsers.find((user) => idOf(user) === idOf(member.user));
    const compatibility = await matchService.calculateTripCompatibility({ trip, user: candidate, currentMembers: activeCount });
    if (["destination", "dates", "budget"].some((dimension) => compatibility.dimensionStatus[dimension] === "MISMATCH")) {
      throw new HttpError(409, "A proposed traveller no longer meets trip requirements", "GROUP_CONSTRAINT_CHANGED");
    }
  }
  const activeUserIds = new Set(activeMembers.map(({ user }) => idOf(user)));
  const existingUsers = allUsers.filter((user) => activeUserIds.has(idOf(user)));
  for (const member of recommendation.proposedUsers) {
    const candidate = allUsers.find((user) => idOf(user) === idOf(member.user));
    if (!groupConstraintsAllow(trip, existingUsers, candidate, blocks)) {
      throw new HttpError(409, "Group date or budget constraints changed", "GROUP_CONSTRAINT_CHANGED");
    }
    existingUsers.push(candidate);
  }
};

const respondToRecommendation = async (recommendationId, actor, decision, req) => {
  const { recommendation, trip, isOwner, isProposed } = await getRecommendationAndAccess(recommendationId, actor, {
    allowBlocked: decision === "REJECTED",
  });
  if (isOwner || !isProposed) throw new HttpError(403, "Only a proposed traveller can respond for their own place", "GROUP_RESPONSE_FORBIDDEN");
  if (!["PROPOSED", "VIEWED"].includes(recommendation.status) || recommendation.expiresAt <= new Date()) {
    if (recommendation.expiresAt <= new Date()) {
      await GroupRecommendation.updateOne(
        { _id: recommendation._id, activeKey: trip.id, status: { $in: ["PROPOSED", "VIEWED"] } },
        { $set: { status: "EXPIRED", activeKey: null } },
      );
    }
    throw new HttpError(409, "This recommendation is no longer open for responses", "INVALID_RECOMMENDATION_STATE");
  }
  if (actor.accountStatus && actor.accountStatus !== "ACTIVE") throw new HttpError(403, "An active account is required", "ACCOUNT_INELIGIBLE");
  if (decision === "ACCEPTED") await revalidateAcceptance(recommendation, actor, trip);
  const now = new Date();
  let updated;
  if (decision === "REJECTED") {
    updated = await GroupRecommendation.findOneAndUpdate(
      {
        _id: recommendation._id,
        status: { $in: ["PROPOSED", "VIEWED"] },
        proposedUsers: { $elemMatch: { user: actor._id, status: "PENDING" } },
      },
      { $set: { "proposedUsers.$.status": "REJECTED", "proposedUsers.$.respondedAt": now, status: "REJECTED", activeKey: null } },
      { new: true },
    ).lean();
  } else {
    updated = await GroupRecommendation.findOneAndUpdate(
      {
        _id: recommendation._id,
        status: { $in: ["PROPOSED", "VIEWED"] },
        proposedUsers: { $elemMatch: { user: actor._id, status: "PENDING" } },
      },
      { $set: { "proposedUsers.$.status": "ACCEPTED", "proposedUsers.$.respondedAt": now } },
      { new: true },
    ).lean();
    if (updated && updated.proposedUsers.every(({ status }) => status === "ACCEPTED")) {
      updated = await GroupRecommendation.findOneAndUpdate(
        {
          _id: updated._id,
          status: { $in: ["PROPOSED", "VIEWED"] },
          proposedUsers: { $not: { $elemMatch: { status: { $ne: "ACCEPTED" } } } },
        },
        { $set: { status: "ACCEPTED", activeKey: null } },
        { new: true },
      ).lean() || updated;
    }
  }
  if (!updated) throw new HttpError(409, "Your response was already recorded or the recommendation has changed", "INVALID_RECOMMENDATION_STATE");
  await recordAudit(req, {
    action: decision === "ACCEPTED" ? "GROUP_RECOMMENDATION_ACCEPTED" : "GROUP_RECOMMENDATION_REJECTED",
    resourceType: "GroupRecommendation",
    resourceId: updated._id,
    metadata: { decision },
  });
  return serializeRecommendation(updated, actor, trip, false);
};

const acceptGroupRecommendation = (recommendationId, actor, req) =>
  respondToRecommendation(recommendationId, actor, "ACCEPTED", req);
const rejectGroupRecommendation = (recommendationId, actor, req) =>
  respondToRecommendation(recommendationId, actor, "REJECTED", req);

module.exports = {
  ALGORITHM_VERSION,
  MAX_CANDIDATES,
  MAX_PROPOSED_USERS,
  groupConstraintsAllow,
  aggregateBreakdown,
  recommendationReasons,
  buildGroup,
  buildEligibleUserQuery,
  generateGroupRecommendation,
  listTripRecommendations,
  getGroupRecommendation,
  acceptGroupRecommendation,
  rejectGroupRecommendation,
};
