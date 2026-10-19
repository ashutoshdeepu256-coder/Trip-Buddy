const { spawnSync } = require("node:child_process");
const path = require("node:path");

const uri = process.env.MONGODB_TEST_URI;
if (!uri) {
  console.error("MONGODB_TEST_URI is required for the integration suite; use a disposable test database.");
  process.exit(2);
}

let databaseName;
try {
  databaseName = new URL(uri).pathname.replace(/^\//, "").split("/")[0];
} catch {
  console.error("MONGODB_TEST_URI must be a valid MongoDB URI.");
  process.exit(2);
}

if (!/test/i.test(databaseName)) {
  console.error("Refusing integration tests: the database name must clearly identify a dedicated test database.");
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ["--test", "test/*.integration.test.js"],
  { cwd: path.resolve(__dirname, ".."), env: { ...process.env, NODE_ENV: "test" }, stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
