const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-with-at-least-thirty-two-characters";
const app = require("../app");

let server;
let origin;

test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const request = async (method, path, body) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined && !["GET", "HEAD"].includes(method) ? JSON.stringify(body) : undefined,
  });
  return { response, payload: await response.json() };
};

test("health API returns the standard successful envelope", async () => {
  const { response, payload } = await request("GET", "/api/v1/health");
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(typeof payload.data.timestamp, "string");
});

test("registration validates input before attempting database access", async () => {
  const { response, payload } = await request("POST", "/api/v1/auth/register", {});
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
});

test("login validates input before attempting database access", async () => {
  const { response, payload } = await request("POST", "/api/v1/auth/login", {});
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
});

test("email verification rejects a malformed token", async () => {
  const { response, payload } = await request("POST", "/api/v1/auth/verify-email", { token: "bad" });
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
});

test("invalid public profile identifiers fail before database access", async () => {
  const { response, payload } = await request("GET", "/api/v1/users/not-an-object-id");
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "INVALID_USER_ID");
});

const protectedRoutes = [
  ["GET", "/api/v1/auth/me"],
  ["POST", "/api/v1/auth/logout"],
  ["POST", "/api/v1/auth/resend-verification-email"],
  ["GET", "/api/v1/users/me"],
  ["PATCH", "/api/v1/users/me"],
  ["GET", "/api/v1/verifications/me"],
  ["GET", "/api/v1/verifications/history"],
  ["POST", "/api/v1/verifications/phone/send-otp"],
  ["POST", "/api/v1/verifications/phone/verify-otp"],
  ["POST", "/api/v1/verifications/identity"],
  ["GET", "/api/v1/verifications/identity/status"],
  ["POST", "/api/v1/verifications/identity/document"],
  ["GET", "/api/v1/admin/verifications"],
  ["GET", "/api/v1/admin/verifications/64b000000000000000000001"],
  ["POST", "/api/v1/admin/verifications/64b000000000000000000001/approve"],
  ["POST", "/api/v1/admin/verifications/64b000000000000000000001/reject"],
  ["POST", "/api/v1/admin/verifications/64b000000000000000000001/revoke"],
  ["GET", "/api/v1/admin/verifications/64b000000000000000000001/document"],
  ["POST", "/api/v1/safety/block/64b000000000000000000001"],
  ["DELETE", "/api/v1/safety/block/64b000000000000000000001"],
  ["GET", "/api/v1/safety/blocked-users"],
  ["POST", "/api/v1/safety/reports"],
  ["GET", "/api/v1/safety/admin/reports"],
  ["PATCH", "/api/v1/safety/admin/reports/64b000000000000000000001"],
];

for (const [method, path] of protectedRoutes) {
  test(`${method} ${path} requires authentication`, async () => {
    const body = ["GET", "HEAD"].includes(method) ? undefined : {};
    const { response, payload } = await request(method, path, body);
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
}

test("unknown API routes return a standard 404 response", async () => {
  const { response, payload } = await request("GET", "/api/v1/not-a-real-endpoint");
  assert.equal(response.status, 404);
  assert.equal(payload.error.code, "NOT_FOUND");
});

test("authentication endpoints apply an API-shaped rate limit", async () => {
  let last;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    last = await request("POST", "/api/v1/auth/login", {});
  }
  assert.equal(last.response.status, 429);
  assert.equal(last.payload.error.code, "RATE_LIMITED");
});
