const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Connection = require("../src/models/Connection");
const { createConnectionSchema, connectionsQuerySchema } = require("../src/validators/connection.validator");

test("connection schema rejects a self connection and exposes atomic active-pair index", async () => {
  const userId = new mongoose.Types.ObjectId();
  const connection = new Connection({
    requester: userId,
    recipient: userId,
    pairKey: `${userId}:${userId}`,
    tripKey: "GLOBAL",
    activeKey: `${userId}:${userId}:GLOBAL`,
    audit: { requestedBy: userId },
  });
  await assert.rejects(connection.validate(), /Requester and recipient must differ/);
  const activeIndex = Connection.schema.indexes().find(([keys]) => keys.activeKey === 1);
  assert.ok(activeIndex);
  assert.equal(activeIndex[1].unique, true);
  assert.deepEqual(activeIndex[1].partialFilterExpression, { activeKey: { $type: "string" } });
});

test("connection request validator rejects client-supplied scores and unknown fields", () => {
  const valid = { recipientId: "64b000000000000000000001" };
  assert.equal(createConnectionSchema.safeParse(valid).success, true);
  assert.equal(createConnectionSchema.safeParse({ ...valid, score: 100 }).success, false);
  assert.equal(createConnectionSchema.safeParse({ ...valid, unrelated: true }).success, false);
});

test("connection pagination is bounded and validated", () => {
  assert.deepEqual(connectionsQuerySchema.parse({}), { page: 1, limit: 20 });
  assert.equal(connectionsQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(connectionsQuerySchema.safeParse({ limit: 1000 }).success, false);
});

if (!process.env.MONGODB_TEST_URI) {
  test("connection MongoDB lifecycle integration", { skip: "Set MONGODB_TEST_URI to run database-dependent connection workflows" }, () => {});
}
