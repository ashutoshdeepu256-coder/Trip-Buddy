const windows = new Map();

const takeUserLimit = (userId, key, limit, windowMs) => {
  const now = Date.now();
  const bucketKey = `${userId}:${key}`;
  const bucket = windows.get(bucketKey);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    windows.set(bucketKey, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  if (windows.size > 10000) {
    for (const [keyName, value] of windows) if (now - value.startedAt >= windowMs) windows.delete(keyName);
  }
  return true;
};

module.exports = { takeUserLimit };
