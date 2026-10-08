const mongoose = require("mongoose");
const Destination = require("../models/Destination");
const { HttpError } = require("../utils/http");
const cache = require("./destination-cache.service");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cacheKey = (namespace, values) =>
  `${namespace}:${JSON.stringify(values)}`;
const pagination = (page, limit, total) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit),
});

const formatDestination = (destination) => {
  const value = destination.toObject ? destination.toObject() : destination;
  const images = value.images || [];
  return {
    ...value,
    id: (value._id || value.id).toString(),
    heroImage: images[0] || null,
    communityTrips: [],
    availableTravelBuddies: [],
  };
};

const findPage = async ({ query, sort, page, limit, key }) => {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const [items, total] = await Promise.all([
    Destination.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Destination.countDocuments(query),
  ]);
  return cache.set(key, {
    items: items.map(formatDestination),
    pagination: pagination(page, limit, total),
  });
};

const buildFilters = ({
  search,
  q,
  month,
  maxBudget,
  activity,
  category,
  seasonal,
  hasBudget,
}) => {
  const query = { published: true };
  const term = (search || q || "").trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    query.$or = [
      { name: pattern },
      { city: pattern },
      { state: pattern },
      { country: pattern },
      { description: pattern },
    ];
  }
  if (month || seasonal === "true")
    query.bestMonths = month || new Date().getMonth() + 1;
  if (maxBudget !== undefined || hasBudget) {
    query["estimatedBudget.min"] = {
      ...(hasBudget ? { $type: "number" } : {}),
      ...(maxBudget !== undefined ? { $lte: maxBudget } : {}),
    };
  }
  if (activity)
    query.activities = new RegExp(`^${escapeRegex(activity)}$`, "i");
  if (category === "ADVENTURE") query.adventure = true;
  else if (category) query.categories = category;
  return query;
};

const listDestinations = async (options = {}) => {
  const { page = 1, limit = 12, ...filters } = options;
  const query = buildFilters(filters);
  const sort =
    filters.maxBudget !== undefined
      ? { "estimatedBudget.min": 1, name: 1 }
      : { "popularity.score": -1, name: 1 };
  return findPage({
    query,
    sort,
    page,
    limit,
    key: cacheKey("list", { filters, page, limit }),
  });
};

const listByRank = async ({ kind, page = 1, limit = 12, filters = {} }) => {
  const query = buildFilters(filters);
  const sort =
    kind === "trending"
      ? { "popularity.trendScore": -1, "popularity.score": -1, name: 1 }
      : kind === "budget"
        ? { "estimatedBudget.min": 1, name: 1 }
        : { "popularity.score": -1, name: 1 };
  return findPage({
    query,
    sort,
    page,
    limit,
    key: cacheKey(kind, { filters, page, limit }),
  });
};

const listNearby = async ({ lat, lng, radiusKm, page = 1, limit = 12 }) => {
  const query = {
    published: true,
    coordinates: {
      $near: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
        $maxDistance: radiusKm * 1000,
      },
    },
  };
  const key = cacheKey("nearby", { lat, lng, radiusKm, page, limit });
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const [items, total] = await Promise.all([
    Destination.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Destination.countDocuments({
      published: true,
      coordinates: {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusKm / 6378.1],
        },
      },
    }),
  ]);
  return cache.set(key, {
    items: items.map(formatDestination),
    pagination: pagination(page, limit, total),
  });
};

const listAdventure = async (options = {}) =>
  listByRank({
    kind: "adventure",
    page: options.page,
    limit: options.limit,
    filters: { ...options, category: "ADVENTURE" },
  });

const listSeasonal = async (options = {}) => {
  const month = options.month || new Date().getMonth() + 1;
  return listByRank({
    kind: `seasonal-${month}`,
    page: options.page,
    limit: options.limit,
    filters: { ...options, month },
  });
};

const listBudget = async (options = {}) =>
  listByRank({
    kind: "budget",
    page: options.page,
    limit: options.limit,
    filters: { ...options, hasBudget: true },
  });

const getDestination = async (idOrSlug) => {
  const key = cacheKey("detail", idOrSlug);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const selector = mongoose.isValidObjectId(idOrSlug)
    ? { _id: idOrSlug, published: true }
    : { slug: idOrSlug.toLowerCase(), published: true };
  const destination = await Destination.findOne(selector).lean();
  if (!destination)
    throw new HttpError(
      404,
      "Destination was not found",
      "DESTINATION_NOT_FOUND",
    );
  return cache.set(key, formatDestination(destination));
};

module.exports = {
  listDestinations,
  listByRank,
  listNearby,
  listSeasonal,
  listBudget,
  listAdventure,
  getDestination,
  buildFilters,
  pagination,
};
