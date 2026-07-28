// One-time setup for the test database: creates it (if missing) and applies migrations.
// Run with: node scripts/setup-test-db.mjs
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

const ADMIN_URL = "postgresql://postgres:postgres@localhost:5432/postgres?schema=public";
const TEST_DB_NAME = "sgd_project_management_test";
const TEST_URL = `postgresql://postgres:postgres@localhost:5432/${TEST_DB_NAME}?schema=public`;

async function ensureDatabaseExists() {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
    console.log(`Created database "${TEST_DB_NAME}".`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      console.log(`Database "${TEST_DB_NAME}" already exists.`);
    } else {
      throw err;
    }
  } finally {
    await admin.$disconnect();
  }
}

function applyMigrations() {
  console.log("Applying migrations to test database...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_URL },
  });
}

await ensureDatabaseExists();
applyMigrations();
console.log("Test database ready.");
