const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../src/validators/analytics.validator");
const { resolvePeriod, bucketKeys, fillSeries, safeRatio } = require("../src/utils/analytics-period");
const { PROVIDER_VERIFIED_SOURCES } = require("../src/services/analytics.service");
const User = require("../src/models/User");
const Message = require("../src/models/Message");

test("analytics query accepts presets and timezone-qualified bounded custom ranges", () => {
  assert.equal(query.safeParse({ window: "24h" }).success, true);
  assert.equal(query.safeParse({ window: "7d" }).success, true);
  assert.equal(query.safeParse({ from: "2026-03-08T01:30:00-05:00", to: "2026-03-09T01:30:00-04:00" }).success, true);
  assert.equal(query.safeParse({ from: "2026-03-08T01:30:00", to: "2026-03-09T01:30:00" }).success, false);
  assert.equal(query.safeParse({ from: "2026-01-01T00:00:00Z" }).success, false);
  assert.equal(query.safeParse({ window: "7d", from: "2026-03-08T00:00:00Z", to: "2026-03-09T00:00:00Z" }).success, false);
});

test("analytics rejects future and greater than 90 day custom ranges", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(query.safeParse({ from: "2026-01-01T00:00:00Z", to: "2026-04-02T00:00:00Z" }).success, false);
  assert.equal(query.safeParse({ from: new Date(Date.now() - 60_000).toISOString(), to: future }).success, false);
});

test("periods and buckets use UTC boundaries across daylight-saving transitions", () => {
  const now = new Date("2026-03-09T12:34:56.000Z");
  const rolling = resolvePeriod({ window: "24h" }, now);
  assert.equal(rolling.from.toISOString(), "2026-03-08T12:34:56.000Z");
  assert.equal(rolling.bucket, "hour");
  assert.equal(bucketKeys(rolling).length, 25);
  const offsetRange = resolvePeriod({ from: "2026-03-08T01:30:00-05:00", to: "2026-03-09T01:30:00-04:00" }, now);
  assert.equal(offsetRange.from.toISOString(), "2026-03-08T06:30:00.000Z");
  assert.equal(offsetRange.to.toISOString(), "2026-03-09T05:30:00.000Z");
  assert.equal(offsetRange.bucket, "day");
});

test("empty time buckets are explicit zeros and ratios define a zero denominator", () => {
  const period = resolvePeriod({ from: "2026-05-01T00:00:00Z", to: "2026-05-04T00:00:00Z" });
  const points = fillSeries(period, [{ _id: "2026-05-02T00:00:00.000Z", count: 3 }]);
  assert.deepEqual(points.map((point) => point.count), [0, 3, 0]);
  assert.equal(safeRatio(3, 12), 0.25);
  assert.equal(safeRatio(0, 0), null);
});

test("payment analytics accepts only provider-verified transition sources and chat indexes time only", () => {
  assert.deepEqual(PROVIDER_VERIFIED_SOURCES, ["API", "WEBHOOK", "RECONCILIATION"]);
  assert.ok(Message.schema.indexes().some(([fields]) => fields.createdAt === 1));
  assert.ok(User.schema.indexes().some(([fields]) => fields.createdAt === 1));
});
