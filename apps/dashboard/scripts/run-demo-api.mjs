/**
 * Start the API against the synthetic demo database.
 *
 * A script rather than an npm one-liner for two reasons. `OWNER_PASSWORD`
 * contains a `#`, which a shell would treat as the start of a comment on some
 * platforms and not others, so an inline `OWNER_PASSWORD=...` is not portable.
 * And `cross-env` is not a dependency here, so the inline form would only work
 * on a POSIX shell. Doing it in Node sidesteps both.
 *
 * Also worth knowing why the owner credentials are set at all: on every boot
 * the settings migration compares `OWNER_PASSWORD` against the stored hash and
 * *overwrites* the hash when they disagree (see the migration in
 * server/index.js). Pointing the API at the demo database without also setting
 * these would let the production password in `.env` take the demo database's
 * owner account over -- and then the demo login would stop working.
 *
 *   npm run demo:api
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_OWNER } from "./demo-credentials.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..");
const databasePath = path.resolve(process.env.DEMO_DATABASE_PATH || path.join(dashboardRoot, "runtime-demo", "kavya-db.json"));

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: dashboardRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_PATH: databasePath,
    // Same reasoning as the guard in server/index.js: a demo run has no business
    // expiring orders, syncing a Sheet, or messaging anyone. This is belt and
    // braces -- the demo database is synthetic, so there is nothing real to
    // damage -- but the flag is free and the failure mode it prevents is not.
    DISABLE_BACKGROUND_JOBS: "1",
    OWNER_USERNAME: DEMO_OWNER.username,
    OWNER_PASSWORD: DEMO_OWNER.password,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
