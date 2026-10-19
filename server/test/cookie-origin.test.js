const test = require("node:test");
const assert = require("node:assert/strict");
const requireTrustedCookieOrigin = require("../src/middleware/cookie-origin");

const request = ({ method = "POST", cookie = true, origin }) => ({
  method,
  cookies: cookie ? { tripbuddy_session: "opaque-session" } : {},
  get: (name) => name.toLowerCase() === "origin" ? origin : undefined,
});

test("unsafe cookie-authenticated requests reject a different browser origin", () => {
  process.env.CLIENT_URL = "https://tripbuddy.example/";
  let error;
  requireTrustedCookieOrigin(request({ origin: "https://attacker.example" }), {}, (value) => { error = value; });
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, "REQUEST_ORIGIN_DENIED");
});

test("unsafe cookie-authenticated requests accept the configured origin", () => {
  process.env.CLIENT_URL = "https://tripbuddy.example";
  let error;
  requireTrustedCookieOrigin(request({ origin: "https://tripbuddy.example" }), {}, (value) => { error = value; });
  assert.equal(error, undefined);
});

test("safe methods and bearer-only clients are not subject to the cookie origin check", () => {
  process.env.CLIENT_URL = "https://tripbuddy.example";
  for (const req of [
    request({ method: "GET", origin: "https://attacker.example" }),
    request({ cookie: false, origin: "https://attacker.example" }),
  ]) {
    let error;
    requireTrustedCookieOrigin(req, {}, (value) => { error = value; });
    assert.equal(error, undefined);
  }
});
