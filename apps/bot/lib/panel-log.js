import os from "node:os";

const CHECK = "[√]";
const CROSS = "[×]";
const WARN = "⚠️";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function useColor() {
  return !process.env.NO_COLOR;
}

function color(value, ansi) {
  return useColor() ? `${ansi}${value}${RESET}` : value;
}

function normalizeSourcePath(source = "") {
  const cleaned = String(source || "")
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/")
    .replace(/^\/([A-Za-z]:\/)/, "$1");
  const marker = "/apps/bot/";
  const index = cleaned.lastIndexOf(marker);
  if (index >= 0) {
    return `apps/bot/${cleaned.slice(index + marker.length)}`;
  }
  const fallback = cleaned.split("/").slice(-3).join("/");
  return fallback || "";
}

function callerSource() {
  const stack = new Error().stack || "";
  for (const line of stack.split("\n").slice(2)) {
    if (line.includes("panel-log.js") || line.includes("node:internal")) {
      continue;
    }
    const match =
      line.match(/\((file:\/\/[^:)]+|[A-Za-z]:\\[^:)]+|\/[^:)]+):\d+:\d+\)/) ||
      line.match(/\s(file:\/\/[^:)]+|[A-Za-z]:\\[^:)]+|\/[^:)]+):\d+:\d+/);
    if (match?.[1]) {
      return normalizeSourcePath(match[1]);
    }
  }
  return "";
}

function panelTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

function compact(value = "", maxLength = 160) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function errorMessage(error) {
  return compact(error?.message || error?.reason || error || "", 180);
}

function withSource(message) {
  const source = callerSource();
  return source ? `${source}: ${message}` : message;
}

function maybeDots(message) {
  const text = compact(message, 220);
  if (!text) return "";
  if (/[.!?…]$/.test(text) || text.endsWith("...")) return text;
  return text;
}

function terminalWidth() {
  return Math.max(72, Math.min(process.stdout.columns || 140, 180));
}

function horizontalLine(char = "=") {
  return char.repeat(terminalWidth());
}

function padLabel(label, width = 18) {
  return String(label).padEnd(width, " ");
}

function formatMemory(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function runtimeMode() {
  return process.env.NODE_ENV || process.env.APP_ENV || "production";
}

function publicIpLabel() {
  return process.env.PUBLIC_IP || process.env.SERVER_IP || "-";
}

export function logRuntimeBanner({ version = "Kavya Auto Order", apiKeyStatus = "NONAKTIF" } = {}) {
  const title = [
    " _  __    _    __     ____   __    ",
    "| |/ /   / \\   \\ \\   / /\\ \\ / /    ",
    "| ' /   / _ \\   \\ \\ / /  \\ V /     ",
    "| . \\  / ___ \\   \\ V /    | |      ",
    "|_|\\_\\/_/   \\_\\   \\_/     |_|      ",
  ].join("\n");

  const specRows = [
    ["◧ Hostname", os.hostname()],
    ["◧ Platform", os.platform()],
    ["◧ Architecture", os.arch()],
    ["◧ Total Memory", formatMemory(os.totalmem())],
    ["◧ Free Memory", formatMemory(os.freemem())],
    ["◧ Uptime", `${(os.uptime() / 3600).toFixed(2)} hours`],
    ["◧ Public IP", publicIpLabel()],
    ["◧ Mode", runtimeMode()],
  ];

  console.log("");
  console.log(color(horizontalLine(), CYAN));
  console.log(color(title, CYAN));
  console.log(color(horizontalLine(), CYAN));
  console.log("");
  console.log(color("◧ Info Script :", `${YELLOW}${BOLD}`));
  console.log(`${color("Version Sc:", GREEN)} ${version}`);
  console.log(`${color("API Key :", GREEN)} ${color(apiKeyStatus, YELLOW)}`);
  console.log(color("------------------", YELLOW));
  console.log(color("◧ Server Specifications :", `${YELLOW}${BOLD}`));
  for (const [label, value] of specRows) {
    console.log(`${color(padLabel(label), GREEN)}: ${value}`);
  }
  console.log("");
  console.log(color(horizontalLine(), CYAN));
  console.log(color(" ◧ Thank you for using Kavya! ◧ ", CYAN));
  console.log(color(horizontalLine(), CYAN));
  console.log("");
}

export function logCommand(name, text) {
  const who = compact(name || "Unknown", 80);
  const preview = compact(text, 160);
  if (!preview) return;
  console.log(`[${panelTime()}] ${who} : ${preview}`);
}

export function logStartup(message) {
  console.log(`${color(CHECK, GREEN)} ${maybeDots(message)}`);
}

export function logHandler(message) {
  console.log(`${color(CHECK, GREEN)} ${maybeDots(message)}`);
}

export function logSuccess(message) {
  console.log(`${color(CHECK, GREEN)} ${maybeDots(message)}`);
}

export function logWarning(message, error = "") {
  const detail = errorMessage(error);
  console.warn(`${color(WARN, YELLOW)} ${compact(withSource(message), 220)}${detail ? `: ${detail}` : ""}`);
}

export function logError(message, error = "") {
  const detail = errorMessage(error);
  console.error(`${color(CROSS, RED)} ${compact(withSource(message), 220)}${detail ? `: ${detail}` : ""}`);
}

export const logDanger = logError;

export function logReconnect({ attempt = 1, max = 1, reason = "", delayMs = 0 } = {}) {
  console.log(color(`Reconnect ${attempt}/${max} | Reason: ${compact(reason, 120)}`, YELLOW));
  if (delayMs) {
    console.log(color(`Reconnect in ${Math.ceil(delayMs / 1000)}s`, YELLOW));
  }
}

export function logTracking(message) {
  const text = compact(message, 220);
  if (/^(PHONE NUMBER|CODE PAIRING):/i.test(text)) {
    console.log(text);
    return;
  }
  console.log(`[${panelTime()}] System : ${text}`);
}
