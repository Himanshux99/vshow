// Runs `react-router typegen` then `tsc`.
//
// typegen loads vite.config.ts as a "build", and that config deliberately throws when VSHOW_DEV_AUTH is set (the dev
// identity switcher must never be built into a deployable bundle). The flag normally comes from .env for local dev,
// which would make typecheck fail. Typegen only generates types, so clear the flag for this process only. A real
// `npm run build` is untouched and still refuses to run with the flag set.
import { spawnSync } from "node:child_process";

const env = { ...process.env, VSHOW_DEV_AUTH: "" };

for (const command of ["npx react-router typegen", "npx tsc"]) {
  const result = spawnSync(command, { stdio: "inherit", env, shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
