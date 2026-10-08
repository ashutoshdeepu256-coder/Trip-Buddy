const DEFAULT_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 250;
const entries = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

const get = (key, now = Date.now()) => {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return undefined;
  }
  return clone(entry.value);
};

const set = (key, value, ttlMs = DEFAULT_TTL_MS, now = Date.now()) => {
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey !== undefined) entries.delete(oldestKey);
  }
  entries.delete(key);
  entries.set(key, { value: clone(value), expiresAt: now + ttlMs });
  return value;
};

const clear = () => entries.clear();

module.exports = { get, set, clear, DEFAULT_TTL_MS };
