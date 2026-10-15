const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createSchema, verifySchema } = require("../src/validators/payment.validator");
const { verifyCheckoutSignature, verifyWebhookSignature } = require("../src/services/payment.service");
const PaymentAttempt = require("../src/models/PaymentAttempt");
const ExpenseSettlement = require("../src/models/ExpenseSettlement");

test("payment creation accepts only bounded INR minor units and trusted recipient fields", () => {
  const valid = { tripId: "507f1f77bcf86cd799439011", recipientUserId: "507f1f77bcf86cd799439012", amountMinorUnits: 100, currency: "INR" };
  assert.equal(createSchema.safeParse(valid).success, true);
  assert.equal(createSchema.safeParse({ ...valid, amountMinorUnits: 99 }).success, false);
  assert.equal(createSchema.safeParse({ ...valid, currency: "USD" }).success, false);
  assert.equal(createSchema.safeParse({ ...valid, payerId: "507f1f77bcf86cd799439013" }).success, false);
  assert.equal(createSchema.safeParse({ ...valid, amountMinorUnits: 1000000000001 }).success, false);
});

test("Checkout callback fields are bounded and do not carry a client payment status", () => {
  const valid = { razorpay_order_id: "order_12345678", razorpay_payment_id: "pay_12345678", razorpay_signature: "a".repeat(64) };
  assert.equal(verifySchema.safeParse(valid).success, true);
  assert.equal(verifySchema.safeParse({ ...valid, status: "captured" }).success, false);
  assert.equal(verifySchema.safeParse({ ...valid, razorpay_signature: "not-a-signature" }).success, false);
});

test("Checkout signatures verify order and payment identifiers with the server secret", () => {
  const secret = "server-only-test-secret";
  const orderId = "order_test_123";
  const paymentId = "pay_test_456";
  const signature = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  assert.equal(verifyCheckoutSignature({ orderId, paymentId, signature, secret }), true);
  assert.equal(verifyCheckoutSignature({ orderId, paymentId: "pay_other_1", signature, secret }), false);
  assert.equal(verifyCheckoutSignature({ orderId, paymentId, signature, secret: "wrong-secret" }), false);
});

test("webhook signatures use exact raw request bytes and reject modified payloads", () => {
  const secret = "webhook-test-secret";
  const body = Buffer.from('{"event":"payment.captured","note":"raw bytes matter"}', "utf8");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, signature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from(`${body.toString()} `), signature, secret), false);
  assert.equal(verifyWebhookSignature(body, signature, "wrong-secret"), false);
  assert.equal(verifyWebhookSignature(body.toString("utf8"), signature, secret), false);
});

test("payment and settlement schemas distinguish provider state from user reports", () => {
  assert.deepEqual(PaymentAttempt.schema.path("status").enumValues, ["CREATED", "PENDING", "AUTHORIZED", "TRANSFER_PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"]);
  assert.deepEqual(ExpenseSettlement.schema.path("source").enumValues, ["USER_REPORTED", "PROVIDER_VERIFIED"]);
});
