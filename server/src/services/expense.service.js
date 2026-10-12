const mongoose = require("mongoose");
const Expense = require("../models/Expense");
const ExpenseSettlement = require("../models/ExpenseSettlement");
const Trip = require("../models/Trip");
const TripMember = require("../models/TripMember");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { HttpError } = require("../utils/http");
const { calculateAllocations } = require("./expenseSplit.service");
const { buildLedger, suggestSettlements } = require("./expenseLedger.service");

const idOf = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const eligibleTripStatuses = ["PUBLISHED", "PLANNING", "CONFIRMED", "ONGOING", "COMPLETED"];

const toExpenseInput = (data, activeMembers, actorId) => {
  const memberById = new Map(activeMembers.map((member) => [member.userId, member]));
  const userIds = data.participants.map((participant) => participant.userId);
  if (new Set(userIds).size !== userIds.length) throw new HttpError(400, "Expense participants must be unique", "DUPLICATE_EXPENSE_PARTICIPANT");
  const unavailable = userIds.filter((userId) => !memberById.has(userId));
  if (unavailable.length) throw new HttpError(400, "Every expense participant must be a current active Trip member", "EXPENSE_PARTICIPANT_NOT_ACTIVE");
  let allocations;
  try { allocations = calculateAllocations({ amountMinorUnits: data.amountMinorUnits, splitMethod: data.splitMethod, participants: data.participants }); }
  catch (error) { throw new HttpError(400, error.message, "INVALID_EXPENSE_SPLIT"); }
  return {
    description: data.description,
    category: data.category,
    amountMinorUnits: data.amountMinorUnits,
    currency: data.currency,
    expenseDate: new Date(`${data.expenseDate}T00:00:00.000Z`),
    splitMethod: data.splitMethod,
    payer: new mongoose.Types.ObjectId(actorId),
    payerNameAtCreation: memberById.get(actorId).name,
    allocations: allocations.map((allocation) => ({ user: new mongoose.Types.ObjectId(allocation.userId), nameAtCreation: memberById.get(allocation.userId).name, amountMinorUnits: allocation.amountMinorUnits })),
    privateNote: data.privateNote || "",
  };
};

const assertActiveMember = async (tripId, userId, session) => {
  const [trip, membership, user] = await Promise.all([
    Trip.findById(tripId).select("_id creator status expenseRevision").session(session).lean(),
    TripMember.findOne({ trip: tripId, user: userId, status: "ACTIVE", $or: [{ joinedAt: null }, { joinedAt: { $lte: new Date() } }] }).select("_id role").session(session).lean(),
    User.findById(userId).select("name accountStatus").session(session).lean(),
  ]);
  if (!trip || !eligibleTripStatuses.includes(trip.status) || !membership || (user?.accountStatus && user.accountStatus !== "ACTIVE")) {
    throw new HttpError(404, "Trip expense ledger was not found", "EXPENSE_LEDGER_NOT_FOUND");
  }
  return { trip, user };
};

const assertTripAccess = async (tripId, actor) => assertActiveMember(tripId, actor._id, null);

const activeParticipants = async (tripId, session) => {
  const memberships = await TripMember.find({ trip: tripId, status: "ACTIVE", $or: [{ joinedAt: null }, { joinedAt: { $lte: new Date() } }] }).select("user").session(session).lean();
  const ids = memberships.map((membership) => membership.user);
  const users = await User.find({ _id: { $in: ids }, accountStatus: { $in: ["ACTIVE", null] } }).select("name").session(session).lean();
  const byId = new Map(users.map((user) => [idOf(user._id), user.name]));
  return memberships.map(({ user }) => ({ userId: idOf(user), name: byId.get(idOf(user)) })).filter((member) => member.name).sort((left, right) => left.userId.localeCompare(right.userId));
};

const audit = async (req, session, { action, resourceType, resourceId, tripId }) => {
  await AuditLog.create([{
    actor: req.user._id, action, resourceType, resourceId,
    metadata: { tripId: idOf(tripId) }, ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 500) || null,
  }], { session });
};

const withLedgerWrite = async (req, tripId, operation) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const access = await assertActiveMember(tripId, req.user._id, session);
      const changed = await operation(session, access);
      result = changed.result;
      if (changed.changed) await Trip.updateOne({ _id: tripId }, { $inc: { expenseRevision: 1 } }, { session });
    });
    return result;
  } finally { await session.endSession(); }
};

const withLedgerRead = async (actor, tripId, operation) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await assertActiveMember(tripId, actor._id, session);
      result = await operation(session);
    }, { readConcern: { level: "snapshot" } });
    return result;
  } finally { await session.endSession(); }
};

const serializeExpense = (expense, actorId) => {
  const value = expense.toObject ? expense.toObject() : expense;
  const output = {
    id: idOf(value._id), tripId: idOf(value.trip), creatorId: idOf(value.creator), payer: { userId: idOf(value.payer), name: value.payerNameAtCreation },
    description: value.description, category: value.category,
    amountMinorUnits: value.amountMinorUnits, currency: value.currency, expenseDate: value.expenseDate,
    splitMethod: value.splitMethod,
    allocations: value.allocations.map((item) => ({ userId: idOf(item.user), name: item.nameAtCreation, amountMinorUnits: item.amountMinorUnits })),
    status: value.status, voidedAt: value.voidedAt, voidReason: value.voidReason,
    history: value.history.map((item) => ({ action: item.action, actorId: idOf(item.actor), at: item.at, financialSnapshot: item.financialSnapshot || null })),
    revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
  if (idOf(value.creator) === idOf(actorId)) output.privateNote = value.privateNote;
  return output;
};
const serializeSettlement = (settlement) => {
  const value = settlement.toObject ? settlement.toObject() : settlement;
  return {
    id: idOf(value._id), tripId: idOf(value.trip),
    from: { userId: idOf(value.fromUser), name: value.fromNameAtCreation },
    to: { userId: idOf(value.toUser), name: value.toNameAtCreation },
    amountMinorUnits: value.amountMinorUnits, currency: value.currency,
    note: value.note, status: value.status, recordedBy: idOf(value.recordedBy),
    recordedAt: value.recordedAt, reversedBy: idOf(value.reversedBy), reversedAt: value.reversedAt,
    reversalReason: value.reversalReason, createdAt: value.createdAt,
  };
};

const loadLedger = async (tripId, session) => {
  const [expenses, settlements, members] = await Promise.all([
    Expense.find({ trip: tripId, status: "ACTIVE" }).session(session).lean(),
    ExpenseSettlement.find({ trip: tripId, status: "RECORDED" }).session(session).lean(),
    activeParticipants(tripId, session),
  ]);
  return buildLedger({ expenses, settlements, members });
};

const participants = async (actor, tripId) => withLedgerRead(actor, tripId, async (session) => ({ items: await activeParticipants(tripId, session) }));

const list = async (actor, tripId, { page, limit, includeVoided }) => {
  await assertTripAccess(tripId, actor);
  const filter = { trip: tripId, ...(includeVoided === "true" ? {} : { status: "ACTIVE" }) };
  const [items, total] = await Promise.all([
    Expense.find(filter).sort({ expenseDate: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Expense.countDocuments(filter),
  ]);
  return { items: items.map((item) => serializeExpense(item, actor._id)), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const get = async (actor, tripId, expenseId) => {
  await assertTripAccess(tripId, actor);
  const expense = await Expense.findOne({ _id: expenseId, trip: tripId });
  if (!expense) throw new HttpError(404, "Expense was not found", "EXPENSE_NOT_FOUND");
  return serializeExpense(expense, actor._id);
};

const idempotencyKey = (req) => {
  const value = req.get("idempotency-key");
  if (!value || !/^[\w-]{8,64}$/.test(value)) throw new HttpError(400, "A valid Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED");
  return value;
};

const create = async (req, tripId, data) => {
  const key = idempotencyKey(req);
  try {
    return await withLedgerWrite(req, tripId, async (session) => {
      const previous = await Expense.findOne({ trip: tripId, creator: req.user._id, idempotencyKey: key }).session(session);
      if (previous) return { changed: false, result: { expense: serializeExpense(previous, req.user._id), duplicate: true } };
      const currentMembers = await activeParticipants(tripId, session);
      const values = toExpenseInput(data, currentMembers, idOf(req.user._id));
      const [expense] = await Expense.create([{
        ...values, trip: tripId, creator: req.user._id, idempotencyKey: key,
        history: [{ action: "CREATED", actor: req.user._id }],
      }], { session });
      await audit(req, session, { action: "EXPENSE_CREATED", resourceType: "EXPENSE", resourceId: expense._id, tripId });
      return { changed: true, result: { expense: serializeExpense(expense, req.user._id), duplicate: false } };
    });
  } catch (error) {
    if (error.code === 11000) {
      await assertTripAccess(tripId, req.user);
      const previous = await Expense.findOne({ trip: tripId, creator: req.user._id, idempotencyKey: key });
      if (previous) return { expense: serializeExpense(previous, req.user._id), duplicate: true };
    }
    throw error;
  }
};

const update = async (req, tripId, expenseId, data) => withLedgerWrite(req, tripId, async (session) => {
  const current = await Expense.findOne({ _id: expenseId, trip: tripId }).session(session);
  if (!current) throw new HttpError(404, "Expense was not found", "EXPENSE_NOT_FOUND");
  if (idOf(current.creator) !== idOf(req.user._id)) throw new HttpError(403, "Only the expense creator can edit this expense", "EXPENSE_EDIT_FORBIDDEN");
  if (current.status !== "ACTIVE") throw new HttpError(409, "Voided expenses cannot be edited", "EXPENSE_VOIDED");
  if (current.revision !== data.expectedRevision) throw new HttpError(409, "Expense changed; reload before editing", "EXPENSE_REVISION_CONFLICT", { latestRevision: current.revision });
  const currentMembers = await activeParticipants(tripId, session);
  const values = toExpenseInput(data, currentMembers, idOf(req.user._id));
  const financialSnapshot = {
    description: current.description, category: current.category,
    amountMinorUnits: current.amountMinorUnits, currency: current.currency,
    expenseDate: current.expenseDate, splitMethod: current.splitMethod,
    allocations: current.allocations.map((item) => ({ userId: idOf(item.user), name: item.nameAtCreation, amountMinorUnits: item.amountMinorUnits })),
  };
  const expense = await Expense.findOneAndUpdate(
    { _id: expenseId, trip: tripId, revision: data.expectedRevision, status: "ACTIVE" },
    { $set: values, $inc: { revision: 1 }, $push: { history: { action: "UPDATED", actor: req.user._id, financialSnapshot } } },
    { new: true, runValidators: true, session },
  );
  if (!expense) throw new HttpError(409, "Expense changed; reload before editing", "EXPENSE_REVISION_CONFLICT");
  await audit(req, session, { action: "EXPENSE_UPDATED", resourceType: "EXPENSE", resourceId: expense._id, tripId });
  return { changed: true, result: serializeExpense(expense, req.user._id) };
});

const voidExpense = async (req, tripId, expenseId, { expectedRevision, reason }) => withLedgerWrite(req, tripId, async (session, { trip }) => {
  const expense = await Expense.findOne({ _id: expenseId, trip: tripId }).session(session);
  if (!expense) throw new HttpError(404, "Expense was not found", "EXPENSE_NOT_FOUND");
  const actorIsCreator = idOf(expense.creator) === idOf(req.user._id);
  const actorIsTripOwner = idOf(trip.creator) === idOf(req.user._id);
  if (!actorIsCreator && !actorIsTripOwner) throw new HttpError(403, "Only the expense creator or Trip creator can void this expense", "EXPENSE_VOID_FORBIDDEN");
  if (expense.status === "VOIDED") return { changed: false, result: serializeExpense(expense, req.user._id) };
  if (expense.revision !== expectedRevision) throw new HttpError(409, "Expense changed; reload before voiding", "EXPENSE_REVISION_CONFLICT", { latestRevision: expense.revision });
  expense.status = "VOIDED";
  expense.voidedBy = req.user._id;
  expense.voidedAt = new Date();
  expense.voidReason = reason;
  expense.revision += 1;
  expense.history.push({ action: "VOIDED", actor: req.user._id });
  await expense.save({ session });
  await audit(req, session, { action: "EXPENSE_VOIDED", resourceType: "EXPENSE", resourceId: expense._id, tripId });
  return { changed: true, result: serializeExpense(expense, req.user._id) };
});

const summary = async (actor, tripId) => withLedgerRead(actor, tripId, async (session) => {
  const [ledger, trip] = await Promise.all([loadLedger(tripId, session), Trip.findById(tripId).select("title creator expenseRevision").session(session).lean()]);
  return { trip: { id: tripId, title: trip.title, creatorId: idOf(trip.creator), revision: trip.expenseRevision }, currencies: ledger, suggestions: suggestSettlements(ledger) };
});

const settlementSuggestions = async (actor, tripId) => withLedgerRead(actor, tripId, async (session) => ({ items: suggestSettlements(await loadLedger(tripId, session)) }));

const recordSettlement = async (req, tripId, data) => {
  const key = idempotencyKey(req);
  try {
    return await withLedgerWrite(req, tripId, async (session) => {
      const previous = await ExpenseSettlement.findOne({ trip: tripId, recordedBy: req.user._id, idempotencyKey: key }).session(session);
      if (previous) return { changed: false, result: { settlement: serializeSettlement(previous), duplicate: true } };
      if (idOf(req.user._id) === data.toUserId) throw new HttpError(400, "A settlement must have a different recipient", "INVALID_SETTLEMENT_RECIPIENT");
      const ledger = await loadLedger(tripId, session);
      const currency = ledger.find((entry) => entry.currency === data.currency);
      const from = currency?.members.find((member) => member.userId === idOf(req.user._id));
      const to = currency?.members.find((member) => member.userId === data.toUserId);
      if (!from || !to || from.netMinorUnits >= 0 || to.netMinorUnits <= 0) throw new HttpError(409, "Settlement must go from a member who owes this currency to a member who is owed", "SETTLEMENT_DOES_NOT_MATCH_BALANCE");
      if (data.amountMinorUnits > Math.min(-from.netMinorUnits, to.netMinorUnits)) throw new HttpError(409, "Settlement exceeds the outstanding balance", "SETTLEMENT_EXCEEDS_BALANCE");
      const [settlement] = await ExpenseSettlement.create([{
        trip: tripId, fromUser: req.user._id, fromNameAtCreation: from.name,
        toUser: new mongoose.Types.ObjectId(data.toUserId), toNameAtCreation: to.name,
        amountMinorUnits: data.amountMinorUnits, currency: data.currency, note: data.note,
        status: "RECORDED", recordedBy: req.user._id, idempotencyKey: key,
      }], { session });
      await audit(req, session, { action: "SETTLEMENT_RECORDED", resourceType: "EXPENSE_SETTLEMENT", resourceId: settlement._id, tripId });
      return { changed: true, result: { settlement: serializeSettlement(settlement), duplicate: false } };
    });
  } catch (error) {
    if (error.code === 11000) {
      await assertTripAccess(tripId, req.user);
      const previous = await ExpenseSettlement.findOne({ trip: tripId, recordedBy: req.user._id, idempotencyKey: key });
      if (previous) return { settlement: serializeSettlement(previous), duplicate: true };
    }
    throw error;
  }
};

const listSettlements = async (actor, tripId, { page, limit }) => {
  await assertTripAccess(tripId, actor);
  const query = { trip: tripId };
  const [items, total] = await Promise.all([
    ExpenseSettlement.find(query).sort({ recordedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ExpenseSettlement.countDocuments(query),
  ]);
  return { items: items.map(serializeSettlement), page, limit, total, totalPages: Math.ceil(total / limit) };
};

const reverseSettlement = async (req, tripId, settlementId, { reason }) => withLedgerWrite(req, tripId, async (session) => {
  const settlement = await ExpenseSettlement.findOne({ _id: settlementId, trip: tripId }).session(session);
  if (!settlement) throw new HttpError(404, "Settlement record was not found", "SETTLEMENT_NOT_FOUND");
  if (idOf(settlement.recordedBy) !== idOf(req.user._id)) throw new HttpError(403, "Only the reporting member can reverse this settlement", "SETTLEMENT_REVERSE_FORBIDDEN");
  if (settlement.status === "REVERSED") return { changed: false, result: serializeSettlement(settlement) };
  settlement.status = "REVERSED";
  settlement.reversedBy = req.user._id;
  settlement.reversedAt = new Date();
  settlement.reversalReason = reason;
  await settlement.save({ session });
  await audit(req, session, { action: "SETTLEMENT_REVERSED", resourceType: "EXPENSE_SETTLEMENT", resourceId: settlement._id, tripId });
  return { changed: true, result: serializeSettlement(settlement) };
});

module.exports = { participants, list, get, create, update, voidExpense, summary, settlementSuggestions, recordSettlement, listSettlements, reverseSettlement };
