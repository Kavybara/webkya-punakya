import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The password-reset request endpoint could never be blocked.
 *
 * `createLoginAttemptLimiter` (login-attempt-limiter.js) keeps its budgets in an
 * in-memory `attempts` Map, and `check()` only *reads* that map:
 *
 *     function blockingRequest(keys) {
 *       for (const name of BUDGET_NAMES) {
 *         const current = activeAttempt(keys[name]);
 *         if (!current || current.count < budgets[name]) continue;
 *
 * `recordFailure()` is the only writer. It bumps all three keys -- account, pair
 * and client -- and nothing else touches the counter.
 *
 * `/api/auth/password-reset/request` called `assertLoginAllowed(req, identifier)`
 * and never `recordLoginFailure`. So the check ran against a counter that stayed
 * at zero forever: `allowed` was always true. The endpoint had a limiter
 * installed and no limiter behaviour, which is worse than none, because the code
 * reads as though the path is protected.
 *
 * The request path is expensive in two directions at once, which is what makes
 * this worth bounding:
 *
 *   - Every accepted call sends a real WhatsApp OTP to the account's own phone
 *     (`sendResetCodeWhatsApp`, auth-routes.js:440). Unbounded requests are an
 *     unauthenticated message bomb aimed at a real customer, paid for out of the
 *     operator's WhatsApp quota.
 *   - Every accepted call unshifts a *fresh* reset record with `attempts: 0`
 *     (auth-routes.js:418-427). The per-record cap in `/verify`
 *     (`reset.attempts >= 5`) is therefore worth only 5 guesses per request, so
 *     it does not bound anything at the endpoint. Recovering one account is
 *     900,000 codes / 5 = 180,000 requests.
 *
 * The self-registration endpoint two hundred lines above already gets this right
 * -- `assertLoginAllowed` followed immediately by `recordLoginFailure`
 * (auth-routes.js:165-166) -- which is what makes the omission here an
 * inconsistency rather than a deliberate choice.
 *
 * These assertions read the source rather than booting the API. Booting is not
 * safe in a test here: the server writes the real database on start.
 */
const AUTH_ROUTES = new URL("../routes/auth-routes.js", import.meta.url);

function readAuthRoutes() {
  return readFileSync(AUTH_ROUTES, "utf8");
}

/** The source slice of one `app.post` handler, from its path to the next route. */
function handlerSource(path) {
  const source = readAuthRoutes();
  const start = source.indexOf(`app.post("${path}"`);
  assert.notEqual(start, -1, `${path} is not registered in auth-routes.js`);
  const next = source.indexOf("\n  app.", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("password-reset request records a failure so the limiter can ever block", () => {
  const handler = handlerSource("/api/auth/password-reset/request");

  assert.match(
    handler,
    /assertLoginAllowed/,
    "the request endpoint must ask the limiter before doing any work",
  );
  assert.match(
    handler,
    /recordLoginFailure/,
    "the request endpoint checks the limiter but never increments it, so check() always answers allowed:true",
  );
});

test("the failure is recorded before the OTP is sent, not only on the way out", () => {
  const handler = handlerSource("/api/auth/password-reset/request");
  const check = handler.indexOf("assertLoginAllowed");
  const record = handler.indexOf("recordLoginFailure");
  const send = handler.indexOf("sendResetCodeWhatsApp");

  assert.notEqual(check, -1);
  assert.notEqual(record, -1);
  assert.equal(
    check < record,
    true,
    "recording after the check but the send happening first would still let every request through",
  );
  if (send !== -1) {
    assert.equal(
      record < send,
      true,
      "the attempt is recorded after the WhatsApp OTP goes out, so the bomb lands before the budget moves",
    );
  }
});

test("every endpoint that spends an OTP charges the limiter for the spend", () => {
  // The general form of the bug, stated as a property rather than a single
  // endpoint: a handler that both sends a WhatsApp OTP and calls
  // `assertLoginAllowed` without a matching `recordLoginFailure` has a gate
  // that cannot close.
  //
  // The pairing is what makes this safe to assert. Charging is wrong for an
  // endpoint that spends nothing -- `/api/auth/logout` is limiter-gated and
  // costs the caller one call, so charging it would log out a user who simply
  // used the app. The rule is therefore about *spend*, not about being gated,
  // which is why this walks the handlers that send a code instead of the
  // handlers that call the limiter.
  const source = readAuthRoutes();
  const paths = [...source.matchAll(/\n  app\.(?:post|put|patch)\("([^"]+)"/g)].map((match) => match[1]);

  // Only the endpoints that spend an OTP *before* anyone has proved who they
  // are. `/api/auth/register/verify` also sends a WhatsApp message, but only
  // after the caller has cleared the per-registration 6-digit code and the
  // five-attempt cap -- that spend is already bounded by something stronger
  // than a per-IP budget, and charging it would only punish an applicant who
  // mistypes once.
  const unauthenticatedOtpSpenders = [
    "/api/auth/register/request",
    "/api/auth/password-reset/request",
  ];
  for (const path of unauthenticatedOtpSpenders) {
    assert.ok(paths.includes(path), `${path} is expected to exist in auth-routes.js`);
    const handler = handlerSource(path);
    assert.match(handler, /assertLoginAllowed\(/, `${path} sends an OTP but is not limiter-gated at all`);
    assert.match(
      handler,
      /recordLoginFailure\(/,
      `${path} sends a WhatsApp OTP to an unauthenticated caller but never charges the limiter, so its budget never moves`,
    );
  }

  // And the charge has to clear the successful login, or a legitimate user who
  // mistypes once then signs in correctly is still carrying the attempt.
  assert.match(
    handlerSource("/api/auth/login"),
    /clearLoginFailures\(/,
    "a successful login must clear its own accumulated attempts",
  );
});