const test = require("node:test");
const assert = require("node:assert/strict");
const maps = require("../src/services/maps.service");
const { geocodeQuerySchema, reverseQuerySchema, routeBodySchema, distanceBodySchema } = require("../src/validators/maps.validator");
const { nearbyQuerySchema } = require("../src/validators/destination");
const { discoveryQuerySchema } = require("../src/validators/trip-discovery.validator");

test("coordinate and radius inputs enforce ranges, pair requirements, and bounded searches", () => {
  assert.equal(nearbyQuerySchema.safeParse({ lat: "91", lng: "0" }).success, false);
  assert.equal(nearbyQuerySchema.safeParse({ lat: "40", lng: "-73", radiusKm: "501" }).success, false);
  assert.equal(nearbyQuerySchema.parse({ lat: "40", lng: "-73" }).radiusKm, 100);
  assert.equal(discoveryQuerySchema.safeParse({ lat: "40" }).success, false);
  assert.equal(discoveryQuerySchema.safeParse({ lat: "40", lng: "-73", radiusKm: "500" }).success, true);
  assert.equal(reverseQuerySchema.parse({ lat: "1", lng: "2" }).lng, 2);
  assert.equal(routeBodySchema.safeParse({ waypoints: Array(7).fill({ lat: 0, lng: 0 }) }).success, false);
  assert.equal(geocodeQuerySchema.safeParse({ query: "x" }).success, false);
  assert.equal(distanceBodySchema.safeParse({ from: { lat: 91, lng: 0 }, to: { lat: 0, lng: 0 } }).success, false);
});

test("straight-line distance is explicitly great-circle and does not invent travel time", () => {
  const result = maps.straightLineDistance({ from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 1 } });
  assert.equal(result.method, "great-circle");
  assert.equal(result.distanceKm, 111.2);
  assert.equal("durationSeconds" in result, false);
});

test("provider capability and configuration report disabled operations without a server token", (context) => {
  const previous = process.env.MAPBOX_SERVER_TOKEN;
  delete process.env.MAPBOX_SERVER_TOKEN;
  context.after(() => previous === undefined ? delete process.env.MAPBOX_SERVER_TOKEN : process.env.MAPBOX_SERVER_TOKEN = previous);
  assert.equal(maps.capabilities().fallback, "OpenStreetMap embed");
  assert.equal(maps.capabilities().geocoding, false);
  assert.equal(maps.capabilities().routing, false);
  assert.equal(maps.capabilities().nearbyPlaces, false);
});

test("provider errors are safely mapped for quota, timeout, and unavailable service", async () => {
  await assert.rejects(maps.requestJson("https://maps.example.test", async () => ({ ok: false, status: 429 })), (error) => error.code === "MAPS_PROVIDER_RATE_LIMITED");
  await assert.rejects(maps.requestJson("https://maps.example.test", async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; }), (error) => error.code === "MAPS_PROVIDER_TIMEOUT");
  await assert.rejects(maps.requestJson("https://maps.example.test", async () => { throw new Error("private error text"); }), (error) => error.code === "MAPS_PROVIDER_UNAVAILABLE" && !error.message.includes("private"));
});

test("Mapbox responses are minimized and coordinates keep GeoJSON longitude-latitude ordering", async (context) => {
  const previous = process.env.MAPBOX_SERVER_TOKEN;
  process.env.MAPBOX_SERVER_TOKEN = "test-token";
  context.after(() => previous === undefined ? delete process.env.MAPBOX_SERVER_TOKEN : process.env.MAPBOX_SERVER_TOKEN = previous);
  let requested;
  const fetchImpl = async (url) => {
    requested = new URL(url);
    return { ok: true, status: 200, json: async () => ({ features: [{ properties: { full_address: "Sample, World", coordinates: { longitude: -73.9, latitude: 40.7 }, mapbox_id: "private-provider-id" }, geometry: { coordinates: [-73.9, 40.7] } }] }) };
  };
  const found = await maps.geocode("Sample", fetchImpl);
  assert.deepEqual(found, [{ label: "Sample, World", coordinates: { lng: -73.9, lat: 40.7 }, provider: "Mapbox" }]);
  assert.equal(requested.searchParams.get("access_token"), "test-token");
  assert.equal(requested.pathname, "/search/geocode/v6/forward");
  assert.equal(requested.searchParams.get("q"), "Sample");
  const reverse = await maps.reverseGeocode({ lat: 40.7, lng: -73.9 }, async (url) => {
    requested = new URL(url);
    return { ok: true, status: 200, json: async () => ({ features: [{ properties: { name: "Sample" } }] }) };
  });
  assert.equal(requested.pathname, "/search/geocode/v6/reverse");
  assert.equal(requested.searchParams.get("longitude"), "-73.9");
  assert.equal(reverse.label, "Sample");
  const result = await maps.route({ profile: "walking", waypoints: [{ lat: 40.7, lng: -73.9 }, { lat: 40.8, lng: -73.8 }] }, async (url) => {
    assert.match(String(url), /-73\.9,40\.7;-73\.8,40\.8/);
    return { ok: true, status: 200, json: async () => ({ routes: [{ distance: 2500, duration: 1800, geometry: "omitted" }] }) };
  });
  assert.equal(result.distanceMeters, 2500);
  assert.equal(result.estimate, true);
  assert.equal("geometry" in result, false);
});
