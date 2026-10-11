const mongoose = require("mongoose");
const crypto = require("node:crypto");
const Itinerary = require("../models/Itinerary");
const ItineraryRevision = require("../models/ItineraryRevision");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const User = require("../models/User");
const { HttpError } = require("../utils/http");
const { recordAudit } = require("./audit.service");
const { safeSerialize } = require("./itinerary.service");
const { planSchema } = require("../validators/itinerary.validator");

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const asPlain = (record) => record.toObject ? record.toObject() : record;
const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = () => new mongoose.Types.ObjectId().toString();
const sections = ["morning", "afternoon", "evening"];
const stableValue = (value) => Array.isArray(value) ? value.map(stableValue) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])) : value;
const makeIdempotencyKey = ({ id, actorId, operation, expectedRevision, intent }) => crypto.createHash("sha256").update(JSON.stringify(stableValue([idOf(id), idOf(actorId), operation, expectedRevision, intent]))).digest("hex");

const requireItinerary = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Invalid itinerary ID", "INVALID_ITINERARY_ID");
  const itinerary = await Itinerary.findById(id);
  if (!itinerary) throw new HttpError(404, "Itinerary was not found", "ITINERARY_NOT_FOUND");
  return itinerary;
};

const requireManager = async (itinerary, actor) => {
  if (!itinerary.trip) throw new HttpError(409, "Collaboration requires a Trip-linked itinerary", "TRIP_LINK_REQUIRED");
  const [trip, user] = await Promise.all([
    Trip.findById(itinerary.trip).select("creator").lean(),
    User.findById(actor._id).select("+role accountStatus").lean(),
  ]);
  if (!trip) throw new HttpError(404, "Trip was not found", "TRIP_NOT_FOUND");
  const isTripCreator = idOf(trip.creator) === idOf(actor._id);
  if (!isTripCreator && user?.role !== "ADMIN") throw new HttpError(403, "Only the Trip creator or an administrator can manage collaboration", "COLLABORATION_MANAGEMENT_FORBIDDEN");
};

const requireAccess = async (itinerary, actor, { edit = false, manage = false } = {}) => {
  if (!itinerary.trip || !itinerary.collaborationEnabled) {
    if (manage && itinerary.trip) {
      await requireManager(itinerary, actor);
      return { role: "OWNER", itinerary };
    }
    if (idOf(itinerary.owner) === idOf(actor._id)) return { role: "OWNER", itinerary };
    throw new HttpError(404, "Shared itinerary was not found", "ITINERARY_NOT_FOUND");
  }
  const [member, trip, user] = await Promise.all([
    TripMember.findOne({ trip: itinerary.trip, user: actor._id, status: "ACTIVE" }).select("role").lean(),
    Trip.findById(itinerary.trip).select("creator").lean(),
    User.findById(actor._id).select("+role accountStatus").lean(),
  ]);
  const isTripCreator = idOf(trip?.creator) === idOf(actor._id);
  const manager = isTripCreator || user?.role === "ADMIN";
  if ((!member && !(manage && manager)) || (user?.accountStatus && user.accountStatus !== "ACTIVE")) throw new HttpError(404, "Shared itinerary was not found", "ITINERARY_NOT_FOUND");
  const grant = itinerary.collaborators.find((entry) => idOf(entry.user) === idOf(actor._id));
  if (manage && !manager) throw new HttpError(403, "Only the Trip creator or an administrator can manage collaboration", "COLLABORATION_MANAGEMENT_FORBIDDEN");
  if (!manager && !grant) throw new HttpError(404, "Shared itinerary was not found", "ITINERARY_NOT_FOUND");
  const role = manager ? "OWNER" : grant.role;
  if (edit && role !== "OWNER" && role !== "EDITOR") throw new HttpError(403, "Viewer access cannot edit this itinerary", "ITINERARY_READ_ONLY");
  return { role, itinerary };
};

const withStableIds = (plan) => {
  const value = clone(plan);
  for (const day of value.days) {
    day.id ||= makeId();
    for (const section of sections) for (const activity of day[section].activities) activity.id ||= makeId();
  }
  return value;
};

const recalculate = (plan) => {
  for (const day of plan.days) {
    const costs = sections.flatMap((section) => day[section].activities).map((activity) => activity.estimatedCost);
    day.estimatedTotal = {
      amount: costs.every((cost) => cost.amount !== null) ? costs.reduce((sum, cost) => sum + cost.amount, 0) : null,
      currency: costs[0]?.currency || day.estimatedTotal.currency,
    };
  }
  const costs = sections.flatMap((section) => plan.days.flatMap((day) => day[section].activities)).map((activity) => activity.estimatedCost);
  const currency = costs[0]?.currency || plan.days[0]?.estimatedTotal.currency || "USD";
  const amount = costs.every((cost) => cost.amount !== null) ? costs.reduce((sum, cost) => sum + cost.amount, 0) : null;
  const existing = plan.budgetBreakdown.find((entry) => entry.category === "Activities");
  if (existing) existing.estimatedCost = { amount, currency };
  else if (plan.budgetBreakdown.length < 10) plan.budgetBreakdown.push({ category: "Activities", estimatedCost: { amount, currency } });
  return plan;
};

const revisionSnapshot = (itinerary) => ({ plan: clone(itinerary.plan), title: itinerary.title, budget: clone(itinerary.budget), startDate: itinerary.startDate, endDate: itinerary.endDate });
const conflict = (itinerary) => new HttpError(409, "This itinerary changed since you loaded it. Reload or reconcile against the latest revision.", "REVISION_CONFLICT", { latestRevision: itinerary.revision, latest: safeSerialize(itinerary) });

const mutate = async ({ req, id, expectedRevision, operation, resourceType, resourceId = null, edit, manage = false, intent = {} }) => {
  const itinerary = await requireItinerary(id);
  if (manage) await requireManager(itinerary, req.user);
  await requireAccess(itinerary, req.user, { edit: !manage, manage });
  const idempotencyKey = makeIdempotencyKey({ id, actorId: req.user._id, operation, expectedRevision, intent });
  const previous = await ItineraryRevision.findOne({ itinerary: id, actor: req.user._id, idempotencyKey }).select("revision").lean();
  if (previous) return { itinerary: safeSerialize(itinerary), revision: itinerary.revision, duplicate: true };
  if (itinerary.revision !== expectedRevision) throw conflict(itinerary);
  const next = asPlain(itinerary);
  if (next.collaborationEnabled) next.plan = withStableIds(next.plan);
  const editResult = await edit(next);
  const affectedResourceId = editResult?.resourceId || resourceId;
  if (next.collaborationEnabled) {
    const parsedPlan = planSchema.safeParse(next.plan);
    const activities = next.plan.days.flatMap((day) => sections.flatMap((section) => day[section].activities));
    const validIds = next.plan.days.every((day) => mongoose.isValidObjectId(day.id) && sections.every((section) => day[section].activities.every((activity) => mongoose.isValidObjectId(activity.id))));
    const validDurations = next.plan.days.every((day) => sections.flatMap((section) => day[section].activities).reduce((total, activity) => total + activity.durationMinutes, 0) <= 600);
    const validCosts = activities.every((activity) => activity.estimatedCost.currency === next.budget.currency);
    const validDates = next.plan.days.every((day, index) => day.day === index + 1 && day.date === new Date(next.startDate.getTime() + index * 86400000).toISOString().slice(0, 10));
    const expectedDays = Math.floor((next.endDate - next.startDate) / 86400000) + 1;
    if (!parsedPlan.success || !validIds || !validDurations || !validCosts || !validDates || next.plan.days.length !== expectedDays || expectedDays > 31) throw new HttpError(400, "The edited itinerary contains invalid activity or date data", "INVALID_ITINERARY_PLAN");
  }
  const session = await mongoose.startSession();
  let saved;
  try {
    await session.withTransaction(async () => {
      const updated = await Itinerary.findOneAndUpdate(
        { _id: id, revision: expectedRevision },
        { $set: { plan: next.plan, collaborationEnabled: next.collaborationEnabled, collaborators: next.collaborators, ...(next.title !== itinerary.title ? { title: next.title } : {}), ...(next.budget !== itinerary.budget ? { budget: next.budget } : {}), ...(next.startDate.getTime() !== itinerary.startDate.getTime() ? { startDate: next.startDate } : {}), ...(next.endDate.getTime() !== itinerary.endDate.getTime() ? { endDate: next.endDate } : {}) }, $inc: { revision: 1 } },
        { new: true, runValidators: true, session },
      );
      if (!updated) {
        const latest = await Itinerary.findById(id).session(session);
        throw conflict(latest || itinerary);
      }
      await ItineraryRevision.create([{
        itinerary: id,
        revision: updated.revision,
        actor: req.user._id,
        operation,
        resourceType,
        resourceId: affectedResourceId,
        idempotencyKey,
        snapshot: revisionSnapshot(updated),
      }], { session });
      saved = updated;
    });
  } catch (error) {
    const retry = await ItineraryRevision.findOne({ itinerary: id, actor: req.user._id, idempotencyKey }).select("revision").lean();
    if (retry) {
      const latest = await Itinerary.findById(id);
      await requireAccess(latest || itinerary, req.user, { edit: !manage, manage });
      return { itinerary: safeSerialize(latest || itinerary), revision: latest?.revision || itinerary.revision, duplicate: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }
  await recordAudit(req, { action: `ITINERARY_${operation}`, resourceType: "ITINERARY", resourceId: saved._id, metadata: { revision: saved.revision, resourceType, resourceId: affectedResourceId } });
  return { itinerary: safeSerialize(saved), revision: saved.revision, duplicate: false };
};

const enable = async (req, id, { enabled, expectedRevision }) => mutate({ req, id, expectedRevision, operation: enabled ? "COLLABORATION_ENABLED" : "COLLABORATION_DISABLED", resourceType: "COLLABORATION", manage: true, edit: async (next) => {
  if (enabled && !next.trip) throw new HttpError(409, "Collaboration requires a Trip-linked itinerary", "TRIP_LINK_REQUIRED");
  next.collaborationEnabled = enabled;
  if (!enabled) next.collaborators = [];
  if (enabled) next.plan = withStableIds(next.plan);
}, intent: { enabled } });

const collaborators = async (actor, id) => {
  const itinerary = await requireItinerary(id);
  await requireAccess(itinerary, actor);
  if (!itinerary.collaborationEnabled) return { enabled: false, collaborators: [], revision: itinerary.revision };
  const rows = await Promise.all(itinerary.collaborators.map(async (entry) => {
    const member = await TripMember.findOne({ trip: itinerary.trip, user: entry.user, status: "ACTIVE" }).select("user").lean();
    if (!member) return null;
    const user = await User.findById(entry.user).select("name accountStatus").lean();
    return user?.accountStatus === "ACTIVE" ? { userId: idOf(entry.user), name: user.name, role: entry.role, grantedAt: entry.grantedAt } : null;
  }));
  return { enabled: true, collaborators: rows.filter(Boolean), revision: itinerary.revision };
};

const grant = async (req, id, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "COLLABORATOR_GRANTED", resourceType: "COLLABORATION", resourceId: data.userId, manage: true, edit: async (next) => {
  if (!next.collaborationEnabled) throw new HttpError(409, "Enable collaboration before granting access", "COLLABORATION_DISABLED");
  if (idOf(req.user._id) === data.userId) throw new HttpError(400, "You cannot grant access to yourself", "SELF_GRANT_FORBIDDEN");
  const [member, user] = await Promise.all([
    TripMember.findOne({ trip: next.trip, user: data.userId, status: "ACTIVE" }).select("user").lean(),
    User.findById(data.userId).select("accountStatus").lean(),
  ]);
  if (!member || user?.accountStatus !== "ACTIVE") throw new HttpError(400, "Access can be granted only to an eligible active Trip member", "ACTIVE_MEMBER_REQUIRED");
  const current = next.collaborators.find((entry) => idOf(entry.user) === data.userId);
  if (current) { current.role = data.role; current.grantedBy = req.user._id; current.grantedAt = new Date(); }
  else next.collaborators.push({ user: data.userId, role: data.role, grantedBy: req.user._id, grantedAt: new Date() });
}, intent: data });

const revoke = async (req, id, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "COLLABORATOR_REVOKED", resourceType: "COLLABORATION", resourceId: data.userId, manage: true, edit: async (next) => {
  next.collaborators = next.collaborators.filter((entry) => idOf(entry.user) !== data.userId);
}, intent: data });

const getShared = async (actor, id) => {
  const itinerary = await requireItinerary(id);
  const access = await requireAccess(itinerary, actor);
  return { itinerary: safeSerialize(itinerary), revision: itinerary.revision, role: access.role };
};

const listShared = async (actor) => {
  const memberships = await TripMember.find({ user: actor._id, status: "ACTIVE" }).select("trip").lean();
  const tripIds = memberships.map((entry) => entry.trip);
  if (!tripIds.length) return { items: [] };
  const records = await Itinerary.find({ trip: { $in: tripIds }, collaborationEnabled: true, $or: [{ "collaborators.user": actor._id }, { owner: actor._id }] }).sort({ updatedAt: -1 }).limit(100);
  const items = [];
  for (const record of records) {
    try {
      const access = await requireAccess(record, actor);
      items.push({ ...safeSerialize(record), role: access.role });
    } catch { /* Membership or permission may have been revoked after the query. */ }
  }
  return { items };
};

const locateDay = (plan, dayId) => {
  const day = plan.days.find((entry) => entry.id === dayId);
  if (!day) throw new HttpError(404, "Itinerary day was not found", "ITINERARY_DAY_NOT_FOUND");
  return day;
};
const locateActivities = (day, section) => {
  if (!sections.includes(section)) throw new HttpError(400, "Invalid itinerary section", "INVALID_SECTION");
  return day[section].activities;
};
const activityEdit = (data, operation, activityId = null) => async (next) => {
  if (!next.collaborationEnabled) throw new HttpError(409, "Collaboration is disabled", "COLLABORATION_DISABLED");
  next.plan = recalculate(next.plan);
  const day = locateDay(next.plan, data.dayId);
  const activities = locateActivities(day, data.section);
  let affectedId = activityId;
  if (operation === "ACTIVITY_ADDED") {
    if (activities.length >= 5) throw new HttpError(400, "This section already has the maximum of five activities", "ACTIVITY_LIMIT_REACHED");
    affectedId = makeId();
    activities.push({ ...data.activity, id: affectedId });
  } else {
    const index = activities.findIndex((entry) => entry.id === activityId);
    if (index < 0) throw new HttpError(404, "Itinerary activity was not found", "ACTIVITY_NOT_FOUND");
    if (operation === "ACTIVITY_UPDATED") activities[index] = { ...data.activity, id: activityId };
    if (operation === "ACTIVITY_REMOVED") activities.splice(index, 1);
    if (operation === "ACTIVITIES_REORDERED") {
      if (data.activityIds.length !== activities.length || new Set(data.activityIds).size !== activities.length || data.activityIds.some((id) => !activities.some((entry) => entry.id === id))) throw new HttpError(400, "Activity order must include each section activity exactly once", "INVALID_ACTIVITY_ORDER");
      const byId = new Map(activities.map((entry) => [entry.id, entry]));
      day[data.section].activities = data.activityIds.map((id) => byId.get(id));
    }
  }
  recalculate(next.plan);
  return { resourceId: affectedId || data.dayId };
};

const addActivity = (req, id, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "ACTIVITY_ADDED", resourceType: "ACTIVITY", resourceId: data.dayId, edit: activityEdit(data, "ACTIVITY_ADDED"), intent: data });
const updateActivity = (req, id, activityId, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "ACTIVITY_UPDATED", resourceType: "ACTIVITY", resourceId: activityId, edit: activityEdit(data, "ACTIVITY_UPDATED", activityId), intent: { ...data, activityId } });
const removeActivity = (req, id, activityId, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "ACTIVITY_REMOVED", resourceType: "ACTIVITY", resourceId: activityId, edit: activityEdit(data, "ACTIVITY_REMOVED", activityId), intent: { ...data, activityId } });
const reorderActivities = (req, id, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "ACTIVITIES_REORDERED", resourceType: "DAY", resourceId: data.dayId, edit: activityEdit(data, "ACTIVITIES_REORDERED"), intent: data });
const reorderDays = (req, id, data) => mutate({ req, id, expectedRevision: data.expectedRevision, operation: "DAYS_REORDERED", resourceType: "ITINERARY", resourceId: id, edit: async (next) => {
  const days = next.plan.days;
  if (data.dayIds.length !== days.length || new Set(data.dayIds).size !== days.length || data.dayIds.some((id) => !days.some((day) => day.id === id))) throw new HttpError(400, "Day order must include each itinerary day exactly once", "INVALID_DAY_ORDER");
  const byId = new Map(days.map((day) => [day.id, day]));
  next.plan.days = data.dayIds.map((id, index) => ({ ...byId.get(id), day: index + 1, date: new Date(next.startDate.getTime() + index * 86400000).toISOString().slice(0, 10) }));
}, intent: data });

const addDay = (req, id, { expectedRevision }) => mutate({ req, id, expectedRevision, operation: "DAY_ADDED", resourceType: "DAY", edit: async (next) => {
  if (next.plan.days.length >= 31) throw new HttpError(400, "An itinerary can contain at most 31 days", "DAY_LIMIT_REACHED");
  const dayNumber = next.plan.days.length + 1;
  const date = new Date(next.endDate.getTime() + 86400000);
  const currency = next.budget.currency;
  const dayId = makeId();
  next.plan.days.push({ id: dayId, day: dayNumber, date: date.toISOString().slice(0, 10), morning: { activities: [] }, afternoon: { activities: [] }, evening: { activities: [] }, estimatedTotal: { amount: 0, currency } });
  next.endDate = date;
  recalculate(next.plan);
  return { resourceId: dayId };
}, intent: { expectedRevision } });

const updateDay = (req, id, dayId, { expectedRevision, title }) => mutate({ req, id, expectedRevision, operation: "DAY_UPDATED", resourceType: "DAY", resourceId: dayId, edit: async (next) => {
  const day = locateDay(next.plan, dayId);
  day.title = title;
}, intent: { expectedRevision, dayId, title } });

const removeDay = (req, id, dayId, { expectedRevision }) => mutate({ req, id, expectedRevision, operation: "DAY_REMOVED", resourceType: "DAY", resourceId: dayId, edit: async (next) => {
  if (next.plan.days.length <= 1) throw new HttpError(409, "An itinerary must keep at least one day", "MINIMUM_DAY_REQUIRED");
  const index = next.plan.days.findIndex((day) => day.id === dayId);
  if (index < 0) throw new HttpError(404, "Itinerary day was not found", "ITINERARY_DAY_NOT_FOUND");
  next.plan.days.splice(index, 1);
  next.plan.days.forEach((day, dayIndex) => {
    day.day = dayIndex + 1;
    day.date = new Date(next.startDate.getTime() + dayIndex * 86400000).toISOString().slice(0, 10);
  });
  next.endDate = new Date(next.endDate.getTime() - 86400000);
  recalculate(next.plan);
}, intent: { expectedRevision, dayId } });

const history = async (actor, id, { page, limit }) => {
  const itinerary = await requireItinerary(id);
  await requireAccess(itinerary, actor);
  const [items, total] = await Promise.all([
    ItineraryRevision.find({ itinerary: id }).select("revision actor operation resourceType resourceId createdAt").populate("actor", "name").sort({ revision: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ItineraryRevision.countDocuments({ itinerary: id }),
  ]);
  return { items: items.map((item) => ({ revision: item.revision, actor: { id: idOf(item.actor), name: item.actor?.name || "Trip member" }, operation: item.operation, resourceType: item.resourceType, resourceId: item.resourceId, createdAt: item.createdAt })), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const restore = async (req, id, data) => {
  const source = await ItineraryRevision.findOne({ itinerary: id, revision: data.revision }).lean();
  if (!source) throw new HttpError(404, "Revision was not found", "REVISION_NOT_FOUND");
  return mutate({ req, id, expectedRevision: data.expectedRevision, operation: "REVISION_RESTORED", resourceType: "ITINERARY", resourceId: String(data.revision), edit: async (next) => {
    next.plan = withStableIds(source.snapshot.plan);
    if (source.snapshot.title) next.title = source.snapshot.title;
    if (source.snapshot.budget) next.budget = source.snapshot.budget;
    if (source.snapshot.startDate) next.startDate = new Date(source.snapshot.startDate);
    if (source.snapshot.endDate) next.endDate = new Date(source.snapshot.endDate);
  }, intent: data });
};

const authorizeSocket = async (id, actorId, edit = false) => {
  const itinerary = await requireItinerary(id);
  if (!itinerary.trip || !itinerary.collaborationEnabled) throw new HttpError(404, "Shared itinerary was not found", "ITINERARY_NOT_FOUND");
  await requireAccess(itinerary, { _id: actorId }, { edit });
  return itinerary;
};

module.exports = { enable, collaborators, grant, revoke, getShared, listShared, addActivity, updateActivity, removeActivity, reorderActivities, reorderDays, addDay, updateDay, removeDay, history, restore, authorizeSocket, mutate };
