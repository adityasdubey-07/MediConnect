const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { createMySqlStore } = require("./mysql-store");

dotenv.config();

const databaseFile = path.join(__dirname, "data", "mediconnect.json");

async function migrate() {
  if (!fs.existsSync(databaseFile)) {
    throw new Error("Local database file was not found: data/mediconnect.json");
  }

  const store = createMySqlStore();

  if (!store) {
    throw new Error("MySQL is not configured in .env.");
  }

  const database = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  await store.save(database);
  await store.close();

  console.log("Existing local MediConnect data was migrated to MySQL.");
  console.log(`Users: ${database.users?.length || 0}`);
  console.log(`Providers: ${database.providers?.length || 0}`);
  console.log(`Documents: ${database.documents?.length || 0}`);
}

migrate().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
