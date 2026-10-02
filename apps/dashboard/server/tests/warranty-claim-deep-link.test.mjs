import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../../src/pages/owner-v2/warranty/page.tsx", import.meta.url);
const serviceUrl = new URL("../services/warranty-service.js", import.meta.url);

/*
 * The link the system emails itself did not work.
 *
 * When a reseller files a claim, the notification the owner gets carries a
 * direct link to that specific claim:
 *
 *     Aksi Owner : Buka Warranty Center ${ownerUrl}?claim=${claim.id}
 *
 * That link is sent by `warranty-service.js` -- twice, for the claim-created
 * and the claim-updated messages. The Warranty Center page never read `claim`.
 * It had no `useSearchParams` at all, so clicking the link the system had
 * written for the owner dropped them on the front of the claim queue with
 * nothing selected: the exact claim that had just arrived, buried somewhere in
 * a table, behind a click they had already been told to make.
 *
 * The worst part is that this is the moment the whole warranty flow depends on.
 * The owner is told there is a problem with a specific customer's account, the
 * message names the claim, and following it does nothing at all -- with no
 * error, no empty state, no sign the page had ignored the parameter.
 *
 * So this is not "add a nicety". The notification is the product working or not
 * working, and the link was the one instruction it gave.
 */
test("the notification tells the owner to open a claim by id, so the page has to read it", async () => {
  const service = await readFile(serviceUrl, "utf8");
  const links = service.match(/\?claim=\$\{encodeURIComponent\(claim\.id/g) || [];
  assert.ok(
    links.length >= 2,
    "the notifications no longer build a ?claim= link; if that changed deliberately, the deep-link work below is moot",
  );
});

test("the warranty page reads ?claim= from the URL", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(
    page,
    /useSearchParams/,
    "the warranty page does not read search params, so ?claim= is inert",
  );
  assert.match(
    page,
    /searchParams\.get\(\s*["']claim["']\s*\)|params\.get\(\s*["']claim["']\s*\)/,
    "the warranty page reads search params but never asks for `claim`",
  );
});

test("the link opens that claim, and only once the list has actually loaded", async () => {
  const page = await readFile(pageUrl, "utf8");

  // Sliced to the effect that reads the param, so this cannot pass on the
  // `openClaim(` calls that already existed for the table's row buttons.
  const start = page.indexOf("searchParams.get(\"claim\")");
  assert.ok(start > 0, "the claim id is never read from the URL");
  const effect = page.slice(start, start + 1400);

  // Not a bare "find and open" that fires on first render. The claim list
  // arrives from the network, so that finds an empty array and opens nothing --
  // which is the bug in a new dress. It has to wait for the list.
  assert.match(
    effect,
    /if \(loading\) return;/,
    "the deep link does not wait for the claim list before looking the id up",
  );
  assert.match(
    effect,
    /openClaim\(/,
    "the deep link never opens the claim it points at",
  );

  // And it must name the claim it could not find. A link to a claim that has
  // since been deleted, or an id from a different environment, has to say so --
  // silently doing nothing is what made the original link untrustworthy.
  assert.match(
    effect,
    /tidak ditemukan|tidak ada klaim/i,
    "a ?claim= pointing at nothing says nothing, which is the original failure",
  );
});

test("opening the deep-linked claim does not leave the parameter armed for a second claim", async () => {
  const page = await readFile(pageUrl, "utf8");

  // Once the claim is open, the id has done its job. Left in the URL, any later
  // change to `claims` -- a refresh, a status save that re-fetches the list --
  // re-opens the same dialog and pulls the owner back to a claim they already
  // closed.
  assert.match(
    page,
    /setParams|setSearchParams|navigate\(/,
    "the ?claim= parameter is never cleared, so it re-fires on every list change",
  );
});