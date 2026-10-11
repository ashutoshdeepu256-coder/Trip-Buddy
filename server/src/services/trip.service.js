const mongoose = require("mongoose");
const Destination = require("../models/Destination");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const { HttpError } = require("../utils/http");
const { publishTripSchema } = require("../validators/trip.validator");
const tripImages = require("./trip-image.service");

const destinationProjection = "name slug country state city images coordinates description bestMonths estimatedBudget activities popularPlaces travelInformation";
const creatorProjection = "name profile.city profile.country verification.email.status verification.phone.status verification.identity.status createdAt";
const allowedUpdateFields = [
  "destination",
  "title",
  "description",
  "startDate",
  "endDate",
  "budget",
  "groupSize",
  "travelStyle",
  "interests",
  "activities",
  "accommodationPreference",
  "transportPreference",
  "foodPreference",
  "languages",
  "travelPace",
  "privacy",
  "location",
];

const idString = (value) => value?._id?.toString?.() || value?.toString?.() || null;
const isOwner = (trip, userId) => idString(trip.creator) === idString(userId);

const serializeTrip = (trip, { includeLocation = false } = {}) => {
  const value = trip.toObject ? trip.toObject() : trip;
  const creator = value.creator;
  const destination = value.destination;
  return {
    id: value._id.toString(),
    creator: creator && typeof creator === "object" && creator.name
      ? {
          id: idString(creator),
          name: creator.name,
          location: [creator.profile?.city, creator.profile?.country].filter(Boolean).join(", "),
          joinedAt: creator.createdAt || null,
          verification: {
            email: creator.verification?.email?.status === "VERIFIED",
            phone: creator.verification?.phone?.status === "VERIFIED",
            identity: creator.verification?.identity?.status === "VERIFIED",
          },
        }
      : idString(creator),
    destination: destination && typeof destination === "object" && destination.name
      ? {
          id: idString(destination),
          name: destination.name,
          slug: destination.slug,
          country: destination.country,
          state: destination.state,
          city: destination.city,
          images: destination.images,
          coordinates: destination.coordinates,
          description: destination.description,
          bestMonths: destination.bestMonths,
          estimatedBudget: destination.estimatedBudget,
          activities: destination.activities,
          popularPlaces: destination.popularPlaces,
          travelInformation: destination.travelInformation,
        }
      : idString(destination),
    title: value.title,
    description: value.description,
    startDate: value.startDate,
    endDate: value.endDate,
    budget: value.budget,
    groupSize: value.groupSize,
    travelStyle: value.travelStyle,
    interests: value.interests,
    activities: value.activities,
    accommodationPreference: value.accommodationPreference,
    transportPreference: value.transportPreference,
    foodPreference: value.foodPreference,
    languages: value.languages || [],
    travelPace: value.travelPace || null,
    privacy: value.privacy,
    status: value.status,
    images: (value.images || []).map(({ url, format, uploadedAt }) => ({ url, format, uploadedAt })),
    // Trip coordinates can reveal lodging or meeting places; expose them only
    // to the trip owner and current active members.
    location: includeLocation ? value.location : null,
    publishedAt: value.publishedAt,
    cancelledAt: value.cancelledAt,
    completedAt: value.completedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    isOwner: false,
    isMember: false,
  };
};

const populateTrip = (query) =>
  query.populate("creator", creatorProjection).populate("destination", destinationProjection);

const requireTripId = (tripId) => {
  if (!mongoose.isValidObjectId(tripId)) {
    throw new HttpError(400, "Invalid trip ID", "INVALID_TRIP_ID");
  }
};

const validateDestination = async (destinationId) => {
  if (!mongoose.isValidObjectId(destinationId)) {
    throw new HttpError(400, "A valid destination is required", "DESTINATION_NOT_FOUND");
  }
  const destination = await Destination.findOne({ _id: destinationId, published: true }).select("_id");
  if (!destination) throw new HttpError(404, "Destination was not found", "DESTINATION_NOT_FOUND");
  return destination._id;
};

const updateFields = (values) =>
  Object.fromEntries(allowedUpdateFields.filter((field) => Object.hasOwn(values, field)).map((field) => [field, values[field]]));

const findTripRecord = async (tripId) => {
  requireTripId(tripId);
  const trip = await populateTrip(Trip.findById(tripId));
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  return trip;
};

const hasMembership = async (tripId, userId) =>
  Boolean(await TripMember.exists({
    trip: tripId,
    user: userId,
    status: { $in: ["PENDING", "ACTIVE"] },
  }));

const hasActiveMembership = async (tripId, userId) =>
  Boolean(await TripMember.exists({ trip: tripId, user: userId, status: "ACTIVE" }));

const createTrip = async (user, values) => {
  const data = updateFields(values);
  if (data.destination) data.destination = await validateDestination(data.destination);
  const trip = await Trip.create({ ...data, creator: user._id, status: "DRAFT" });
  try {
    await TripMember.create({
      trip: trip._id,
      user: user._id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date(),
    });
  } catch (error) {
    await Trip.deleteOne({ _id: trip._id });
    throw error;
  }
  return serializeTrip(trip, { includeLocation: true });
};

const getAccessibleTrip = async (tripId, user = null) => {
  const trip = await findTripRecord(tripId);
  const owner = user && isOwner(trip, user._id);
  const member = user && await hasMembership(trip._id, user._id);
  if (owner || member) {
    const activeMember = Boolean(owner || await hasActiveMembership(trip._id, user._id));
    const serialized = serializeTrip(trip, { includeLocation: activeMember });
    serialized.isOwner = Boolean(owner);
    serialized.isMember = activeMember;
    return serialized;
  }
  if (trip.status === "DRAFT" || trip.status === "CANCELLED") {
    throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  if (trip.privacy === "PUBLIC") return serializeTrip(trip);
  if (trip.privacy === "COMMUNITY" && user) return serializeTrip(trip);
  throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
};

const getTripById = getAccessibleTrip;

const requireOwner = (trip, user) => {
  if (!isOwner(trip, user?._id)) {
    throw new HttpError(403, "Only the trip creator can perform this action", "TRIP_ACCESS_DENIED");
  }
};

const updateTrip = async (tripId, user, values) => {
  const trip = await findTripRecord(tripId);
  requireOwner(trip, user);
  if (["CANCELLED", "COMPLETED"].includes(trip.status)) {
    throw new HttpError(409, "This trip can no longer be edited", "INVALID_TRIP_STATUS");
  }
  const data = updateFields(values);
  if (Object.hasOwn(data, "destination") && data.destination) {
    data.destination = await validateDestination(data.destination);
  }
  Object.assign(trip, data);
  await trip.save();
  return getAccessibleTrip(trip._id, user);
};

const deleteTrip = async (tripId, user) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  requireOwner(trip, user);
  if (trip.status !== "DRAFT") {
    throw new HttpError(409, "Only draft trips can be deleted", "INVALID_TRIP_STATUS");
  }
  await tripImages.deleteTripImages(trip.images);
  await Promise.all([
    TripMember.deleteMany({ trip: trip._id }),
    Trip.deleteOne({ _id: trip._id }),
  ]);
  return { id: trip._id.toString(), deleted: true };
};

const publishTrip = async (tripId, user) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  requireOwner(trip, user);
  if (trip.status !== "DRAFT") {
    throw new HttpError(409, "Only draft trips can be published", "INVALID_TRIP_STATUS");
  }
  const result = publishTripSchema.safeParse({
    destination: idString(trip.destination),
    title: trip.title,
    description: trip.description,
    startDate: trip.startDate,
    endDate: trip.endDate,
    budget: trip.budget,
    groupSize: trip.groupSize,
    privacy: trip.privacy,
  });
  if (!result.success) {
    throw new HttpError(
      400,
      result.error.issues[0]?.message || "Complete required trip details before publishing",
      "TRIP_VALIDATION_ERROR",
    );
  }
  await validateDestination(idString(trip.destination));
  trip.status = "PUBLISHED";
  trip.publishedAt = new Date();
  await trip.save();
  return getAccessibleTrip(trip._id, user);
};

const cancelTrip = async (tripId, user) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  requireOwner(trip, user);
  if (trip.status === "CANCELLED") {
    throw new HttpError(409, "This trip is already cancelled", "TRIP_ALREADY_CANCELLED");
  }
  if (trip.status === "COMPLETED") {
    throw new HttpError(409, "Completed trips cannot be cancelled", "INVALID_TRIP_STATUS");
  }
  trip.status = "CANCELLED";
  trip.cancelledAt = new Date();
  await trip.save();
  return serializeTrip(trip, { includeLocation: true });
};

const transitions = {
  PUBLISHED: ["PLANNING"],
  PLANNING: ["CONFIRMED"],
  CONFIRMED: ["ONGOING"],
  ONGOING: ["COMPLETED"],
};

const changeTripStatus = async (tripId, user, status) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  requireOwner(trip, user);
  if (!transitions[trip.status]?.includes(status)) {
    throw new HttpError(409, "This trip status transition is not allowed", "INVALID_TRIP_STATUS");
  }
  const now = new Date();
  if (status === "ONGOING" && trip.startDate > now) {
    throw new HttpError(409, "A trip cannot begin before its start date", "INVALID_TRIP_STATUS");
  }
  if (status === "COMPLETED" && trip.endDate > now) {
    throw new HttpError(409, "A trip cannot be completed before its end date", "INVALID_TRIP_STATUS");
  }
  trip.status = status;
  if (status === "COMPLETED") trip.completedAt = now;
  await trip.save();
  return serializeTrip(trip, { includeLocation: true });
};

const getMyTrips = async (user, { page = 1, limit = 12, status } = {}) => {
  const query = { creator: user._id };
  if (status) query.status = status;
  const [trips, total] = await Promise.all([
    Trip.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("destination", "name slug country state city images")
      .lean(),
    Trip.countDocuments(query),
  ]);
  const totalPages = Math.ceil(total / limit);
  return {
    items: trips.map(serializeTrip).map((trip) => ({ ...trip, isOwner: true })),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

const addTripImages = async (tripId, user, files) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  requireOwner(trip, user);
  if (trip.status !== "DRAFT") throw new HttpError(409, "Images can only be changed on a draft trip", "INVALID_TRIP_STATUS");
  const uploaded = await tripImages.uploadTripImages({
    tripId: trip._id,
    userId: user._id,
    files,
    currentCount: trip.images.length,
  });
  try {
    trip.images.push(...uploaded);
    await trip.save();
  } catch (error) {
    await tripImages.deleteTripImages(uploaded);
    throw error;
  }
  return uploaded.map(({ url, format, uploadedAt }) => ({ url, format, uploadedAt }));
};

const removeTripImage = async (tripId, user, imageIndex) => {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  requireOwner(trip, user);
  if (trip.status !== "DRAFT") throw new HttpError(409, "Images can only be changed on a draft trip", "INVALID_TRIP_STATUS");
  if (imageIndex < 0 || imageIndex >= trip.images.length) {
    throw new HttpError(404, "Trip image was not found", "TRIP_IMAGE_NOT_FOUND");
  }
  const [image] = trip.images.splice(imageIndex, 1);
  await trip.save();
  await tripImages.deleteTripImage(image.publicId);
  return { removed: true };
};

module.exports = {
  createTrip,
  getTripById,
  getAccessibleTrip,
  updateTrip,
  deleteTrip,
  publishTrip,
  cancelTrip,
  getMyTrips,
  changeTripStatus,
  addTripImages,
  removeTripImage,
  serializeTrip,
  requireTripId,
  isOwner,
};
