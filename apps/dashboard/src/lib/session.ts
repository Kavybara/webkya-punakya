const SESSION_KEY = "kavya-session";

export type AppSession = {
  ok?: boolean;
  role?: "owner" | "reseller";
  user?: Record<string, any>;
  token?: string;
};

function publicSession(session: unknown): AppSession | null {
  if (!session || typeof session !== "object") return null;
  const { token: _legacyToken, ...safe } = session as Record<string, unknown>;
  return safe as AppSession;
}

export function readSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null";
    const parsed = JSON.parse(raw);
    const safe = publicSession(parsed);
    if (parsed?.token) {
      const storage = localStorage.getItem(SESSION_KEY) ? localStorage : sessionStorage;
      storage.setItem(SESSION_KEY, JSON.stringify(safe));
    }
    return safe;
  } catch {
    return null;
  }
}

export function writeSession(session: unknown, remember = true) {
  const value = JSON.stringify(publicSession(session));
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
