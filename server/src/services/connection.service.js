const mongoose = require("mongoose");
const Connection = require("../models/Connection");
const User = require("../models/User");
const Trip = require("../models/Trip");
const { isInteractionBlocked, getInteractionBlockedIds } = require("./safety.service");
const { recordAudit } = require("./audit.service");
const { HttpError } = require("../utils/http");

const ACTIVE_TRIP_STATUSES = ["PUBLISHED", "PLANNING", "CONFIRMED"];
const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const pairData = (one, two, trip) => {
  const pairKey = [idOf(one), idOf(two)].sort().join(":");
  const tripKey = idOf(trip) || "GLOBAL";
  return { pairKey, tripKey, activeKey: `${pairKey}:${tripKey}` };
};

const activeActor = async (userId) => {
  const user = await User.findById(userId).select("_id accountStatus").lean();
  if (!user || (user.accountStatus && user.accountStatus !== "ACTIVE")) {
    throw new HttpError(403, "An active account is required", "ACCOUNT_INELIGIBLE");
  }
  return user;
};

const ensureNotBlocked = async (one, two) => {
  if (await isInteractionBlocked(one, two)) {
    throw new HttpError(404, "Connection was not found", "CONNECTION_NOT_FOUND");
  }
};

const ensureTripEligible = async (tripId, actorId) => {
  if (!tripId) return null;
  const trip = await Trip.findById(tripId).select("_id creator status privacy").lean();
  if (!trip || !ACTIVE_TRIP_STATUSES.includes(trip.status) || !["PUBLIC", "COMMUNITY"].includes(trip.privacy)) {
    throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  // A contextual request is tied to a trip the requester can legitimately access.
  if (trip.privacy === "COMMUNITY" && !trip.creator.equals(actorId)) {
    const TripMember = require("../models/TripMember");
    const member = await TripMember.exists({ trip: trip._id, user: actorId, status: { $in: ["PENDING", "ACTIVE"] } });
    if (!member) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  }
  return trip;
};

const ensureTripCompatibility = async (tripId, user) => {
  if (!tripId) return;
  // Always use the existing deterministic Phase 10 engine and its bounded cache.
  const matchService = require("./match.service");
  const compatibility = await matchService.getTripCompatibility(tripId, user);
  if (["destination", "dates", "budget"].some((dimension) => compatibility.dimensionStatus[dimension] === "MISMATCH")) {
    throw new HttpError(409, "Known destination, date, or budget preferences do not meet this trip's requirements", "TRIP_INCOMPATIBLE");
  }
};

const serialize = (doc, actorId) => {
  const other = idOf(doc.requester) === idOf(actorId) ? doc.recipient : doc.requester;
  const otherUser = other && typeof other === "object" && other.name
    ? { id: idOf(other), name: other.name }
    : { id: idOf(other), name: "TripBuddy traveller" };
  return {
    id: idOf(doc),
    requesterId: idOf(doc.requester),
    recipientId: idOf(doc.recipient),
    otherUser,
    trip: idOf(doc.trip) || null,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    respondedAt: doc.respondedAt,
    unmatchedAt: doc.unmatchedAt,
  };
};

const populateSafe = (query) => query
  .populate("requester", "name")
  .populate("recipient", "name");

const sendRequest = async (actor, values, req) => {
  await activeActor(actor._id);
  if (idOf(actor._id) === values.recipientId) throw new HttpError(400, "You cannot connect with yourself", "SELF_CONNECTION_FORBIDDEN");
  const recipient = await User.findById(values.recipientId).select("_id accountStatus").lean();
  if (!recipient || (recipient.accountStatus && recipient.accountStatus !== "ACTIVE")) {
    throw new HttpError(404, "Traveller was not found", "TRAVELLER_NOT_FOUND");
  }
  await ensureNotBlocked(actor._id, recipient._id);
  const trip = await ensureTripEligible(values.tripId, actor._id);
  if (trip) await ensureTripCompatibility(trip._id, actor);
  const keys = pairData(actor._id, recipient._id, trip?._id);
  if (await Connection.exists({ activeKey: keys.activeKey })) {
    throw new HttpError(409, "An active request or connection already exists", "DUPLICATE_CONNECTION");
  }
  let connection;
  try {
    connection = await Connection.create({
      requester: actor._id,
      recipient: recipient._id,
      trip: trip?._id || null,
      ...keys,
      status: "PENDING",
      audit: { requestedBy: actor._id },
    });
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, "An active request or connection already exists", "DUPLICATE_CONNECTION");
    throw error;
  }
  await recordAudit(req, { action: "CONNECTION_REQUESTED", resourceType: "Connection", resourceId: connection._id });
  return serialize(await populateSafe(Connection.findById(connection._id)), actor._id);
};

const listBy = async (actor, role, status, { page, limit }) => {
  await activeActor(actor._id);
  const filter = { [role]: actor._id, status };
  const [rows, total] = await Promise.all([
    populateSafe(Connection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
    Connection.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(total / limit);
  const counterpartIds = rows.map((row) => idOf(role === "requester" ? row.recipient : row.requester));
  const blocked = new Set(await getInteractionBlockedIds(actor._id, counterpartIds));
  const items = rows.filter((row) => !blocked.has(idOf(role === "requester" ? row.recipient : row.requester)))
    .map((row) => serialize(row, actor._id));
  return { items, page, limit, total, totalPages: Math.ceil(total / limit), hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

const listAccepted = async (actor, pagination) => {
  await activeActor(actor._id);
  const filter = { status: "ACCEPTED", $or: [{ requester: actor._id }, { recipient: actor._id }] };
  const [rows, total] = await Promise.all([
    populateSafe(Connection.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((pagination.page - 1) * pagination.limit).limit(pagination.limit)).lean(),
    Connection.countDocuments(filter),
  ]);
  const counterpartIds = rows.map((row) => idOf(idOf(row.requester) === idOf(actor._id) ? row.recipient : row.requester));
  const blocked = new Set(await getInteractionBlockedIds(actor._id, counterpartIds));
  return { ...paginateMeta(total, pagination), items: rows.filter((row) => !blocked.has(idOf(idOf(row.requester) === idOf(actor._id) ? row.recipient : row.requester))).map((row) => serialize(row, actor._id)) };
};

const paginateMeta = (total, { page, limit }) => {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

const getAuthorized = async (connectionId, actor) => {
  await activeActor(actor._id);
  if (!mongoose.isValidObjectId(connectionId)) throw new HttpError(400, "Invalid connection ID", "INVALID_CONNECTION_ID");
  const connection = await Connection.findById(connectionId).lean();
  if (!connection || ![idOf(connection.requester), idOf(connection.recipient)].includes(idOf(actor._id))) {
    throw new HttpError(404, "Connection was not found", "CONNECTION_NOT_FOUND");
  }
  await ensureNotBlocked(connection.requester, connection.recipient);
  return connection;
};

const getDetails = async (connectionId, actor) => {
  const connection = await getAuthorized(connectionId, actor);
  return serialize(await populateSafe(Connection.findById(connection._id)).lean(), actor._id);
};

const transition = async (connectionId, actor, action, req) => {
  await activeActor(actor._id);
  const connection = await getAuthorized(connectionId, actor);
  const actorId = idOf(actor._id);
  const fields = {
    accept: { role: "recipient", from: "PENDING", to: "ACCEPTED", auditField: "acceptedBy", action: "CONNECTION_ACCEPTED" },
    reject: { role: "recipient", from: "PENDING", to: "REJECTED", auditField: "rejectedBy", action: "CONNECTION_REJECTED" },
    cancel: { role: "requester", from: "PENDING", to: "CANCELLED", auditField: "cancelledBy", action: "CONNECTION_CANCELLED" },
    unmatch: { role: null, from: "ACCEPTED", to: "UNMATCHED", auditField: "unmatchedBy", action: "CONNECTION_UNMATCHED" },
  }[action];
  const isParticipantRole = fields.role ? idOf(connection[fields.role]) === actorId : [idOf(connection.requester), idOf(connection.recipient)].includes(actorId);
  if (!isParticipantRole) throw new HttpError(404, "Connection was not found", "CONNECTION_NOT_FOUND");
  if (connection.status !== fields.from) throw new HttpError(409, "This connection cannot make that state transition", "INVALID_CONNECTION_STATE");
  if (action === "accept") {
    const [requester, recipient] = await Promise.all([
      User.findById(connection.requester).select("_id accountStatus profile.travelPreferences updatedAt").lean(),
      User.findById(connection.recipient).select("_id accountStatus").lean(),
    ]);
    if ([requester, recipient].some((user) => !user || (user.accountStatus && user.accountStatus !== "ACTIVE"))) {
      throw new HttpError(409, "Both travellers must have active accounts", "ACCOUNT_INELIGIBLE");
    }
    await ensureNotBlocked(connection.requester, connection.recipient);
    await ensureTripEligible(connection.trip, connection.requester);
    await ensureTripEligible(connection.trip, connection.recipient);
    await ensureTripCompatibility(connection.trip, connection.requester);
  }
  const now = new Date();
  const set = { status: fields.to, respondedAt: now, [`audit.${fields.auditField}`]: actor._id };
  if (action === "unmatch") set.unmatchedAt = now;
  if (["REJECTED", "CANCELLED", "UNMATCHED"].includes(fields.to)) set.activeKey = null;
  const updated = await Connection.findOneAndUpdate(
    { _id: connection._id, status: fields.from, ...(fields.role ? { [fields.role]: actor._id } : { $or: [{ requester: actor._id }, { recipient: actor._id }] }) },
    { $set: set },
    { new: true, runValidators: true },
  );
  if (!updated) throw new HttpError(409, "This connection was already updated", "INVALID_CONNECTION_STATE");
  await recordAudit(req, { action: fields.action, resourceType: "Connection", resourceId: updated._id });
  return serialize(await populateSafe(Connection.findById(updated._id)).lean(), actor._id);
};

module.exports = {
  sendRequest,
  listAccepted,
  listReceived: (actor, pagination) => listBy(actor, "recipient", "PENDING", pagination),
  listSent: (actor, pagination) => listBy(actor, "requester", "PENDING", pagination),
  getDetails,
  accept: (id, actor, req) => transition(id, actor, "accept", req),
  reject: (id, actor, req) => transition(id, actor, "reject", req),
  cancel: (id, actor, req) => transition(id, actor, "cancel", req),
  unmatch: (id, actor, req) => transition(id, actor, "unmatch", req),
};
