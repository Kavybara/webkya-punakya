import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/**
 * Do the docs still describe this repository?
 *
 * This project renames and moves things constantly -- the console was
 * `owner`/`reseller` and became `owner-v2`/`reseller-v2`, the store page moved
 * from the landing page to `/harga`, the route handlers were extracted out of
 * `index.js` into `server/routes/`. Every one of those moves was correct and
 * every one of them left a sentence in the docs pointing at a path that no
 * longer exists.
 *
 * Documentation drift is the quietest failure mode there is. A wrong path in a
 * doc costs nothing at build time and nothing at runtime; it just misleads the
 * next person -- or the next agent -- who trusts it and spends an hour looking
 * for a directory that was renamed three phases ago. That is exactly what
 * happened here: `docs/PROJECT_STRUCTURE.md` sent a reader to
 * `src/pages/public/`, `src/pages/owner/`, and `src/pages/reseller/`, none of
 * which exist, while saying the store lived at `/store` after `/store` had
 * already become a redirect to `/harga`.
 *
 * So the paths named in the docs are checked against the filesystem. This
 * cannot catch prose that is merely unhelpful, and it does not try to. It
 * catches the one failure that is both common here and objectively verifiable:
 * a documented path that is not there.
 */

const REPO = path.resolve("..", "..");

/** Every `.md` under the repo that is ours to maintain, minus generated output. */
const DOCS = [
  "README.md",
  "docs/PROJECT_STRUCTURE.md",
  "docs/DEPLOYMENT.md",
  "apps/dashboard/server/routes/README.md",
];

/**
 * Directories a doc may write a path relative to.
 *
 * A path in these docs is rarely written from the repo root. `server/routes`
 * in `docs/PROJECT_STRUCTURE.md` means `apps/dashboard/server/routes`, and
 * `src/pages/home` means the dashboard's `src`. Resolving only against the repo
 * root makes every such path look broken, which is how a check like this ends
 * up asserting nothing.
 */
const ROOTS = ["", "apps/dashboard/", "apps/dashboard/server/", "apps/bot/"];

const exists = (relative) =>
  access(path.join(REPO, relative)).then(
    () => true,
    () => false,
  );

/**
 * Paths that a doc mentions as a repo location.
 *
 * Matches a path-shaped token that begins at a directory we know exists, so
 * that ordinary prose and URLs (`https://vya.baby/store`) are not mistaken for
 * filesystem claims. Requires a `/` after the directory, which is what
 * distinguishes `apps/dashboard/src/pages/public/` (a claim) from `apps` alone
 * (not one).
 *
 * Two kinds of line are skipped. An assignment (`RUNTIME_BACKUP_DIR=runtime/
 * backups`) names a *runtime* directory whose location is configuration, not
 * something this repository either has or lacks -- those are legitimately
 * created on deploy. And a path with a file extension is a filename reference,
 * not a directory claim.
 */
function claimedPaths(markdown) {
  const found = new Set();
  for (const line of markdown.split("\n")) {
    if (/^\s*[A-Z][A-Z0-9_]*=/.test(line)) continue; // an env assignment
    for (const match of line.matchAll(/(?<![\w/.-])((?:apps|packages|plugins|scripts|docs|src|server)\/[\w./-]+)/g)) {
      const claimed = match[1].replace(/[.,;:)]+$/, "").replace(/\/$/, "");
      if (claimed.includes(".")) continue; // a filename, not a directory claim
      found.add(claimed);
    }
  }
  return [...found];
}

const KNOWN_ABSENT = new Set([
  // Deliberate: these are the pre-rename paths the docs now name in order to
  // say they no longer exist. Asserting that the warning is still there is the
  // point -- if a future refactor removes the note, the next reader is lost.
  "src/pages/public",
  "src/pages/owner",
  "src/pages/reseller",
  "src/pages/owner/components",
]);

test("every path the docs claim to exist does exist", async () => {
  const broken = [];

  for (const doc of DOCS) {
    const markdown = await readFile(path.join(REPO, doc), "utf8");
    for (const claimed of claimedPaths(markdown)) {
      if (KNOWN_ABSENT.has(claimed)) continue;
      // A path may be written relative to the repo root or to the app it
      // belongs to, so try each root a doc plausibly writes from.
      const found = await Promise.all(ROOTS.map((root) => exists(root + claimed)));
      if (found.some(Boolean)) continue;
      broken.push(`${doc} documents ${claimed}, which does not exist`);
    }
  }

  assert.deepEqual(
    broken.sort(),
    [],
    `the docs point at paths this repository does not have:\n  ${broken.sort().join("\n  ")}`,
  );
});

test("the docs do not send readers to the pre-rename page folders", async () => {
  // The specific instance, pinned directly.
  //
  // The general check above cannot fail on these: they are *absent*, which is
  // exactly what a stale doc claims about a moved directory. So the general rule
  // would happily pass a doc telling every reader to look in
  // `src/pages/reseller/`, which is what the doc said for three phases.
  //
  // The way out is to require that naming a dead path is always accompanied by
  // a correction. So each retired path must appear near the word that retires
  // it -- "sudah tidak ada", "no longer exists", "redirect" -- rather than as a
  // bare instruction to go there.
  const structure = await readFile(path.join(REPO, "docs/PROJECT_STRUCTURE.md"), "utf8");

  for (const retired of ["src/pages/owner/", "src/pages/reseller/", "src/pages/public/"]) {
    const index = structure.indexOf(retired);
    if (index === -1) continue; // not mentioned at all, which is also fine
    const surrounding = structure.slice(Math.max(0, index - 400), index + 400);
    assert.match(
      surrounding,
      /sudah tidak ada|tidak ada lagi|redirect|berpindah|pindah ke/i,
      `${retired} is named in PROJECT_STRUCTURE.md with nothing saying it is retired -- a reader would go there and find nothing`,
    );
  }
});

test("the composition root no longer claims to hold the API", async () => {
  // `server/index.js` is the one file whose role changed most: it used to be
  // described as "API dashboard, order, QRIS, Sheets, Gmail, sewa bot", and it
  // is now a composition root with zero route handlers in it. A reader sent
  // there to find the payment logic will find 395 unrelated private functions
  // and no routes, which is a genuinely confusing place to land.
  const structure = await readFile(path.join(REPO, "docs/PROJECT_STRUCTURE.md"), "utf8");
  assert.match(structure, /0 route handler|composition root/i, "PROJECT_STRUCTURE.md must state that index.js is a composition root, not the route layer");

  const index = await readFile(path.resolve("server/index.js"), "utf8");
  // The claim is only worth making if it is true. A route handler is a
  // `app.get("/...", ...)` / `app.post(...)` call. index.js should register
  // modules instead, via `registerXRoutes(...)`.
  const inlineRoutes = [...index.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*["'`]/g)];
  assert.deepEqual(
    inlineRoutes.map((m) => m[0]),
    [],
    "index.js has inline route handlers again, so the docs are wrong to call it a composition root",
  );
  assert.match(
    index,
    /register\w*Routes\(/,
    "index.js should mount route modules rather than define routes",
  );
});
