const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const optionalAuth = require("../src/middleware/optional-auth");

const secret = "test-only-optional-auth-secret-with-at-least-thirty-two-characters";
const userId = new mongoose.Types.ObjectId();

const requestWithSession = () => {
  const token = jwt.sign({ v: 0 }, secret, {
    subject: userId.toString(),
    issuer: "tripbuddy",
    audience: "tripbuddy-web",
    expiresIn: "1m",
  });
  return { headers: { authorization: `Bearer ${token}` }, cookies: {} };
};

test("optional authentication includes account status and admits active sessions", async (context) => {
  process.env.JWT_SECRET = secret;
  let selectedFields;
  context.mock.method(User, "findById", () => ({
    select(fields) {
      selectedFields = fields;
      return Promise.resolve({ _id: userId, tokenVersion: 0, accountStatus: "ACTIVE" });
    },
  }));

  const request = requestWithSession();
  let middlewareError;
  await optionalAuth(request, {}, (error) => { middlewareError = error; });

  assert.equal(middlewareError, undefined);
  assert.match(selectedFields, /(?:^|\s)accountStatus(?:\s|$)/);
  assert.equal(request.user.accountStatus, "ACTIVE");
});

test("optional authentication treats suspended accounts as anonymous", async (context) => {
  process.env.JWT_SECRET = secret;
  context.mock.method(User, "findById", () => ({
    select() {
      return Promise.resolve({ _id: userId, tokenVersion: 0, accountStatus: "SUSPENDED" });
    },
  }));

  const request = requestWithSession();
  let middlewareError;
  await optionalAuth(request, {}, (error) => { middlewareError = error; });

  assert.equal(middlewareError, undefined);
  assert.equal(request.user, undefined);
});
