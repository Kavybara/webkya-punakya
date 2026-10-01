import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Two things that used to be wrong in the group sync, both of which produced a
 * dashboard that looked broken while working exactly as written.
 *
 * These are source assertions rather than calls, and not by preference:
 * `syncWhatsappGroups` is a private function inside `server/index.js`, which
 * boots an Express app on import. Every other server test in this directory
 * tests an extracted `services/` module or asserts on source, and this belongs
 * to the second kind.
 */

const root = new URL("../../", import.meta.url);
const [server, connection] = await Promise.all([
  readFile(new URL("server/index.js", root), "utf8"),
  readFile(new URL("../bot/handle/connection.js", root), "utf8"),
]);

test("a sync does not overwrite the owner's recorded seat capacity", () => {
  /*
   * `capacity` is how many seats the owner sold; `members` is how many people
   * WhatsApp says are in the group. They are unrelated numbers, and both used to
   * be written from the group headcount:
   *
   *     members:  group.members || rental.members || 0,
   *     capacity: group.members || rental.capacity || 0,
   *
   * So a rental with 50 seats sold and 3 people in the chat read as 3 seats
   * used and 3 seats available, and the owner's own figure was erased on every
   * sync. A group full of customers looked like it had no customers.
   */
  const block = server.slice(
    server.indexOf("async function mergedWhatsappRentals"),
    server.indexOf("async function syncWhatsappGroups"),
  );

  assert.match(block, /members: Number\(row\.members \|\| synced\.members \|\| 0\)/);
  assert.doesNotMatch(
    block,
    /capacity:[^,\n]*synced\.members/,
    "mergedWhatsappRentals is still deriving capacity from the synced headcount",
  );
  assert.match(block, /capacity: Number\(row\.capacity \|\| 0\)/);

  const syncBlock = server.slice(
    server.indexOf("function syncWhatsappGroups"),
    server.indexOf("function normalizeRentalPatch"),
  );
  assert.doesNotMatch(
    syncBlock,
    /capacity: group\.members/,
    "syncWhatsappGroups is still overwriting capacity with the member count",
  );
  assert.match(syncBlock, /capacity: Number\(rental\.capacity \|\| 0\)/);
});

test("a member count is still recorded, because that is what a sync knows", () => {
  // The fix must not have been to stop writing the headcount -- it is the one
  // field the dashboard has no other way to obtain.
  const syncBlock = server.slice(
    server.indexOf("function syncWhatsappGroups"),
    server.indexOf("function normalizeRentalPatch"),
  );
  assert.match(syncBlock, /members: group\.members \|\| rental\.members \|\| 0/);
});

test("two concurrent group syncs cannot both run", () => {
  /*
   * Both guards inside the sync are skipped for any reason beginning with
   * "manual" -- deliberately, so the owner can force a refresh -- and
   * "manual-owner-sync" is the only manual caller. So two owner clicks both
   * passed the throttle, both passed the heavy-work pause, both fetched the
   * group list, and both POSTed it. The dashboard serialises its writes, so the
   * losing result was not an error; it was silently discarded.
   *
   * The mutex is what makes the second caller visible instead.
   */
  assert.match(connection, /let groupSyncInFlight = false/);
  assert.match(connection, /reason: "group_sync_in_flight"/);
  assert.match(
    connection,
    /if \(groupSyncInFlight\)[\s\S]{0,200}?groupSyncInFlight = true;[\s\S]{0,200}?try \{[\s\S]{0,120}?finally \{[\s\S]{0,120}?groupSyncInFlight = false;/,
    "the in-flight flag is set and cleared without a try/finally, so a throw would wedge sync forever",
  );
});

test("a failed sync reports why, rather than looking like an idle one", () => {
  /*
   * `syncJoinedGroups` returns `{success: false, reason: ...}` instead of
   * throwing, so a caller's `.catch()` never fires. The reason survives only in
   * the `group_sync` block of the status payload -- `last_synced_at`,
   * `last_error`, `group_count`.
   *
   * The status payload therefore has to keep carrying all three: it is the only
   * place a silent failure is recorded, and it is what makes the difference
   * between "the sync has been broken for a week" and "no sync has been needed"
   * visible to anything at all.
   *
   * Whether the owner page renders them is the UI half of this, tracked
   * separately -- this assertion is only that the data still leaves the bot.
   */
  assert.match(
    connection,
    /group_sync: \{[\s\S]{0,400}?last_synced_at: lastGroupSyncAt[\s\S]{0,120}?last_error: lastGroupSyncError[\s\S]{0,120}?group_count: lastGroupSyncCount/,
    "the group_sync status block lost a field the owner needs to diagnose a silent failure",
  );
});