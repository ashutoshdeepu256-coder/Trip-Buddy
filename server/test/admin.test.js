const test = require("node:test");
const assert = require("node:assert/strict");
const adminSchemas = require("../src/validators/admin.validator");
const { requireAdmin, requireModerator } = require("../src/middleware/auth");
const app = require("../app");

let server;
let origin;
test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("admin APIs deny anonymous access before reading protected data", async () => {
  for (const path of ["/api/v1/admin/overview", "/api/v1/admin/users", "/api/v1/admin/trips", "/api/v1/admin/audit"]) {
    const response = await fetch(`${origin}${path}`);
    const payload = await response.json();
    assert.equal(response.status, 401, path);
    assert.equal(payload.error.code, "UNAUTHENTICATED", path);
  }
});

test("admin guard denies users and moderators and accepts only administrators", () => {
  for (const role of ["USER", "MODERATOR", undefined]) {
    let error;
    requireAdmin({ user: { role } }, {}, (nextError) => { error = nextError; });
    assert.equal(error?.statusCode, 403);
  }
  let accepted = false;
  requireAdmin({ user: { role: "ADMIN" } }, {}, (error) => { assert.equal(error, undefined); accepted = true; });
  assert.equal(accepted, true);
  for (const role of ["MODERATOR", "ADMIN"]) {
    let acceptedStaff = false;
    requireModerator({ user: { role } }, {}, (error) => { assert.equal(error, undefined); acceptedStaff = true; });
    assert.equal(acceptedStaff, true);
  }
});

test("admin validators reject unbounded pagination, unknown fields, and missing reasons", () => {
  assert.equal(adminSchemas.userQuery.safeParse({ page: "1", limit: "500" }).success, false);
  assert.equal(adminSchemas.userQuery.safeParse({ page: "1", limit: "20", $where: "x" }).success, false);
  assert.equal(adminSchemas.statusBody.safeParse({ status: "SUSPENDED" }).success, false);
  assert.equal(adminSchemas.roleBody.safeParse({ role: "ADMIN", reason: "promotion" }).success, false);
  assert.equal(adminSchemas.statusBody.safeParse({ status: "SUSPENDED", reason: "Confirmed policy violation" }).success, true);
});

test("audit and trip query validators bound filters and page size", () => {
  assert.equal(adminSchemas.tripQuery.safeParse({ page: "1", limit: "20", status: "PUBLISHED" }).success, true);
  assert.equal(adminSchemas.tripQuery.safeParse({ page: "1", limit: "20", status: "UNKNOWN" }).success, false);
  assert.equal(adminSchemas.auditQuery.safeParse({ page: "1", limit: "51" }).success, false);
});
