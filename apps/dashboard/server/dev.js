import { spawn } from "node:child_process";

const children = [];

/**
 * `npm run dev` is the single most likely way a second copy of the API ends up
 * running next to the real one -- on a laptop, in a second container, or just
 * an old terminal that never got closed. A second copy is not a dry run: it
 * shares the same runtime database, the same Google Sheet, and the same bot,
 * so it expires the same pending orders, syncs the same payments, and sends the
 * same WhatsApp messages on a timer.
 *
 * So the background jobs are off by default here, and turning them back on is
 * deliberate:
 *
 *   DISABLE_BACKGROUND_JOBS=0 npm run dev
 *
 * Set before `spawn`, and passed through explicitly, so it reaches the child
 * even if this process was started with a scrubbed environment. `dotenv` does
 * not override variables that are already set, so the value below wins over
 * anything in `.env` -- which is the point: `.env` is the production
 * configuration and must not quietly re-arm the jobs on a laptop.
 */
const apiEnv = { ...process.env, DISABLE_BACKGROUND_JOBS: process.env.DISABLE_BACKGROUND_JOBS ?? "1" };

function run(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    shell: true,
    stdio: "inherit",
    env,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !process.exitCode) process.exitCode = code;
  });
  console.log(`[dev] ${name} started`);
}

run("api", "node", ["server/index.js"], apiEnv);
run("web", "vite", ["--host", "127.0.0.1", "--port", "5174"]);

function shutdown() {
  for (const child of children) child.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
