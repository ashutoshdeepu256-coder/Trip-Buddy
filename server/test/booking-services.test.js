const test = require("node:test");
const assert = require("node:assert/strict");
const { createSchema } = require("../src/validators/booking.validator");
const providers = require("../src/services/bookingProviders.service");

test("service directory reports only external search and no transaction capabilities", () => {
  const items = providers.list();
  assert.deepEqual(items.map((item) => item.category), ["ACCOMMODATION", "TRANSPORT", "ACTIVITY"]);
  for (const item of items) {
    assert.equal(item.capabilities.reservation, false);
    assert.equal(item.capabilities.availability, false);
    assert.equal(item.capabilities.pricing, false);
    assert.equal(item.capabilities.cancellation, false);
    assert.equal(item.capabilities.refunds, false);
  }
});

test("external handoff URLs use a fixed HTTPS host and encoded user query", () => {
  const { url } = providers.createExternalUrl("accommodation-search", "Paris & test", "2027-05-01", "2027-05-03", 2);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "www.google.com");
  assert.equal(parsed.searchParams.get("q"), "Paris & test");
  assert.equal(parsed.searchParams.get("adults"), "2");
  assert.throws(() => providers.createExternalUrl("unknown", "Paris", "2027-05-01", "2027-05-03", 1), /Unsupported travel service/);
});

test("booking input rejects client URLs, statuses and estimates on external handoffs", () => {
  const base = { serviceId: "transport-search", mode: "EXTERNAL_HANDOFF", serviceName: "Flight", destination: "Delhi", startDate: "2027-05-01", endDate: "2027-05-02", travellers: 1 };
  assert.equal(createSchema.safeParse(base).success, true);
  assert.equal(createSchema.safeParse({ ...base, externalUrl: "https://attacker.invalid" }).success, false);
  assert.equal(createSchema.safeParse({ ...base, status: "PROVIDER_CONFIRMED" }).success, false);
  assert.equal(createSchema.safeParse({ ...base, userEstimate: { amount: 1, currency: "USD" } }).success, false);
});
