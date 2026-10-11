const { HttpError } = require("../utils/http");

const MAPBOX_BASE = "https://api.mapbox.com";
const timeoutMs = () => {
  const configured = Number(process.env.MAPS_PROVIDER_TIMEOUT_MS || 4500);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 500), 10000) : 4500;
};

const capabilities = () => ({
  mapRendering: "client",
  fallback: "OpenStreetMap embed",
  geocoding: Boolean(process.env.MAPBOX_SERVER_TOKEN),
  routing: Boolean(process.env.MAPBOX_SERVER_TOKEN),
  nearbyPlaces: false,
});

const requestJson = async (url, fetchImpl = fetch) => {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (response.status === 429) throw new HttpError(503, "Maps provider is rate limited; retry later", "MAPS_PROVIDER_RATE_LIMITED");
    if (!response.ok) throw new HttpError(502, "Maps provider request failed", "MAPS_PROVIDER_ERROR");
    const body = await response.json();
    if (body.message && body.code && body.code !== "Ok") {
      throw new HttpError(502, "Maps provider could not complete the request", "MAPS_PROVIDER_ERROR");
    }
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.name === "AbortError") throw new HttpError(504, "Maps provider request timed out", "MAPS_PROVIDER_TIMEOUT");
    throw new HttpError(502, "Maps provider is unavailable", "MAPS_PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
};

const tokenOrUnavailable = () => {
  const token = process.env.MAPBOX_SERVER_TOKEN;
  if (!token) throw new HttpError(503, "Geocoding and routing are unavailable until a server maps provider is configured", "MAPS_PROVIDER_UNCONFIGURED");
  return token;
};

const geocode = async (query, fetchImpl) => {
  const token = tokenOrUnavailable();
  const url = new URL("/search/geocode/v6/forward", MAPBOX_BASE);
  url.searchParams.set("access_token", token);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  const body = await requestJson(url, fetchImpl);
  return (body.features || []).map((feature) => ({
    label: feature.properties?.full_address || feature.properties?.place_formatted || feature.properties?.name,
    coordinates: {
      lng: feature.properties?.coordinates?.longitude ?? feature.geometry?.coordinates?.[0],
      lat: feature.properties?.coordinates?.latitude ?? feature.geometry?.coordinates?.[1],
    },
    provider: "Mapbox",
  })).filter((item) => item.label && Number.isFinite(item.coordinates.lng) && Number.isFinite(item.coordinates.lat));
};

const reverseGeocode = async ({ lat, lng }, fetchImpl) => {
  const token = tokenOrUnavailable();
  const url = new URL("/search/geocode/v6/reverse", MAPBOX_BASE);
  url.searchParams.set("access_token", token);
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("limit", "1");
  const body = await requestJson(url, fetchImpl);
  const feature = body.features?.[0];
  const label = feature?.properties?.full_address || feature?.properties?.place_formatted || feature?.properties?.name;
  return label ? { label, coordinates: { lng, lat }, provider: "Mapbox" } : null;
};

const route = async ({ profile, waypoints }, fetchImpl) => {
  const token = tokenOrUnavailable();
  const coordinates = waypoints.map(({ lat, lng }) => `${lng},${lat}`).join(";");
  const url = new URL(`/directions/v5/mapbox/${profile}/${coordinates}`, MAPBOX_BASE);
  url.searchParams.set("access_token", token);
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  const body = await requestJson(url, fetchImpl);
  const candidate = body.routes?.[0];
  if (!candidate || !Number.isFinite(candidate.distance) || !Number.isFinite(candidate.duration)) return null;
  return {
    distanceMeters: candidate.distance,
    durationSeconds: candidate.duration,
    profile,
    provider: "Mapbox",
    retrievedAt: new Date().toISOString(),
    estimate: true,
  };
};

const straightLineDistance = ({ from, to }) => {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return { distanceKm: Math.round(6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)) * 10) / 10, method: "great-circle", estimate: true };
};

module.exports = { capabilities, geocode, reverseGeocode, route, straightLineDistance, requestJson };
