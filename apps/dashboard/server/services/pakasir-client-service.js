function delay(ms = 0) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryablePakasirError(error) {
  const name = String(error?.name || "");
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    name === "AbortError"
    || ["ETIMEDOUT", "ECONNRESET", "EPIPE", "ENOTFOUND", "EAI_AGAIN"].includes(code)
    || message.includes("timeout")
    || message.includes("network")
    || message.includes("fetch failed")
  );
}

export function shouldEnablePakasirMaintenance(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (!text) return false;
  if (text.includes("timeout")) return false;
  if (text.includes("network")) return false;
  if (text.includes("fetch failed")) return false;
  if (text.includes("econnreset") || text.includes("epipe") || text.includes("etimedout")) return false;
  return true;
}

export function pakasirTimeoutMs() {
  return Math.max(5_000, Number(process.env.PAKASIR_TIMEOUT_MS || 20_000));
}

export async function requestPakasirJsonWithRetry(url, options = {}) {
  const {
    fetcher = fetch,
    retries = Number(process.env.PAKASIR_RETRIES ?? 1),
    retryDelayMs = Number(process.env.PAKASIR_RETRY_DELAY_MS || 750),
    timeoutMs = pakasirTimeoutMs(),
    ...fetchOptions
  } = options;
  const maxRetries = Math.max(0, Number(retries || 0));
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      return {
        response,
        payload,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryablePakasirError(error) || attempt >= maxRetries) break;
      await delay(retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  const reason = lastError?.name === "AbortError" ? "timeout" : (lastError?.message || "failed");
  throw new Error(`Pakasir request ${reason} after ${maxRetries + 1} attempts`);
}
