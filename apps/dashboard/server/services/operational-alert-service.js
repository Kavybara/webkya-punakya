const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const MAX_DETAIL_LENGTH = 180;

function validTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sanitizeOperationalAlertDetail(value = "") {
  return String(value || "")
    .replace(/authorization\s*:\s*bearer\s+\S+/gi, "Authorization: [redacted]")
    .replace(/\b(password|passwd|secret|token|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_DETAIL_LENGTH);
}

export function recordOperationalCheck(settings = {}, options = {}) {
  const key = String(options.key || "").trim().toLowerCase();
  if (!key) throw new Error("Operational alert key wajib tersedia");

  const label = String(options.label || key).trim() || key;
  const now = new Date(options.now || Date.now());
  const nowText = Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString();
  const nowMs = new Date(nowText).getTime();
  const failureThreshold = Math.max(1, Number(options.failureThreshold || DEFAULT_FAILURE_THRESHOLD));
  const cooldownMs = Math.max(60_000, Number(options.cooldownMs || DEFAULT_COOLDOWN_MS));
  const detail = sanitizeOperationalAlertDetail(options.detail || "");

  settings.operationalAlertState = settings.operationalAlertState || {};
  const state = settings.operationalAlertState[key] || {
    key,
    label,
    active: false,
    consecutiveFailures: 0,
    firstFailedAt: "",
    lastFailedAt: "",
    lastSuccessAt: "",
    lastAlertAt: "",
    lastDetail: "",
  };
  state.label = label;

  if (options.ok === true) {
    const wasActive = state.active === true;
    state.active = false;
    state.consecutiveFailures = 0;
    state.firstFailedAt = "";
    state.lastSuccessAt = nowText;
    state.lastDetail = "";
    settings.operationalAlertState[key] = state;
    return {
      event: wasActive ? "recovery" : "none",
      shouldNotify: wasActive,
      key,
      label,
      title: `${label} kembali normal`,
      message: `KAVYA PULIH\n${label} kembali normal.`,
      state,
    };
  }

  state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
  state.firstFailedAt = state.firstFailedAt || nowText;
  state.lastFailedAt = nowText;
  state.lastDetail = detail;

  let event = "none";
  if (state.consecutiveFailures >= failureThreshold) {
    if (!state.active) {
      state.active = true;
      state.lastAlertAt = nowText;
      event = "alert";
    } else if (!validTime(state.lastAlertAt) || nowMs - validTime(state.lastAlertAt) >= cooldownMs) {
      state.lastAlertAt = nowText;
      event = "reminder";
    }
  }

  settings.operationalAlertState[key] = state;
  const detailLine = detail ? `\nDetail: ${detail}` : "";
  return {
    event,
    shouldNotify: event === "alert" || event === "reminder",
    key,
    label,
    title: event === "reminder" ? `${label} masih bermasalah` : `${label} perlu diperiksa`,
    message: `KAVYA ALERT\n${label} gagal ${state.consecutiveFailures} kali berturut-turut.${detailLine}`,
    state,
  };
}
