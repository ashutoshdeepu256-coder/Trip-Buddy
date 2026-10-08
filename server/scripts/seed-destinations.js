const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const Destination = require("../src/models/Destination");

const run = async () => {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      "Usage: npm run seed:destinations -- <path-to-destinations.json>",
    );
  }
  if (!process.env.MONGODB_URI)
    throw new Error("MONGODB_URI must be configured");

  const records = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(
      "Seed input must be a non-empty JSON array of destination records",
    );
  }
  await Promise.all(
    records.map((record) => new Destination(record).validate()),
  );

  await mongoose.connect(process.env.MONGODB_URI);
  const operations = records.map((record) => ({
    updateOne: {
      filter: { slug: record.slug },
      update: { $set: record },
      upsert: true,
    },
  }));
  const result = await Destination.bulkWrite(operations, { ordered: true });
  console.log(
    `Destination import complete: ${result.upsertedCount} inserted, ${result.modifiedCount} updated.`,
  );
};

run()
  .catch((error) => {
    console.error(`Destination import failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
