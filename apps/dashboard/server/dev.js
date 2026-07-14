import { spawn } from "node:child_process";

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && !process.exitCode) process.exitCode = code;
  });
  console.log(`[dev] ${name} started`);
}

run("api", "node", ["server/index.js"]);
run("web", "vite", ["--host", "127.0.0.1", "--port", "5174"]);

function shutdown() {
  for (const child of children) child.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
