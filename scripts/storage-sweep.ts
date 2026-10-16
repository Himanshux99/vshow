// Manual clean-up of abandoned and rejected media uploads.
// Usage: npm run storage:sweep -- --run
//
// What it does (and ONLY this):
//   1. marks upload reservations that were never finalized and have expired as EXPIRED;
//   2. deletes the staging / final objects of EXPIRED and REJECTED reservations, but ONLY keys that no media
//      version references. Referenced (finalized, approved or historical) media is never deleted.
// Safe to run repeatedly. It uses the same configuration as the app (.env): a database and, for the deletions,
// configured object storage. Without --run it only prints this explanation.
import { createContainer } from "../app/server/container.server.ts";
import { sweepAbandonedUploads } from "../app/submissions/uploads.server.ts";

if (!process.argv.includes("--run")) {
  console.log("Closes expired upload reservations and deletes their UNREFERENCED storage objects.");
  console.log("Re-run with --run to do it: npm run storage:sweep -- --run");
  process.exit(2);
}

const deps = createContainer(process.env);
try {
  if (!deps.storage.configured) {
    console.error("✖ Media storage is not configured (NEON_STORAGE_*); nothing was changed.");
    process.exitCode = 1;
  } else {
    const result = await sweepAbandonedUploads(deps);
    console.log(`✔ Closed ${result.closed} expired reservation(s); deleted ${result.deleted} unreferenced object(s).`);
  }
} catch (err) {
  process.exitCode = 1;
  // Never print the error object: it could carry connection details.
  console.error(`✖ Sweep failed (${err instanceof Error ? err.name : "error"}). Nothing further was changed.`);
} finally {
  await deps.database.close();
}
