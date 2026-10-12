const test = require("node:test");
const assert = require("node:assert/strict");

const configuredUri = process.env.MONGODB_TEST_URI;
test("expense ownership, membership, optimistic edits, balance and settlement lifecycle", { skip: !configuredUri ? "Set MONGODB_TEST_URI to an isolated disposable replica-set test database" : false }, async (context) => {
  const uri = new URL(configuredUri);
  const sourceDatabase = uri.pathname.replace(/^\//, "").split("/")[0];
  assert.match(sourceDatabase, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
  uri.pathname = `/${sourceDatabase}_phase18_expenses_${process.pid}`;
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "expense-integration-test-secret-with-more-than-32-characters";

  const mongoose = require("mongoose");
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  const User = require("../src/models/User");
  const Trip = require("../src/models/Trip");
  const TripMember = require("../src/models/TripMember");
  const Expense = require("../src/models/Expense");
  const ExpenseSettlement = require("../src/models/ExpenseSettlement");
  const AuditLog = require("../src/models/AuditLog");
  const app = require("../app");
  const jwt = require("jsonwebtoken");
  await Promise.all([User, Trip, TripMember, Expense, ExpenseSettlement, AuditLog].map((model) => model.init()));
  const server = app.listen(0, "127.0.0.1");
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const createUser = (email, name) => User.create({ name, email, passwordHash: "integration-placeholder" });
  const owner = await createUser("expense-owner@test.invalid", "Owner");
  const member = await createUser("expense-member@test.invalid", "Member");
  const third = await createUser("expense-third@test.invalid", "Third");
  const outsider = await createUser("expense-outsider@test.invalid", "Outsider");
  const trip = await Trip.create({ creator: owner._id, title: "Expense test trip", status: "PLANNING", privacy: "PRIVATE" });
  const activeMembers = [owner, member, third];
  await TripMember.create(activeMembers.map((user, index) => ({ trip: trip._id, user: user._id, role: index === 0 ? "OWNER" : "MEMBER", status: "ACTIVE", joinedAt: new Date() })));
  const tokenFor = (user) => jwt.sign({ v: 0 }, process.env.JWT_SECRET, { subject: user._id.toString(), issuer: "tripbuddy", audience: "tripbuddy-web", expiresIn: "1h" });
  const request = async (user, method, path, body, key) => {
    const headers = { cookie: `tripbuddy_session=${tokenFor(user)}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (key) headers["Idempotency-Key"] = key;
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, payload: await response.json() };
  };
  const base = `/api/v1/expenses/trips/${trip._id}`;
  const createBody = {
    description: "Group dinner", category: "FOOD", amountMinorUnits: 10001, currency: "INR", expenseDate: "2027-05-01", splitMethod: "EQUAL",
    participants: activeMembers.map((user) => ({ userId: user._id.toString() })), privateNote: "receipt is kept offline",
  };

  await context.test("membership gates every read and payer identity comes from the session", async () => {
    const denied = await request(outsider, "GET", `${base}/summary`);
    assert.equal(denied.response.status, 404);
    const forgedPayer = await request(owner, "POST", base, { ...createBody, payerId: member._id.toString() }, "expense-forged-payer-01");
    assert.equal(forgedPayer.response.status, 400);
    const created = await request(owner, "POST", base, createBody, "expense-idempotency-0001");
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.expense.payer.userId, owner._id.toString());
    assert.equal(created.payload.data.expense.allocations.reduce((sum, item) => sum + item.amountMinorUnits, 0), 10001);
    const duplicate = await request(owner, "POST", base, createBody, "expense-idempotency-0001");
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.payload.data.expense.id, created.payload.data.expense.id);
    const privateRead = await request(member, "GET", `${base}/${created.payload.data.expense.id}`);
    assert.equal(privateRead.response.status, 200);
    assert.equal("privateNote" in privateRead.payload.data, false);
  });

  await context.test("revision checks serialize edits and settlement correction restores balances", async () => {
    const expense = await Expense.findOne({ trip: trip._id });
    const edit = (description) => request(owner, "PATCH", `${base}/${expense._id}`, {
      expectedRevision: 1, description, category: "FOOD", amountMinorUnits: 10001, currency: "INR", expenseDate: "2027-05-01", splitMethod: "EXACT",
      participants: createBody.participants.map((item, index) => ({ userId: item.userId, amountMinorUnits: [3334, 3334, 3333][index] })), privateNote: "private",
    });
    const concurrent = await Promise.all([edit("Dinner corrected A"), edit("Dinner corrected B")]);
    assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 409]);
    const summary = await request(member, "GET", `${base}/summary`);
    assert.equal(summary.response.status, 200);
    assert.equal(summary.payload.data.trip.creatorId, owner._id.toString());
    assert.equal(summary.payload.data.currencies[0].members.reduce((sum, item) => sum + item.netMinorUnits, 0), 0);
    const suggestion = summary.payload.data.suggestions.find((item) => item.fromUserId === member._id.toString());
    assert.ok(suggestion);
    const forged = await request(owner, "POST", `${base}/settlements`, { fromUserId: member._id.toString(), toUserId: owner._id.toString(), amountMinorUnits: 1, currency: "INR" }, "settlement-forged-payer-01");
    assert.equal(forged.response.status, 400);
    const recorded = await request(member, "POST", `${base}/settlements`, { toUserId: owner._id.toString(), amountMinorUnits: 1000, currency: "INR", note: "Reported transfer" }, "settlement-idempotency-001");
    assert.equal(recorded.response.status, 201);
    assert.equal(recorded.payload.data.settlement.status, "RECORDED");
    const forbiddenReverse = await request(owner, "POST", `${base}/settlements/${recorded.payload.data.settlement.id}/reverse`, { reason: "try" });
    assert.equal(forbiddenReverse.response.status, 403);
    const reverse = await request(member, "POST", `${base}/settlements/${recorded.payload.data.settlement.id}/reverse`, { reason: "Corrected report" });
    assert.equal(reverse.response.status, 200);
    assert.equal(reverse.payload.data.status, "REVERSED");
    const reversedSummary = await request(owner, "GET", `${base}/summary`);
    assert.equal(reversedSummary.payload.data.suggestions.some((item) => item.fromUserId === member._id.toString()), true);
  });

  await context.test("voids preserve history, leave membership-gated records, and exclude them from balances", async () => {
    const expense = await Expense.findOne({ trip: trip._id });
    const voided = await request(owner, "POST", `${base}/${expense._id}/void`, { expectedRevision: expense.revision, reason: "Duplicate entry" });
    assert.equal(voided.response.status, 200);
    assert.equal(voided.payload.data.status, "VOIDED");
    const summary = await request(owner, "GET", `${base}/summary`);
    assert.deepEqual(summary.payload.data.currencies, []);
    await TripMember.updateOne({ trip: trip._id, user: member._id }, { $set: { status: "LEFT" } });
    const removedMemberRead = await request(member, "GET", `${base}/summary`);
    assert.equal(removedMemberRead.response.status, 404);
    const history = await request(owner, "GET", `${base}?includeVoided=true`);
    assert.equal(history.payload.data.items.length, 1);
    assert.equal(history.payload.data.items[0].history.some((entry) => entry.action === "VOIDED"), true);
    assert.equal(await AuditLog.countDocuments({ resourceType: { $in: ["EXPENSE", "EXPENSE_SETTLEMENT"] }, "metadata.tripId": trip._id.toString() }), 5);
  });
});
