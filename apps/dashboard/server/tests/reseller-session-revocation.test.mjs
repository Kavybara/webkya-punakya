import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The owner's two ways to cut a reseller off did not actually cut anything off.
 *
 * `requireAuth` (index.js:857-884) validates a session against exactly one
 * thing:
 *
 *     function sessionVersionForAuth(db, auth) {
 *       if (auth.role === "owner") return Number(db.settings?.ownerSessionVersion || 0);
 *       const reseller = (db.resellers || []).find((item) => item.id === auth.sub);
 *       return Number(reseller.sessionVersion || 0);
 *     }
 *     ...
 *     if (expectedVersion === null || Number(auth.sv || 0) !== expectedVersion) {
 *       res.status(401)...
 *
 * It never reads `isActive`. So `sessionVersion` is not one revocation lever
 * among several -- it is the only one. A bump is the entire mechanism.
 *
 * The owner-driven update to a reseller did not bump it:
 *
 *   - `normalizeResellerInput` (index.js:5930-5964) returns no `sessionVersion`,
 *     so the handler's `{ ...current, ...input, id, passwordHash }` carried the
 *     old value straight through.
 *   - `PUT /api/resellers/:id` reads `requestedPassword` from the body when the
 *     caller is the owner (reseller-routes.js:121) and writes a fresh
 *     `passwordHash` with it -- so resetting the password of a reseller whose
 *     cookie was stolen changed nothing about that cookie.
 *
 * The self-service paths already do this correctly (`auth-routes.js:538, 544`,
 * `:594`, `:620` all increment the version), which is what makes the owner
 * path an inconsistency rather than a deliberate choice: the same intent,
 * applied from a different direction, does not revoke.
 *
 * The blast radius is set by the session lifetime -- 30 days when the session
 * was created with `remember: true` (index.js:784-792).
 *
 * Scoped deliberately. Revocation fires on an owner-set password and on
 * deactivation, and on nothing else: an owner fixing a typo in a reseller's
 * name must not end that reseller's working session. Revoking more than this
 * would be its own bug, so the tests below pin the negative case too.
 *
 * Source-inspected rather than booted, for the same reason as the rest of this
 * suite: starting the API writes the real database.
 */
const RESELLER_ROUTES = new URL("../routes/reseller-routes.js", import.meta.url);
const INDEX = new URL("../index.js", import.meta.url);

function readResellerRoutes() {
  return readFileSync(RESELLER_ROUTES, "utf8");
}

/** The body of `PUT /api/resellers/:id`, from its route line to the next route. */
function updateHandlerSource() {
  const source = readResellerRoutes();
  const start = source.indexOf('app.put("/api/resellers/:id"');
  assert.notEqual(start, -1, "PUT /api/resellers/:id is not registered");
  const next = source.indexOf("\n  app.", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("an owner-set password revokes the reseller's existing sessions", () => {
  const handler = updateHandlerSource();

  // The owner can set a password at all -- this is the revocation trigger.
  assert.match(handler, /req\.auth\.role === "owner"[\s\S]{0,120}req\.body\.password/);

  assert.match(
    handler,
    /revokedByOwnerPasswordReset[\s\S]{0,80}sessionVersion\s*=/,
    "an owner-driven password reset never bumps sessionVersion, so a stolen cookie survives the password change",
  );
});

test("deactivating a reseller revokes their existing sessions", () => {
  const handler = updateHandlerSource();

  // `wasActive` is what makes this fire on the transition rather than on every
  // write to a record that is already inactive.
  assert.match(handler, /const wasActive = current\.isActive !== false/);
  assert.match(
    handler,
    /wasActive\s*&&\s*reseller\.isActive === false[\s\S]{0,200}sessionVersion\s*=/,
    "setting isActive:false leaves the reseller's live cookie working until it expires",
  );
});

test("an ordinary owner edit does not log a working reseller out", () => {
  const handler = updateHandlerSource();

  // The negative case is the half that matters. A blanket "any update
  // revokes" would satisfy the two tests above and would be wrong: the owner
  // edits these records constantly for bookkeeping reasons that have nothing to
  // do with access.
  assert.match(
    handler,
    /if \(revokedByOwnerPasswordReset \|\| revokedByDeactivation\) \{/,
    "revocation must be conditioned on the two triggers, not applied to every update",
  );
  assert.match(handler, /const revokedByOwnerPasswordReset = req\.auth\.role === "owner"/);
});

test("requireAuth really does depend on sessionVersion alone", () => {
  // If a future change teaches requireAuth to read `isActive`, the two bumps
  // above become belt-and-braces rather than load-bearing -- which is fine, but
  // the tests should say so rather than keep asserting the weaker mechanism.
  const index = readFileSync(INDEX, "utf8");
  const start = index.indexOf("function requireAuth(");
  assert.notEqual(start, -1, "requireAuth is not defined in index.js");
  const body = index.slice(start, index.indexOf("\nfunction ", start + 1));

  assert.match(body, /auth\.sv|expectedVersion/);
  assert.doesNotMatch(
    body,
    /isActive/,
    "requireAuth now reads isActive directly, so the sessionVersion bumps are no longer the only revocation path -- re-check whether they are still needed",
  );
});