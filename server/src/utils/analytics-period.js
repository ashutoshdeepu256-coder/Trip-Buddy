const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const resolvePeriod = (query, now = new Date()) => {
  const window = query.window || (!query.from ? "30d" : "custom");
  if (window === "custom") return { from: new Date(query.from), to: new Date(query.to), bucket: "day", window };
  const duration = window === "24h" ? DAY : window === "7d" ? 7 * DAY : 30 * DAY;
  return { from: new Date(now.getTime() - duration), to: new Date(now), bucket: window === "24h" ? "hour" : "day", window };
};

const floorBucket = (date, bucket) => {
  const value = new Date(date);
  if (bucket === "hour") value.setUTCMinutes(0, 0, 0);
  else value.setUTCHours(0, 0, 0, 0);
  return value;
};

const bucketKeys = ({ from, to, bucket }) => {
  const keys = [];
  const step = bucket === "hour" ? HOUR : DAY;
  for (let cursor = floorBucket(from, bucket); cursor < to; cursor = new Date(cursor.getTime() + step)) {
    keys.push(cursor.toISOString());
  }
  return keys;
};

const fillSeries = (period, rows) => {
  const counts = new Map(rows.map((row) => [row._id, row.count]));
  return bucketKeys(period).map((at) => ({ at, count: counts.get(at) || 0 }));
};

const safeRatio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;

module.exports = { HOUR, DAY, resolvePeriod, floorBucket, bucketKeys, fillSeries, safeRatio };
