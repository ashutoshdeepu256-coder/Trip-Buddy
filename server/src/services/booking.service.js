const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const Itinerary = require("../models/Itinerary");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");
const providers = require("./bookingProviders.service");

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || null;
const serialize = (booking) => {
  const value = booking.toObject ? booking.toObject() : booking;
  return {
    id: idOf(value._id), tripId: idOf(value.trip), itineraryId: idOf(value.itinerary),
    category: value.category, provider: value.provider, serviceName: value.serviceName,
    destination: value.destination, externalUrl: value.externalUrl,
    startDate: value.startDate, endDate: value.endDate, travellers: value.travellers,
    userEstimate: value.userEstimate?.amount == null ? null : { amount: value.userEstimate.amount, currency: value.userEstimate.currency, source: "USER_ESTIMATE" },
    travellerNote: value.travellerNote, status: value.status,
    statusHistory: value.statusHistory, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
};

const categories = () => ({ categories: providers.categories(), services: providers.list() });
const services = (category) => providers.list(category);
const service = (id) => providers.get(id);

const ownedTrip = async (tripId, actor) => {
  if (!tripId) return null;
  const trip = await Trip.findById(tripId).select("creator").lean();
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  if (idOf(trip.creator) !== idOf(actor._id)) {
    const member = await TripMember.exists({ trip: tripId, user: actor._id, status: "ACTIVE" });
    if (!member) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  return trip;
};

const create = async (req, data) => {
  const idempotencyKey = req.get("idempotency-key");
  if (!idempotencyKey || !/^[\w-]{8,64}$/.test(idempotencyKey)) throw new HttpError(400, "A valid Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
  const previous = await Booking.findOne({ owner: req.user._id, idempotencyKey });
  if (previous) return { booking: serialize(previous), duplicate: true };

  const tripId = data.tripId || null;
  const itineraryId = data.itineraryId || null;
  if (tripId && !mongoose.isValidObjectId(tripId)) throw new HttpError(400, "Invalid Trip ID", "INVALID_TRIP_ID");
  const trip = await ownedTrip(tripId, req.user);
  let itinerary = null;
  if (itineraryId) {
    itinerary = await Itinerary.findOne({ _id: itineraryId, owner: req.user._id }).select("trip").lean();
    if (!itinerary) throw new HttpError(404, "Itinerary was not found", "ITINERARY_NOT_FOUND");
    if (tripId && idOf(itinerary.trip) !== idOf(tripId)) throw new HttpError(400, "The itinerary must belong to the selected Trip", "TRIP_ITINERARY_MISMATCH");
  }
  const resolvedTripId = tripId || itinerary?.trip || null;
  if (!trip && resolvedTripId) await ownedTrip(resolvedTripId, req.user);

  const { entry, url } = providers.createExternalUrl(data.serviceId, data.destination, data.startDate, data.endDate, data.travellers);
  const status = data.mode;
  let booking;
  try {
    booking = await Booking.create({
      owner: req.user._id, trip: resolvedTripId, itinerary: itineraryId,
      category: entry.category, provider: entry.provider, serviceName: data.serviceName,
      destination: data.destination, externalUrl: url,
      startDate: new Date(`${data.startDate}T00:00:00.000Z`), endDate: new Date(`${data.endDate}T00:00:00.000Z`),
      travellers: data.travellers,
      userEstimate: data.userEstimate ? { ...data.userEstimate, currency: data.userEstimate.currency.toUpperCase(), source: "USER_ESTIMATE" } : undefined,
      travellerNote: data.travellerNote, status, statusHistory: [{ status, note: status === "EXTERNAL_HANDOFF" ? "External search link prepared; no reservation was made by TripBuddy." : "Saved as a user-recorded travel request." }], idempotencyKey,
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await Booking.findOne({ owner: req.user._id, idempotencyKey });
      if (duplicate) return { booking: serialize(duplicate), duplicate: true };
    }
    throw error;
  }
  await recordAudit(req, { action: "BOOKING_CREATED", resourceType: "BOOKING", resourceId: booking._id, metadata: { category: booking.category, status } });
  return { booking: serialize(booking), duplicate: false };
};

const list = async (actor, { page, limit, status }) => {
  const query = { owner: actor._id, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    Booking.find(query).sort({ startDate: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Booking.countDocuments(query),
  ]);
  return { items: items.map(serialize), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const get = async (actor, id) => {
  const booking = await Booking.findOne({ _id: id, owner: actor._id });
  if (!booking) throw new HttpError(404, "Booking record was not found", "BOOKING_NOT_FOUND");
  return serialize(booking);
};

const update = async (req, id, data) => {
  const booking = await Booking.findOne({ _id: id, owner: req.user._id });
  if (!booking) throw new HttpError(404, "Booking record was not found", "BOOKING_NOT_FOUND");
  if (booking.status === "CANCELLED") throw new HttpError(409, "A cancelled record cannot be updated", "BOOKING_CANCELLED");
  booking.travellerNote = data.travellerNote;
  await booking.save();
  await recordAudit(req, { action: "BOOKING_UPDATED", resourceType: "BOOKING", resourceId: booking._id, metadata: {} });
  return serialize(booking);
};

const cancel = async (req, id) => {
  const booking = await Booking.findOne({ _id: id, owner: req.user._id });
  if (!booking) throw new HttpError(404, "Booking record was not found", "BOOKING_NOT_FOUND");
  if (booking.status === "CANCELLED") return serialize(booking);
  const previous = booking.status;
  booking.status = "CANCELLED";
  booking.statusHistory.push({ status: "CANCELLED", note: previous === "EXTERNAL_HANDOFF" ? "TripBuddy record cancelled. Contact the external provider separately if you completed a reservation." : "User-recorded request cancelled." });
  await booking.save();
  await recordAudit(req, { action: "BOOKING_CANCELLED", resourceType: "BOOKING", resourceId: booking._id, metadata: { previousStatus: previous } });
  return serialize(booking);
};

module.exports = { categories, services, service, create, list, get, update, cancel };
