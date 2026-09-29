/**
 * Login brute-force protection.
 *
 * The limiter counts against three independent keys so that no single forged
 * or rotated client identity can buy an attacker unlimited attempts:
 *
 *   - `account`  the email alone. A distributed attack that rotates addresses
 *                on every request still runs out of attempts.
 *   - `pair`     the email plus the client address. Catches one host grinding
 *                on one account.
 *   - `client`   the client address alone. Catches one host spraying many
 *                accounts, which the account key cannot see.
 *
 * The account budget is deliberately looser than the pair budget so that one
 * user fat-fingering their password is not locked out by other people guessing
 * the same account from elsewhere.
 */

import { clientKey } from "./client-ip.js";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const BUDGET_NAMES = ["account", "pair", "client"];

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function normalizeLoginIdentifier(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function createLoginAttemptLimiter({
  now = Date.now,
  env = process.env,
  clientKeyOf = clientKey,
} = {}) {
  const attempts = new Map();
  const windowMs = readNumber(env.LOGIN_WINDOW_MS, DEFAULT_WINDOW_MS);
  const pairBudget = readNumber(env.LOGIN_MAX_ATTEMPTS, 5);
  const budgets = {
    account: readNumber(env.LOGIN_ACCOUNT_MAX_ATTEMPTS, pairBudget * 2),
    pair: pairBudget,
    client: readNumber(env.LOGIN_CLIENT_MAX_ATTEMPTS, pairBudget * 4),
  };

  function keysFor(request, email) {
    const identifier = normalizeLoginIdentifier(email);
    const client = String(clientKeyOf(request) || "unknown");
    return {
      account: `account::${identifier}`,
      pair: `pair::${client}::${identifier}`,
      client: `client::${client}`,
    };
  }

  function activeAttempt(key) {
    const current = attempts.get(key);
    const timestamp = now();
    if (!current || current.resetAt <= timestamp) {
      if (current) attempts.delete(key);
      return null;
    }
    return current;
  }

  function blockingRequest(keys) {
    let retryAfterSeconds = 0;
    for (const name of BUDGET_NAMES) {
      const current = activeAttempt(keys[name]);
      if (!current || current.count < budgets[name]) continue;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((current.resetAt - now()) / 1_000));
    }
    return retryAfterSeconds ? { allowed: false, retryAfterSeconds } : { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    check(request, email) {
      return blockingRequest(keysFor(request, email));
    },

    recordFailure(request, email) {
      const timestamp = now();
      for (const key of Object.values(keysFor(request, email))) {
        const current = activeAttempt(key);
        attempts.set(key, current
          ? { ...current, count: current.count + 1 }
          : { count: 1, resetAt: timestamp + windowMs });
      }
    },

    clear(request, email) {
      for (const key of Object.values(keysFor(request, email))) attempts.delete(key);
    },

    limits: { ...budgets, windowMs },
  };
}
