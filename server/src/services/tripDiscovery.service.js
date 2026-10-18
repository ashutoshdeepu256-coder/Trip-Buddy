const mongoose = require("mongoose");
const Destination = require("../models/Destination");
const Trip = require("../models/Trip");
const { HttpError } = require("../utils/http");
const matchService = require("./match.service");
const safetyService = require("./safety.service");

const COMPATIBILITY_CANDIDATE_LIMIT = 500;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactInsensitive = (value) => new RegExp(`^${escapeRegex(value)}$`, "i");
const regexAlternatives = (values) => values.map((value) => new RegExp(`^${escapeRegex(value)}$`, "i"));

const sortOptions = {
  recent: { createdAt: -1, _id: -1 },
  date: { startDate: 1, createdAt: -1, _id: -1 },
  budget_low: { "budget.min": 1, createdAt: -1, _id: -1 },
  budget_high: { "budget.max": -1, createdAt: -1, _id: -1 },
  group_availability: { availableSlots: -1, createdAt: -1, _id: -1 },
  popularity: { currentMembers: -1, createdAt: -1, _id: -1 },
};

const lookupStages = [
  {
    $lookup: {
      from: "destinations",
      let: { destinationId: "$destination" },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ["$_id", "$$destinationId"] }, { $eq: ["$published", true] }] } } },
        { $project: { name: 1, slug: 1, country: 1, state: 1, city: 1, coordinates: 1, images: { $slice: ["$images", 1] } } },
      ],
      as: "destinationDoc",
    },
  },
  { $unwind: "$destinationDoc" },
  {
    $lookup: {
      from: "users",
      let: { creatorId: "$creator" },
      pipeline: [
        { $match: { $expr: { $eq: ["$_id", "$$creatorId"] }, "safetySettings.discoverable": { $ne: false } } },
        {
          $project: {
            name: 1,
            "profile.profileImage": 1,
            "verification.email.status": 1,
            "verification.phone.status": 1,
            "verification.identity.status": 1,
          },
        },
      ],
      as: "creatorDoc",
    },
  },
  { $unwind: "$creatorDoc" },
  {
    $lookup: {
      from: "tripmembers",
      let: { tripId: "$_id" },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ["$trip", "$$tripId"] }, { $eq: ["$status", "ACTIVE"] }] } } },
        { $count: "count" },
      ],
      as: "activeMemberCount",
    },
  },
  {
    $addFields: {
      currentMembers: { $ifNull: [{ $arrayElemAt: ["$activeMemberCount.count", 0] }, 0] },
    },
  },
  {
    $addFields: {
      availableSlots: { $max: [{ $subtract: ["$groupSize.max", "$currentMembers"] }, 0] },
    },
  },
  { $match: { availableSlots: { $gt: 0 } } },
];

const buildDiscoveryPipeline = (filters, user = null, destinationIds = null) => {
  const match = {
    status: { $in: ["PUBLISHED", "PLANNING", "CONFIRMED"] },
    moderationVisibility: { $ne: "HIDDEN" },
    privacy: user ? { $in: ["PUBLIC", "COMMUNITY"] } : "PUBLIC",
  };
  if (destinationIds) match.destination = { $in: destinationIds };
  if (filters.startDate && filters.endDate) {
    const flexibilityMs = filters.dateFlexibility * 24 * 60 * 60 * 1000;
    match.startDate = { $lte: new Date(filters.endDate.getTime() + flexibilityMs) };
    match.endDate = { $gte: new Date(filters.startDate.getTime() - flexibilityMs) };
  }
  if (filters.budgetMin !== undefined || filters.budgetMax !== undefined) {
    const flexibility = filters.budgetFlexibility / 100;
    match["budget.currency"] = filters.budgetCurrency;
    if (filters.budgetMin !== undefined) {
      match["budget.max"] = { $gte: filters.budgetMin * (1 - flexibility) };
    }
    if (filters.budgetMax !== undefined) {
      match["budget.min"] = { $lte: filters.budgetMax * (1 + flexibility) };
    }
  }
  for (const [filterName, tripField] of [
    ["travelStyle", "travelStyle"],
    ["interests", "interests"],
    ["activities", "activities"],
    ["accommodation", "accommodationPreference"],
    ["transport", "transportPreference"],
    ["foodPreference", "foodPreference"],
    ["language", "languages"],
  ]) {
    if (filters[filterName]?.length) {
      match[tripField] = { $in: regexAlternatives(filters[filterName]) };
    }
  }

  const pipeline = filters.lat !== undefined
    ? [{
        $geoNear: {
          near: { type: "Point", coordinates: [filters.lng, filters.lat] },
          distanceField: "distanceMeters",
          maxDistance: (filters.radiusKm || 100) * 1000,
          spherical: true,
          key: "location",
          query: match,
        },
      }, ...lookupStages]
    : [{ $match: match }, ...lookupStages];
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), "i");
    pipeline.push({
      $match: {
        $or: [
          { title: pattern },
          { description: pattern },
          { "destinationDoc.name": pattern },
          { "destinationDoc.city": pattern },
          { "destinationDoc.country": pattern },
        ],
      },
    });
  }
  if (filters.groupSize !== undefined) {
    pipeline.push({ $match: { availableSlots: { $gte: filters.groupSize } } });
  }
  if (filters.groupMin !== undefined || filters.groupMax !== undefined) {
    const availableSlots = {};
    if (filters.groupMin !== undefined) availableSlots.$gte = filters.groupMin;
    if (filters.groupMax !== undefined) availableSlots.$lte = filters.groupMax;
    pipeline.push({ $match: { availableSlots } });
  }
  if (filters.verifiedOnly) {
    pipeline.push({ $match: { "creatorDoc.verification.identity.status": "VERIFIED" } });
  }
  return pipeline;
};

const resolveDestinationIds = async (destination) => {
  if (!destination) return null;
  const selectors = [
    { slug: destination.toLocaleLowerCase() },
    { name: exactInsensitive(destination) },
  ];
  if (/^[a-f\d]{24}$/i.test(destination)) selectors.unshift({ _id: new mongoose.Types.ObjectId(destination) });
  const matches = await Destination.find({ published: true, $or: selectors }).select("_id").limit(100).lean();
  return matches.map(({ _id }) => _id);
};

const safeCard = (trip) => {
  const creatorVerification = trip.creatorDoc.verification || {};
  const images = trip.images || [];
  return {
    id: trip._id.toString(),
    title: trip.title,
    destination: {
      id: trip.destinationDoc._id.toString(),
      name: trip.destinationDoc.name,
      slug: trip.destinationDoc.slug,
      country: trip.destinationDoc.country,
      state: trip.destinationDoc.state,
      city: trip.destinationDoc.city,
      coordinates: trip.destinationDoc.coordinates || null,
    },
    startDate: trip.startDate,
    endDate: trip.endDate,
    budget: trip.budget,
    groupSize: trip.groupSize,
    currentMembers: trip.currentMembers,
    availableSlots: trip.availableSlots,
    travelStyle: trip.travelStyle || [],
    interests: trip.interests || [],
    activities: trip.activities || [],
    accommodationPreference: trip.accommodationPreference || [],
    transportPreference: trip.transportPreference || [],
    foodPreference: trip.foodPreference || [],
    languages: trip.languages || [],
    travelPace: trip.travelPace || null,
    coverImage: images[0] ? { url: images[0].url, format: images[0].format } : null,
    creator: {
      id: trip.creatorDoc._id.toString(),
      name: trip.creatorDoc.name,
      profileImage: trip.creatorDoc.profile?.profileImage || null,
      verificationStatus: {
        email: creatorVerification.email?.status === "VERIFIED",
        phone: creatorVerification.phone?.status === "VERIFIED",
        identity: creatorVerification.identity?.status === "VERIFIED",
      },
    },
    privacy: trip.privacy,
    status: trip.status,
    createdAt: trip.createdAt,
    ...(Number.isFinite(trip.distanceMeters) ? { distanceKm: Math.round((trip.distanceMeters / 1000) * 10) / 10 } : {}),
  };
};

const discoverTrips = async (filters, user = null) => {
  if (filters.ageMin !== undefined || filters.ageMax !== undefined) {
    throw new HttpError(422, "Age filtering is unavailable because TripBuddy does not currently collect date of birth or age-display consent", "AGE_FILTER_UNAVAILABLE");
  }
  if (filters.sort === "compatibility") {
    if (!user) {
      throw new HttpError(401, "Sign in to sort trips by compatibility", "UNAUTHENTICATED");
    }
    const destinationIds = await resolveDestinationIds(filters.destination);
    const pipeline = buildDiscoveryPipeline(filters, user, destinationIds);
    const eligibilityMatch = pipeline.find((stage) => stage.$match)?.$match || pipeline[0].$geoNear.query;
    eligibilityMatch.creator = { $ne: user._id };
    pipeline.push(
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: COMPATIBILITY_CANDIDATE_LIMIT + 1 },
      {
        $project: {
          _id: 1,
          title: 1,
          startDate: 1,
          endDate: 1,
          budget: 1,
          groupSize: 1,
          travelStyle: 1,
          interests: 1,
          activities: 1,
          accommodationPreference: 1,
          transportPreference: 1,
          foodPreference: 1,
          languages: 1,
          travelPace: 1,
          privacy: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          currentMembers: 1,
          availableSlots: 1,
          distanceMeters: 1,
          creatorDoc: 1,
          destinationDoc: 1,
          images: { $slice: ["$images", 1] },
        },
      },
    );
    const candidates = await Trip.aggregate(pipeline);
    const truncated = candidates.length > COMPATIBILITY_CANDIDATE_LIMIT;
    const cappedCandidates = candidates.slice(0, COMPATIBILITY_CANDIDATE_LIMIT);
    const blockedCreatorIds = new Set(await safetyService.getInteractionBlockedIds(
      user._id,
      cappedCandidates.map((candidate) => candidate.creatorDoc._id),
    ));
    const scored = await Promise.all(
      cappedCandidates.filter((candidate) => !blockedCreatorIds.has(candidate.creatorDoc._id.toString())).map(async (candidate) => {
        const compatibility = await matchService.calculateTripCompatibility({
          trip: { ...candidate, destination: candidate.destinationDoc },
          user,
          currentMembers: candidate.currentMembers,
        });
        return {
          item: safeCard(candidate),
          score: compatibility.overallScore,
          category: compatibility.category,
        };
      }),
    );
    scored.sort((left, right) =>
      right.score - left.score ||
      new Date(right.item.createdAt).getTime() - new Date(left.item.createdAt).getTime() ||
      right.item.id.localeCompare(left.item.id),
    );
    const { page, limit } = filters;
    const total = scored.length;
    const totalPages = Math.ceil(total / limit);
    return {
      items: scored.slice((page - 1) * limit, page * limit).map(({ item, score, category }) => ({
        ...item,
        compatibility: { score, category },
      })),
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      truncated,
      candidateLimit: COMPATIBILITY_CANDIDATE_LIMIT,
    };
  }
  const destinationIds = await resolveDestinationIds(filters.destination);
  const pipeline = buildDiscoveryPipeline(filters, user, destinationIds);
  const { page, limit } = filters;
  pipeline.push({
    $facet: {
      items: [
        { $sort: filters.lat !== undefined ? { distanceMeters: 1, _id: 1 } : sortOptions[filters.sort] },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            title: 1,
            startDate: 1,
            endDate: 1,
            budget: 1,
            groupSize: 1,
            travelStyle: 1,
            interests: 1,
            activities: 1,
            accommodationPreference: 1,
            transportPreference: 1,
            foodPreference: 1,
            languages: 1,
            privacy: 1,
            status: 1,
            createdAt: 1,
            currentMembers: 1,
            availableSlots: 1,
            distanceMeters: 1,
            creatorDoc: 1,
            destinationDoc: 1,
            images: { $slice: ["$images", 1] },
          },
        },
      ],
      metadata: [{ $count: "total" }],
    },
  });
  const [result = { items: [], metadata: [] }] = await Trip.aggregate(pipeline);
  const total = result.metadata[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);
  return {
    items: result.items.map(safeCard),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

module.exports = {
  COMPATIBILITY_CANDIDATE_LIMIT,
  discoverTrips,
  buildDiscoveryPipeline,
  resolveDestinationIds,
  safeCard,
  sortOptions,
};
