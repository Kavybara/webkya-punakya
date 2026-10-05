import { config } from "./config.js";
import { installConsoleRedaction } from "../../packages/shared/observability.mjs";
import { createLogger } from "./lib/logger.js";
import { ensureRuntimeDirs } from "./lib/runtime.js";
import { JsonStore } from "./lib/json-store.js";
import { loadPlugins } from "./lib/plugin-loader.js";
import { createWhatsAppConnection } from "./handle/connection.js";
import { createHttpServer } from "./handle/server.js";
import { logError, logHandler, logRuntimeBanner, logStartup, logSuccess, logWarning } from "./lib/panel-log.js";

const noisyConsolePrefixes = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Migrating session to:",
  "Closing open session in favor of incoming prekey bundle",
  "Decrypted message with closed session",
  "Failed to decrypt message with any known session",
  "Session error:",
  "Bad MAC",
  "No matching sessions found for message",
];

function isNoisyConsoleMessage(args) {
  return args.some((arg) => {
    if (arg && typeof arg === "object") {
      const ctor = arg.constructor?.name || "";
      if (/SessionEntry/i.test(ctor)) return true;
      if (arg._chains && arg.indexInfo && arg.currentRatchet) return true;
    }
    const text = String(arg?.message || arg || "");
    return (
      noisyConsolePrefixes.some((prefix) => text.startsWith(prefix)) ||
      /Decrypted message with closed session|Closing session: SessionEntry|No matching sessions found for message|Bad MAC/i.test(text)
    );
  });
}

const originalConsoleInfo = console.info.bind(console);
console.info = (...args) => {
  if (isNoisyConsoleMessage(args)) return;
  originalConsoleInfo(...args);
};
const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (isNoisyConsoleMessage(args)) return;
  originalConsoleWarn(...args);
};
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  if (isNoisyConsoleMessage(args)) return;
  originalConsoleError(...args);
};
const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  if (isNoisyConsoleMessage(args)) return;
  originalConsoleLog(...args);
};

function runtimeErrorMessage(error) {
  return String(error?.stack || error?.message || error || "");
}

function isWhatsAppTransportError(error) {
  return /write EPIPE|EPIPE|ECONNRESET|ETIMEDOUT|Timed Out|socket.*closed|connection.*closed|stream.*closed|WebSocket/i.test(
    runtimeErrorMessage(error),
  );
}

installConsoleRedaction();
const logger = createLogger(config);
let connection = null;

process.on("unhandledRejection", (reason) => {
  if (isWhatsAppTransportError(reason)) {
    connection?.setLastError?.(reason?.message || "whatsapp_transport_error");
    connection?.recoverTransportError?.(reason);
    logWarning("WhatsApp transport error ditahan agar proses tidak crash", reason);
    return;
  }
  logError("Unhandled WhatsApp promise rejection", reason);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50).unref();
});

process.on("uncaughtException", (error) => {
  if (isWhatsAppTransportError(error)) {
    connection?.setLastError?.(error?.message || "whatsapp_transport_error");
    connection?.recoverTransportError?.(error);
    logWarning("WhatsApp transport error ditahan agar proses tidak crash", error);
    return;
  }
  logError("Uncaught WhatsApp exception", error);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50).unref();
});

await ensureRuntimeDirs(config);
logStartup("Runtime WhatsApp disiapkan ...");

const store = new JsonStore(config.database.dir);
logStartup("Membuka database WhatsApp ...");
await store.ensure();
const groups = await store.read("groups", {});
logSuccess(`Group database loaded (${Object.keys(groups || {}).length} groups)`);
logRuntimeBanner({ version: "Kavya Auto Order" });

logStartup("Load All Plugins ...");
const plugins = await loadPlugins({
  pluginsDir: config.paths.pluginsDir,
  logger,
});
logHandler("Load All Plugins done...");

logStartup("Menyiapkan koneksi WhatsApp ...");
connection = createWhatsAppConnection({
  config,
  logger,
  store,
  plugins,
});

logStartup("Menyiapkan HTTP server WhatsApp ...");
const server = createHttpServer({
  config,
  logger,
  connection,
});

server.listen(config.port, () => {
  logStartup("Start App WhatsApp Bailey ...");
  logSuccess(`WhatsApp bot listening on port ${config.port}`);
});

logStartup("Menghubungkan WhatsApp Bailey ...");
connection.connect().catch((error) => {
  connection.setLastError(error.message || "startup_failed");
  logError("WhatsApp bot startup failed", error);
});
