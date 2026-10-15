const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const configuredUri = process.env.MONGODB_TEST_URI;
test("Razorpay Route payment, callback, duplicate/out-of-order webhook, refund and concurrent reservation", {
  skip: !configuredUri ? "Set MONGODB_TEST_URI to an isolated disposable replica-set test database" : false,
}, async (context) => {
  const uri = new URL(configuredUri);
  const sourceDatabase = uri.pathname.replace(/^\//, "").split("/")[0];
  assert.match(sourceDatabase, /test/i, "MONGODB_TEST_URI must name a dedicated test database");
  uri.pathname = `/${sourceDatabase}_phase19_payments_${process.pid}`;
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "phase-19-test-secret-longer-than-32-characters";

  const mongoose = require("mongoose");
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  const User = require("../src/models/User");
  const Trip = require("../src/models/Trip");
  const TripMember = require("../src/models/TripMember");
  const Expense = require("../src/models/Expense");
  const ExpenseSettlement = require("../src/models/ExpenseSettlement");
  const PaymentAttempt = require("../src/models/PaymentAttempt");
  const PaymentWebhookEvent = require("../src/models/PaymentWebhookEvent");
  const AuditLog = require("../src/models/AuditLog");
  const paymentService = require("../src/services/payment.service");
  const paymentProvider = require("../src/services/paymentProvider.service");
  const expenseService = require("../src/services/expense.service");
  await Promise.all([User, Trip, TripMember, Expense, ExpenseSettlement, PaymentAttempt, PaymentWebhookEvent, AuditLog].map((model) => model.init()));

  const owner = await User.create({ name: "Creditor", email: "phase19-owner@test.invalid", passwordHash: "integration-placeholder", razorpayLinkedAccountId: "acc_tripbuddy_owner_19" });
  const payer = await User.create({ name: "Payer", email: "phase19-payer@test.invalid", passwordHash: "integration-placeholder" });
  const outsider = await User.create({ name: "Outsider", email: "phase19-outsider@test.invalid", passwordHash: "integration-placeholder" });
  const trip = await Trip.create({ creator: owner._id, title: "Payment test", status: "PLANNING", privacy: "PRIVATE" });
  await TripMember.create([
    { trip: trip._id, user: owner._id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() },
    { trip: trip._id, user: payer._id, role: "MEMBER", status: "ACTIVE", joinedAt: new Date() },
  ]);
  await Expense.create({
    trip: trip._id, creator: owner._id, payer: owner._id, payerNameAtCreation: owner.name, description: "Shared stay", category: "ACCOMMODATION",
    amountMinorUnits: 10000, currency: "INR", expenseDate: new Date("2027-05-01T00:00:00Z"), splitMethod: "EXACT",
    allocations: [{ user: owner._id, nameAtCreation: owner.name, amountMinorUnits: 0 }, { user: payer._id, nameAtCreation: payer.name, amountMinorUnits: 10000 }],
    idempotencyKey: "phase19-expense-0001",
  });

  const orderById = new Map();
  const paymentById = new Map();
  const refundById = new Map();
  const makeId = (prefix, index) => `${prefix}_phase19_${index}`;
  let orderNumber = 0;
  let refundNumber = 0;
  const provider = {
    orders: {
      create: async (data) => {
        orderNumber += 1;
        const id = makeId("order", orderNumber);
        const transfer = { id: makeId("trf", orderNumber), recipient: data.transfers[0].account, amount: data.transfers[0].amount, currency: data.transfers[0].currency, amount_reversed: 0, status: "created" };
        const order = { id, receipt: data.receipt, amount: data.amount, currency: data.currency, status: "created", transfers: { items: [transfer] } };
        orderById.set(id, order);
        paymentById.set(id, { id: makeId("pay", orderNumber), order_id: id, amount: data.amount, currency: data.currency, status: "created", captured: false, amount_refunded: 0, refund_status: null });
        return order;
      },
      all: async ({ receipt }) => ({ items: [...orderById.values()].filter((item) => item.receipt === receipt) }),
      fetch: async (id) => orderById.get(id),
      fetchTransferOrder: async (id) => orderById.get(id),
      fetchPayments: async (id) => ({ items: [paymentById.get(id)].filter(Boolean) }),
    },
    payments: {
      fetch: async (id) => [...paymentById.values()].find((item) => item.id === id),
      fetchRefund: async (_paymentId, refundId) => refundById.get(refundId),
      fetchMultipleRefund: async (paymentId) => ({ items: [...refundById.values()].filter((item) => item.payment_id === paymentId) }),
      refund: async (paymentId, data) => {
        const payment = [...paymentById.values()].find((item) => item.id === paymentId);
        payment.amount_refunded += data.amount;
        payment.refund_status = payment.amount_refunded === payment.amount ? "full" : "partial";
        const order = orderById.get(payment.order_id);
        order.transfers.items[0].amount_reversed = payment.amount_refunded;
        order.transfers.items[0].status = payment.amount_refunded === payment.amount ? "reversed" : "partially_reversed";
        const refund = { id: makeId("rfnd", ++refundNumber), payment_id: paymentId, amount: data.amount, currency: payment.currency, status: "processed", created_at: Date.now() };
        refundById.set(refund.id, refund);
        return refund;
      },
    },
  };
  const originals = { getProvider: paymentProvider.getProvider, isConfigured: paymentProvider.isConfigured, configuration: paymentProvider.configuration };
  paymentProvider.getProvider = () => provider;
  paymentProvider.isConfigured = () => true;
  paymentProvider.configuration = () => ({ keyId: "rzp_test_phase19", keySecret: "test-key-secret", webhookSecret: "test-webhook-secret", mode: "test", routeEnabled: true });
  context.after(async () => {
    paymentProvider.getProvider = originals.getProvider;
    paymentProvider.isConfigured = originals.isConfigured;
    paymentProvider.configuration = originals.configuration;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const tripId = trip._id.toString();
  const makeRequest = (user, key, paymentId = null) => ({
    user, params: paymentId ? { paymentId } : {},
    get: (header) => header.toLowerCase() === "idempotency-key" ? key : undefined,
  });
  const signature = (orderId, paymentId) => crypto.createHmac("sha256", "test-key-secret").update(`${orderId}|${paymentId}`).digest("hex");

  await context.test("authoritative obligations gate creation and concurrent attempts reserve funds", async () => {
    const blocked = await paymentService.create(makeRequest(payer, "phase19-over-amount"), { tripId, recipientUserId: owner._id.toString(), amountMinorUnits: 10001, currency: "INR" }).then(() => null, (error) => error);
    assert.equal(blocked.statusCode, 409);
    const unauthorized = await paymentService.create(makeRequest(outsider, "phase19-outsider"), { tripId, recipientUserId: owner._id.toString(), amountMinorUnits: 10000, currency: "INR" }).then(() => null, (error) => error);
    assert.equal(unauthorized.statusCode, 404);
    const input = { tripId, recipientUserId: owner._id.toString(), amountMinorUnits: 10000, currency: "INR" };
    const outcomes = await Promise.allSettled([
      paymentService.create(makeRequest(payer, "phase19-payment-concurrent-a"), input),
      paymentService.create(makeRequest(payer, "phase19-payment-concurrent-b"), input),
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    const accepted = outcomes.find((result) => result.status === "fulfilled").value.payment;
    assert.equal(accepted.status, "PENDING");
    assert.equal(accepted.checkout.currency, "INR");
    assert.equal(orderNumber, 1);
  });

  const attempt = await PaymentAttempt.findOne({ trip: trip._id });
  const payment = paymentById.get(attempt.providerOrderId);
  await context.test("captured Checkout alone is insufficient; Route transfer and webhook verify the settlement", async () => {
    payment.status = "captured";
    payment.captured = true;
    const callback = await paymentService.verifyCheckout(makeRequest(payer, "unused", attempt._id.toString()), {
      razorpay_order_id: attempt.providerOrderId, razorpay_payment_id: payment.id, razorpay_signature: signature(attempt.providerOrderId, payment.id),
    });
    assert.equal(callback.verified, false);
    assert.equal(callback.payment.status, "TRANSFER_PENDING");
    let summary = await expenseService.summary(payer, tripId);
    assert.equal(summary.currencies[0].members.find((member) => member.userId === payer._id.toString()).netMinorUnits, -10000);

    const order = orderById.get(attempt.providerOrderId);
    order.transfers.items[0].status = "processed";
    const body = Buffer.from(JSON.stringify({ event: "transfer.processed", payload: { transfer: { entity: { id: attempt.providerTransferId, source: attempt.providerOrderId } } } }));
    const signatureHeader = crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex");
    const event = { rawBody: body, signature: signatureHeader, eventId: "evt_phase19_transfer_001", provider };
    const accepted = await paymentService.processWebhook(event);
    assert.equal(accepted.matched, true);
    const duplicate = await paymentService.processWebhook(event);
    assert.equal(duplicate.duplicate, true);
    const saved = await PaymentAttempt.findById(attempt._id);
    assert.equal(saved.status, "SUCCEEDED");
    assert.equal(await ExpenseSettlement.countDocuments({ paymentAttempt: attempt._id, source: "PROVIDER_VERIFIED", status: "RECORDED" }), 1);
    summary = await expenseService.summary(payer, tripId);
    assert.equal(summary.currencies[0].members.reduce((sum, member) => sum + member.netMinorUnits, 0), 0);

    const lateFailure = Buffer.from(JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: payment.id, order_id: attempt.providerOrderId } } } }));
    const lateSignature = crypto.createHmac("sha256", "test-webhook-secret").update(lateFailure).digest("hex");
    await paymentService.processWebhook({ rawBody: lateFailure, signature: lateSignature, eventId: "evt_phase19_old_failure_01", provider });
    assert.equal((await PaymentAttempt.findById(attempt._id)).status, "SUCCEEDED");
  });

  await context.test("out-of-order partial Route reversal applies only the verified refund amount", async () => {
    await provider.payments.refund(payment.id, { amount: 4000 });
    const body = Buffer.from(JSON.stringify({ event: "transfer.reversed", payload: { transfer: { entity: { id: attempt.providerTransferId, source: attempt.providerOrderId } } } }));
    const signatureHeader = crypto.createHmac("sha256", "test-webhook-secret").update(body).digest("hex");
    await paymentService.processWebhook({ rawBody: body, signature: signatureHeader, eventId: "evt_phase19_partial_refund_01", provider });
    const saved = await PaymentAttempt.findById(attempt._id);
    const settlement = await ExpenseSettlement.findOne({ paymentAttempt: attempt._id });
    assert.equal(saved.status, "PARTIALLY_REFUNDED");
    assert.equal(saved.refundedAmountMinorUnits, 4000);
    assert.equal(settlement.status, "RECORDED");
    assert.equal(settlement.amountMinorUnits, 6000);
  });

  await context.test("full refund and Route reversal restore the Trip obligation once", async () => {
    const refunded = await paymentService.refund(makeRequest(payer, "unused", attempt._id.toString()), { reason: "Integration test refund" });
    assert.equal(refunded.payment.status, "REFUNDED");
    const settlement = await ExpenseSettlement.findOne({ paymentAttempt: attempt._id });
    assert.equal(settlement.status, "REVERSED");
    const summary = await expenseService.summary(payer, tripId);
    assert.equal(summary.currencies[0].members.find((member) => member.userId === payer._id.toString()).netMinorUnits, -10000);
  });
});
