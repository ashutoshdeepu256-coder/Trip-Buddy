const { HttpError } = require("../utils/http");

const catalog = [
  { id: "accommodation-search", category: "ACCOMMODATION", name: "Accommodation search", provider: "GOOGLE_TRAVEL", host: "www.google.com", path: "/travel/hotels", label: "Search hotels on Google Travel", capabilities: { search: "External handoff", availability: false, pricing: false, reservation: false, cancellation: false, refunds: false } },
  { id: "transport-search", category: "TRANSPORT", name: "Flight search", provider: "GOOGLE_TRAVEL", host: "www.google.com", path: "/travel/flights", label: "Search flights on Google Travel", capabilities: { search: "External handoff", availability: false, pricing: false, reservation: false, cancellation: false, refunds: false } },
  { id: "activity-search", category: "ACTIVITY", name: "Activities and places", provider: "GOOGLE_MAPS", host: "www.google.com", path: "/maps/search/", label: "Search activities on Google Maps", capabilities: { search: "External handoff", availability: false, pricing: false, reservation: false, cancellation: false, refunds: false } },
];

const categories = () => [
  { id: "ACCOMMODATION", label: "Accommodation" },
  { id: "TRANSPORT", label: "Transport" },
  { id: "ACTIVITY", label: "Activities and attractions" },
];

const list = (category) => catalog.filter((entry) => !category || entry.category === category).map(({ id, category: kind, name, provider, label, capabilities: supported }) => ({ id, category: kind, name, provider, label, capabilities: supported }));

const createExternalUrl = (id, destination, startDate, endDate, travellers) => {
  const entry = catalog.find((item) => item.id === id);
  if (!entry) throw new HttpError(400, "Unsupported travel service", "UNSUPPORTED_SERVICE");
  const url = new URL(entry.path, `https://${entry.host}`);
  if (entry.category === "ACTIVITY") url.pathname += encodeURIComponent(destination);
  else url.searchParams.set("q", destination);
  url.searchParams.set("checkin", startDate);
  url.searchParams.set("checkout", endDate);
  url.searchParams.set("adults", String(travellers));
  return { entry, url: url.toString() };
};

const get = (id) => {
  const entry = list().find((item) => item.id === id);
  if (!entry) throw new HttpError(404, "Travel service was not found", "SERVICE_NOT_FOUND");
  return entry;
};

module.exports = { categories, list, get, createExternalUrl };
