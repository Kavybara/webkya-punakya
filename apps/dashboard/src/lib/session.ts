const SESSION_KEY = "kavya-session";

export function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function writeSession(session: unknown, remember = true) {
  const value = JSON.stringify(session);
  if (remember) {
    localStorage.setItem(SESSION_KEY, value);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, value);
    localStorage.removeItem(SESSION_KEY);
  }
  window.dispatchEvent(new Event("kavya-session:update"));
}

export function updateSession(patch: Record<string, unknown>) {
  const session = readSession();
  if (!session) return;
  const remember = Boolean(localStorage.getItem(SESSION_KEY));
  writeSession({ ...session, ...patch }, remember);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("kavya-session:update"));
}
