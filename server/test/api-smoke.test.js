const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-with-at-least-thirty-two-characters";
const app = require("../app");
const destinationService = require("../src/services/destination.service");
const tripDiscoveryService = require("../src/services/tripDiscovery.service");

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

test("destination search validates pagination without requiring database access", async () => {
  const { response, payload } = await request("GET", "/api/v1/destinations?page=0");
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
});

test("nearby destination search requires valid coordinates", async () => {
  const { response, payload } = await request("GET", "/api/v1/destinations/nearby?lat=91&lng=0");
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
});

test("maps API reports capabilities and returns a labeled straight-line distance", async () => {
  const capabilities = await request("GET", "/api/v1/maps/capabilities");
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.payload.data.mapRendering, "client");
  assert.equal(capabilities.payload.data.nearbyPlaces, false);
  const distance = await request("POST", "/api/v1/maps/distance", {
    from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 1 },
  });
  assert.equal(distance.response.status, 200);
  assert.equal(distance.payload.data.distanceKm, 111.2);
  assert.equal(distance.payload.data.method, "great-circle");
  assert.equal("durationSeconds" in distance.payload.data, false);
  const invalid = await request("POST", "/api/v1/maps/distance", {
    from: { lat: 91, lng: 0 }, to: { lat: 0, lng: 1 },
  });
  assert.equal(invalid.response.status, 400);
});

test("destination listing endpoint is public and returns validated pagination", async (context) => {
  context.mock.method(destinationService, "listDestinations", async (options) => {
    assert.equal(options.page, 2);
    assert.equal(options.limit, 3);
    assert.equal(options.search, "Oslo");
    return { items: [], pagination: { page: 2, limit: 3, total: 0, pages: 0 } };
  });
  const { response, payload } = await request("GET", "/api/v1/destinations?search=Oslo&page=2&limit=3");
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.deepEqual(payload.data.pagination, { page: 2, limit: 3, total: 0, pages: 0 });
});

test("popular, trending, nearby, and detail destination endpoints are wired", async (context) => {
  const rankedKinds = [];
  context.mock.method(destinationService, "listByRank", async ({ kind }) => {
    rankedKinds.push(kind);
    return {
      items: [{ slug: `${kind}-destination` }],
      pagination: { page: 1, limit: 12, total: 1, pages: 1 },
    };
  });

  test("trip discovery endpoint validates filters and returns the discovery envelope", async (context) => {
    const discover = context.mock.method(tripDiscoveryService, "discoverTrips", async (filters, user) => {
      assert.equal(filters.destination, "coastal-example");
      assert.equal(filters.budgetCurrency, "INR");
      assert.equal(filters.budgetMin, 1000);
      assert.deepEqual(filters.interests, ["food", "history"]);
      assert.equal(filters.limit, 20);
      assert.equal(user, null);
      return { items: [], page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false };
    });
    const { response, payload } = await request(
      "GET",
      "/api/v1/trips?destination=coastal-example&budgetMin=1000&budgetCurrency=inr&interests=Food,history",
    );
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, {
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    assert.equal(discover.mock.callCount(), 1);
  });

  test("trip discovery rejects unsafe and unbounded query parameters before service access", async () => {
    for (const query of ["limit=1000", "dateFlexibility=2", "budgetMin=100", "sort=%24where"]) {
      const { response, payload } = await request("GET", `/api/v1/trips?${query}`);
      assert.equal(response.status, 400);
      assert.equal(payload.error.code, "VALIDATION_ERROR");
    }
  });
  for (const kind of ["seasonal", "budget", "adventure"]) {
    context.mock.method(destinationService, `list${kind[0].toUpperCase()}${kind.slice(1)}`, async (options) => ({
      items: [{ slug: `${kind === "seasonal" ? `${kind}-${options.month}` : kind}-destination` }],
      pagination: { page: 1, limit: 12, total: 1, pages: 1 },
    }));
  }
  const nearby = context.mock.method(destinationService, "listNearby", async (options) => {
    assert.equal(options.lat, 37);
    assert.equal(options.lng, -122);
    return { items: [], pagination: { page: 1, limit: 12, total: 0, pages: 0 } };
  });
  const detail = context.mock.method(destinationService, "getDestination", async (id) => ({ slug: id }));

  const popular = await request("GET", "/api/v1/destinations/popular");
  assert.equal(popular.payload.data.items[0].slug, "popular-destination");
  const trending = await request("GET", "/api/v1/destinations/trending");
  assert.equal(trending.payload.data.items[0].slug, "trending-destination");
  const seasonal = await request("GET", "/api/v1/destinations/seasonal?month=5");
  assert.equal(seasonal.payload.data.items[0].slug, "seasonal-5-destination");
  const budget = await request("GET", "/api/v1/destinations/budget");
  assert.equal(budget.payload.data.items[0].slug, "budget-destination");
  const adventure = await request("GET", "/api/v1/destinations/adventure");
  assert.equal(adventure.payload.data.items[0].slug, "adventure-destination");
  const near = await request("GET", "/api/v1/destinations/nearby?lat=37&lng=-122");
  assert.equal(near.response.status, 200);
  const destination = await request("GET", "/api/v1/destinations/sample-slug");
  assert.equal(destination.payload.data.slug, "sample-slug");
  assert.deepEqual(rankedKinds, ["popular", "trending"]);
  assert.equal(nearby.mock.callCount(), 1);
  assert.equal(detail.mock.callCount(), 1);
});

const protectedRoutes = [
  ["GET", "/api/v1/auth/me"],
  ["POST", "/api/v1/auth/logout"],
  ["POST", "/api/v1/auth/resend-verification-email"],
  ["GET", "/api/v1/users/me"],
  ["PATCH", "/api/v1/users/me"],
  ["GET", "/api/v1/matches"],
  ["GET", "/api/v1/connections"],
  ["GET", "/api/v1/chat/conversations"],
  ["POST", "/api/v1/chat/conversations/direct"],
  ["POST", "/api/v1/chat/trips/507f1f77bcf86cd799439011/conversation"],
  ["GET", "/api/v1/chat/conversations/507f1f77bcf86cd799439011"],
  ["GET", "/api/v1/chat/conversations/507f1f77bcf86cd799439011/messages"],
  ["POST", "/api/v1/chat/conversations/507f1f77bcf86cd799439011/messages"],
  ["POST", "/api/v1/chat/conversations/507f1f77bcf86cd799439011/read"],
  ["GET", "/api/v1/chat/unread"],
  ["GET", "/api/v1/itineraries"],
  ["GET", "/api/v1/itineraries/shared"],
  ["POST", "/api/v1/itineraries/generate"],
  ["GET", "/api/v1/bookings/categories"],
  ["GET", "/api/v1/bookings/services"],
  ["GET", "/api/v1/bookings"],
  ["POST", "/api/v1/bookings"],
  ["GET", "/api/v1/bookings/507f1f77bcf86cd799439011"],
  ["POST", "/api/v1/bookings/507f1f77bcf86cd799439011/cancel"],
  ["GET", "/api/v1/expenses/trips/507f1f77bcf86cd799439011"],
  ["POST", "/api/v1/expenses/trips/507f1f77bcf86cd799439011"],
  ["GET", "/api/v1/expenses/trips/507f1f77bcf86cd799439011/summary"],
  ["GET", "/api/v1/expenses/trips/507f1f77bcf86cd799439011/settlements/suggestions"],
  ["POST", "/api/v1/expenses/trips/507f1f77bcf86cd799439011/settlements"],
  ["GET", "/api/v1/payments"],
  ["POST", "/api/v1/payments"],
  ["GET", "/api/v1/payments/507f1f77bcf86cd799439011"],
  ["POST", "/api/v1/payments/507f1f77bcf86cd799439011/verify"],
  ["POST", "/api/v1/payments/507f1f77bcf86cd799439011/reconcile"],
  ["POST", "/api/v1/payments/507f1f77bcf86cd799439011/refund"],
  ["POST", "/api/v1/reviews"],
  ["GET", "/api/v1/reviews/trips/507f1f77bcf86cd799439011/eligibility"],
  ["GET", "/api/v1/reviews/507f1f77bcf86cd799439011"],
  ["PATCH", "/api/v1/reviews/507f1f77bcf86cd799439011"],
  ["DELETE", "/api/v1/reviews/507f1f77bcf86cd799439011"],
  ["POST", "/api/v1/reviews/507f1f77bcf86cd799439011/reports"],
  ["GET", "/api/v1/admin/reviews/reports"],
  ["PATCH", "/api/v1/admin/reviews/507f1f77bcf86cd799439011"],
  ["GET", "/api/v1/itineraries/507f1f77bcf86cd799439011/shared"],
  ["PUT", "/api/v1/itineraries/507f1f77bcf86cd799439011/collaboration"],
  ["GET", "/api/v1/itineraries/507f1f77bcf86cd799439011/collaborators"],
  ["PUT", "/api/v1/itineraries/507f1f77bcf86cd799439011/collaborators"],
  ["DELETE", "/api/v1/itineraries/507f1f77bcf86cd799439011/collaborators"],
  ["POST", "/api/v1/itineraries/507f1f77bcf86cd799439011/activities"],
  ["PATCH", "/api/v1/itineraries/507f1f77bcf86cd799439011/activities/507f1f77bcf86cd799439012"],
  ["DELETE", "/api/v1/itineraries/507f1f77bcf86cd799439011/activities/507f1f77bcf86cd799439012"],
  ["PUT", "/api/v1/itineraries/507f1f77bcf86cd799439011/activities/order"],
  ["PUT", "/api/v1/itineraries/507f1f77bcf86cd799439011/days/order"],
  ["POST", "/api/v1/itineraries/507f1f77bcf86cd799439011/days"],
  ["PATCH", "/api/v1/itineraries/507f1f77bcf86cd799439011/days/507f1f77bcf86cd799439012"],
  ["DELETE", "/api/v1/itineraries/507f1f77bcf86cd799439011/days/507f1f77bcf86cd799439012"],
  ["GET", "/api/v1/itineraries/507f1f77bcf86cd799439011/history"],
  ["POST", "/api/v1/itineraries/507f1f77bcf86cd799439011/restore"],
  ["POST", "/api/v1/itineraries/507f1f77bcf86cd799439011/days/1/regenerate"],
  ["GET", "/api/v1/connections/requests/received"],
  ["GET", "/api/v1/connections/requests/sent"],
  ["POST", "/api/v1/connections"],
  ["GET", "/api/v1/connections/507f1f77bcf86cd799439011"],
  ["POST", "/api/v1/connections/507f1f77bcf86cd799439011/accept"],
  ["GET", "/api/v1/matches/507f1f77bcf86cd799439011"],
  ["GET", "/api/v1/trips/507f1f77bcf86cd799439011/compatibility"],
  ["POST", "/api/v1/trips/507f1f77bcf86cd799439011/matches/refresh"],
  ["POST", "/api/v1/trips/507f1f77bcf86cd799439011/group-recommendations/generate"],
  ["GET", "/api/v1/trips/507f1f77bcf86cd799439011/group-recommendations"],
  ["GET", "/api/v1/group-recommendations/507f1f77bcf86cd799439011"],
  ["POST", "/api/v1/group-recommendations/507f1f77bcf86cd799439011/accept"],
  ["POST", "/api/v1/group-recommendations/507f1f77bcf86cd799439011/reject"],
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
  ["GET", "/api/v1/notifications"],
  ["GET", "/api/v1/notifications/unread-count"],
  ["GET", "/api/v1/notifications/preferences"],
  ["PATCH", "/api/v1/notifications/read"],
  ["PATCH", "/api/v1/notifications/64b000000000000000000001/read"],
  ["DELETE", "/api/v1/notifications/64b000000000000000000001"],
  ["GET", "/api/v1/assistant/conversations"],
  ["POST", "/api/v1/assistant/conversations"],
  ["GET", "/api/v1/assistant/usage"],
  ["GET", "/api/v1/assistant/conversations/64b000000000000000000001/messages"],
  ["POST", "/api/v1/assistant/conversations/64b000000000000000000001/messages"],
  ["PATCH", "/api/v1/assistant/conversations/64b000000000000000000001/archive"],
  ["DELETE", "/api/v1/assistant/conversations/64b000000000000000000001"],
  ["POST", "/api/v1/safety/reports"],
  ["GET", "/api/v1/safety/admin/reports"],
  ["PATCH", "/api/v1/safety/admin/reports/64b000000000000000000001"],
  ["GET", "/api/v1/users/me/trips"],
  ["POST", "/api/v1/trips"],
  ["PATCH", "/api/v1/trips/64b000000000000000000001"],
  ["DELETE", "/api/v1/trips/64b000000000000000000001"],
  ["POST", "/api/v1/trips/64b000000000000000000001/publish"],
  ["POST", "/api/v1/trips/64b000000000000000000001/cancel"],
  ["POST", "/api/v1/trips/64b000000000000000000001/status"],
  ["POST", "/api/v1/trips/64b000000000000000000001/images"],
];

for (const [method, path] of protectedRoutes) {
  test(`${method} ${path} requires authentication`, async () => {
    const body = ["GET", "HEAD"].includes(method) ? undefined : {};
    const { response, payload } = await request(method, path, body);
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNAUTHENTICATED");
  });
}

test("trip detail rejects malformed ids before database access", async () => {
  const { response, payload } = await request("GET", "/api/v1/trips/not-an-id");
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "VALIDATION_ERROR");
});

test("public review endpoints validate Trip and traveler ids before database access", async () => {
  const traveller = await request("GET", "/api/v1/reviews/travellers/not-an-id");
  assert.equal(traveller.response.status, 400);
  assert.equal(traveller.payload.error.code, "VALIDATION_ERROR");
  const trip = await request("GET", "/api/v1/reviews/trips/not-an-id");
  assert.equal(trip.response.status, 400);
  assert.equal(trip.payload.error.code, "VALIDATION_ERROR");
});

test("trip creation rejects invalid draft fields after authentication", async () => {
  const { response, payload } = await request("POST", "/api/v1/trips", { destination: "invalid" });
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, "UNAUTHENTICATED");
});

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
