const mongoose = require("mongoose");
const EmergencyContact = require("../models/EmergencyContact");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const Destination = require("../models/Destination");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const ownContact = (contactId, userId) => {
  if (!mongoose.isValidObjectId(contactId)) throw new HttpError(400, "Invalid contact ID", "INVALID_CONTACT_ID");
  return EmergencyContact.findOne({ _id: contactId, user: userId });
};

const contacts = async (user) => EmergencyContact.find({ user: user._id }).sort({ primary: -1, createdAt: 1 }).select("name relationship phone email primary createdAt updatedAt").lean();
const serializeContact = (item) => ({ id: idOf(item), name: item.name, relationship: item.relationship, phone: item.phone, email: item.email, primary: item.primary, createdAt: item.createdAt, updatedAt: item.updatedAt });

const saveContact = async (user, values, contactId = null, req = null) => {
  let contact;
  if (contactId) {
    contact = await ownContact(contactId, user._id);
    if (!contact) throw new HttpError(404, "Emergency contact was not found", "CONTACT_NOT_FOUND");
  } else {
    if (await EmergencyContact.countDocuments({ user: user._id }) >= 5) throw new HttpError(409, "You can save up to five emergency contacts", "CONTACT_LIMIT_REACHED");
    contact = new EmergencyContact({ user: user._id });
  }
  if (values.primary) await EmergencyContact.updateMany({ user: user._id }, { $set: { primary: false } });
  Object.assign(contact, values);
  await contact.save();
  if (!values.primary && !(await EmergencyContact.exists({ user: user._id, primary: true }))) {
    contact.primary = true;
    await contact.save();
  }
  if (req) await recordAudit(req, { action: contactId ? "EMERGENCY_CONTACT_UPDATED" : "EMERGENCY_CONTACT_CREATED", resourceType: "EmergencyContact", resourceId: contact._id });
  return serializeContact(contact);
};

const removeContact = async (user, contactId, req) => {
  const contact = await ownContact(contactId, user._id);
  if (!contact) throw new HttpError(404, "Emergency contact was not found", "CONTACT_NOT_FOUND");
  await contact.deleteOne();
  if (contact.primary) {
    const next = await EmergencyContact.findOne({ user: user._id }).sort({ createdAt: 1 });
    if (next) { next.primary = true; await next.save(); }
  }
  await recordAudit(req, { action: "EMERGENCY_CONTACT_REMOVED", resourceType: "EmergencyContact", resourceId: contact._id });
  return { id: idOf(contact), deleted: true };
};

const getSafetySettings = async (user) => {
  const stored = user.safetySettings || {};
  return { discoverable: stored.discoverable !== false, allowConnectionRequests: stored.allowConnectionRequests !== false };
};

const updateSafetySettings = async (user, values, req) => {
  user.safetySettings = { ...(user.safetySettings?.toObject?.() || user.safetySettings || {}), ...values };
  await user.save();
  await recordAudit(req, { action: "SAFETY_SETTINGS_UPDATED", resourceType: "User", resourceId: user._id, metadata: { fields: Object.keys(values) } });
  return getSafetySettings(user);
};

const loadPrivateTrip = async (tripId, userId) => {
  if (!mongoose.isValidObjectId(tripId)) throw new HttpError(400, "Invalid trip ID", "INVALID_TRIP_ID");
  const trip = await Trip.findById(tripId).select("creator destination title status startDate endDate safetyInfo").lean();
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  const member = await TripMember.findOne({ trip: trip._id, user: userId, status: "ACTIVE", $or: [{ joinedAt: null }, { joinedAt: { $lte: new Date() } }] }).select("role").lean();
  if (!member) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  return { trip, member };
};

const getTripSafety = async (tripId, user) => {
  const { trip } = await loadPrivateTrip(tripId, user._id);
  const [destination, fullTrip, contactsForUser] = await Promise.all([
    Destination.findById(trip.destination).select("name city country").lean(),
    Promise.resolve(trip),
    contacts(user),
  ]);
  const info = fullTrip?.safetyInfo || {};
  return {
    trip: { id: idOf(trip), title: trip.title, destination: destination ? { name: destination.name, city: destination.city, country: destination.country } : null, startDate: trip.startDate, endDate: trip.endDate },
    safetyInfo: { meetingPoint: info.meetingPoint || "", checklist: info.checklist || [], emergencyNotes: info.emergencyNotes || "", updatedAt: info.updatedAt || null },
    emergencyContacts: contactsForUser.map(serializeContact),
    localEmergencyServices: null,
    assistanceNotice: "TripBuddy does not monitor trips or contact emergency services. In immediate danger, contact the local emergency services directly.",
  };
};

const updateTripSafety = async (tripId, user, values, req) => {
  const { trip, member } = await loadPrivateTrip(tripId, user._id);
  if (idOf(trip.creator) !== idOf(user._id) || member.role !== "OWNER") throw new HttpError(403, "Only the trip creator can update safety information", "TRIP_SAFETY_FORBIDDEN");
  const safetyInfo = { ...(trip.safetyInfo || {}), ...values, updatedBy: user._id, updatedAt: new Date() };
  await Trip.updateOne({ _id: trip._id }, { $set: { safetyInfo } });
  await recordAudit(req, { action: "TRIP_SAFETY_UPDATED", resourceType: "Trip", resourceId: trip._id, metadata: { fields: Object.keys(values) } });
  return getTripSafety(trip._id, user);
};

module.exports = { contacts, saveContact, removeContact, getSafetySettings, updateSafetySettings, getTripSafety, updateTripSafety };
