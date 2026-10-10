import { defineConfig } from "drizzle-kit";

// Generation only. There are deliberately no dbCredentials here: drizzle-kit can generate and
// check migration files but cannot push/migrate/introspect any database. Applying migrations is
// done by scripts/db-migrate.ts, which has its own target safety checks.
export default defineConfig({
  dialect: "postgresql",
  schema: "./app/db/schema/index.ts",
  out: "./drizzle",
  strict: true,
});
