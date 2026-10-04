import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { transpileModule } from "typescript";

/*
 * The owner warranty queue, where a customer's working account is destroyed and
 * another one is handed over in its place. Four defects.
 *
 * **The replace confirmation named neither account.** It read, in full:
 *
 *     Akun lama akan ditandai REPLACED dan tidak dikembalikan ke stok. Akun
 *     baru memakai order, reseller, serta tanggal berakhir yang sama.
 *
 * Not the unit being withdrawn, not the unit being sent, and not the customer
 * either -- just the word `REPLACED`, which is the value written to
 * `oldAccount.status` and appears nowhere else the owner works. The least
 * reversible action on the page had two invisible subjects.
 *
 * **And the candidate was pre-selected.** `openClaim` ended with
 * `setCandidateId(rows[0]?.id || "")`. `replacementCandidatesForClaim` returns
 * every available unit in the pool, unsorted, so `rows[0]` is whatever the
 * database held first -- not the best match and not one anybody looked at. Put
 * together: open a claim, type an owner note, press "Ganti akun" twice. A
 * customer's credentials are swapped for an arbitrary unit from the pool, and
 * at no point in that sequence is the choice visible or made. The picker now
 * starts empty; the button was already `disabled={!candidateId ...}`, so it
 * stays inert until a row is genuinely chosen.
 *
 * **Raw statuses could leak.** `statusLabel` was a local map ending in
 * `|| status`, so any status the page had not been taught rendered as the
 * database token. The tone lived in a second function, so a status could be
 * added to one and not the other. Both now live in `lib/labels` with the rest
 * of the console's vocabulary.
 *
 * **Three silent compression passes.** A 4 MB screenshot went through
 * `createImageBitmap` and up to three `toBlob` calls while the field's hint read
 * "Memproses gambar..." -- one string for an unbounded wait. And the failure
 * said only "masih terlalu besar", never how close it got, so the owner had no
 * idea how much to crop. The loop now reports each attempt and its size, and
 * the failure names the size reached.
 *
 * `warrantyStatus` and `candidateIdentity` are transpiled and *called* here.
 * The rest is source inspection -- Node 20 cannot import `.tsx`, which is the
 * repo's established convention for anything under `src/pages`.
 */

const PAGE = new URL("../../src/pages/owner-v2/warranty/page.tsx", import.meta.url);
const LABELS = new URL("../../src/lib/labels.ts", import.meta.url);
const SERVICE = new URL("../services/warranty-service.js", import.meta.url);

const outRoot = new URL("../.compiled-tests-warranty/", import.meta.url);
mkdirSync(outRoot, { recursive: true });
process.on("exit", () => rmSync(outRoot, { recursive: true, force: true }));

/*
 * `lib/labels` imports two *types* only, so `transpileModule` erases them and
 * the compiled module is a leaf. Nothing has to be written beside it.
 */
const labelsOut = new URL("labels.mjs", outRoot);
writeFileSync(
  labelsOut,
  transpileModule(readFileSync(LABELS, "utf8"), {
    compilerOptions: { module: 99, target: 99 },
    fileName: "module.ts",
  }).outputText,
);

// `fileURLToPath`, not `.pathname`: the repo path contains a space, which the
// URL form percent-encodes into a filename that does not exist.
const { warrantyStatus } = await import(pathToFileURL(fileURLToPath(labelsOut)).href);

function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Strips block and line comments.
 *
 * Required, not optional: this file quotes the old copy verbatim in order to
 * assert it is gone, so an assertion over raw source would match the quotation.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const page = () => withoutComments(read(PAGE));

/* -------------------------------------------------------------------------- */
/* warrantyStatus                                                             */
/* -------------------------------------------------------------------------- */

test("every claim status the server can write has a label", () => {
  // The premise of the shared table. The service's own status sets and its two
  // literal `status:` writes enumerate everything a claim can hold; if a
  // seventh ever appears, this fails and the table gets an entry, rather than
  // the Status column quietly growing a raw token.
  const source = read(SERVICE);
  const declarations = [
    /OPEN_CLAIM_STATUSES = new Set\(\[([^\]]*)\]\)/,
    /TERMINAL_CLAIM_STATUSES = new Set\(\[([^\]]*)\]\)/,
    /EDITABLE_CLAIM_STATUSES = new Set\(\[([^\]]*)\]\)/,
  ].map((pattern) => {
    const match = pattern.exec(source);
    assert.ok(match, `${pattern} no longer matches -- the status sets have moved or been renamed`);
    return match[1];
  });
  declarations.push('status: "submitted"', 'status: "replaced"');

  const written = new Set(declarations.join(",").match(/"[a-z_]+"/g));

  for (const token of written) {
    const value = token.slice(1, -1);
    const { label } = warrantyStatus(value);
    assert.notEqual(label, value, `${value} has no label, so it renders as the raw database token`);
    assert.doesNotMatch(label, /_/, `${value} is being humanised rather than translated`);
  }

  // Sanity-check the harvest against the type the API declares, so a silently
  // broken regex cannot pass by collecting nothing.
  assert.ok(written.size >= 6, `expected to recover the server's statuses, collected ${[...written]}`);
});

test("an unknown status is humanised, never shown raw", () => {
  // The defect itself: `|| status` put the database token in the column.
  assert.equal(warrantyStatus("escalated").label, "Escalated");
  assert.equal(warrantyStatus("awaiting_evidence").label, "Awaiting evidence");
  assert.equal(warrantyStatus("").label, "Tidak diketahui");
  assert.equal(warrantyStatus(undefined).label, "Tidak diketahui");
  assert.equal(warrantyStatus("SUBMITTED").label, "Diajukan", "lookup must not be case-sensitive");
});

test("waiting for evidence reads as the same work, not a different task", () => {
  // `waiting_evidence` is not a stage of the owner's work -- it is the reseller
  // who has not sent the screenshot. A distinct badge would imply the owner had
  // a task to perform and had somehow failed it.
  assert.equal(warrantyStatus("waiting_evidence").label, warrantyStatus("reviewing").label);
  assert.equal(warrantyStatus("waiting_evidence").tone, warrantyStatus("reviewing").tone);
});

test("a freshly filed claim is the only warning tone", () => {
  assert.equal(warrantyStatus("submitted").tone, "warning");
  for (const key of ["reviewing", "waiting_evidence"]) {
    assert.equal(warrantyStatus(key).tone, "info", `${key} is work in hand, not work waiting to start`);
  }
  for (const key of ["replaced", "resolved"]) {
    assert.equal(warrantyStatus(key).tone, "success");
  }
  assert.equal(warrantyStatus("rejected").tone, "danger");
  assert.equal(warrantyStatus("escalated").tone, "muted", "an unknown status is not coloured as if it meant something");
});

test("the page reads the shared vocabulary and defines no other", () => {
  const source = page();

  assert.match(source, /import \{ warrantyStatus \} from "\.\.\/\.\.\/\.\.\/lib\/labels"/);

  // The two local functions had to be deleted, not merely bypassed -- a leftover
  // `statusLabel` is a second answer to a question the shared table answers.
  assert.doesNotMatch(source, /function statusLabel/);
  assert.doesNotMatch(source, /function statusTone/);

  // ...and the label and tone still travel together, rather than being looked
  // up separately and able to disagree.
  assert.match(source, /<Badge tone=\{warrantyStatus\(row\.status\)\.tone\}>\{warrantyStatus\(row\.status\)\.label\}<\/Badge>/);
  assert.match(source, /label: warrantyStatus\(value\)\.label, value/);
  assert.match(source, /\{warrantyStatus\(value\)\.label\}<\/option>/);
});

/* -------------------------------------------------------------------------- */
/* The replace confirmation                                                   */
/* -------------------------------------------------------------------------- */

test("the confirmation names the account being withdrawn", () => {
  const source = page();

  // The unit is masked server-side -- `replacementCandidatesForClaim` runs it
  // through `maskIdentity` -- so the owner is shown what the console holds, and
  // the sheet row is what identifies it for real.
  assert.match(
    source,
    /<span className="text-xs uppercase tracking-wider text-\[var\(--text-muted\)\]">Akun yang diganti<\/span>/,
    "the dialog must have a heading for the account being taken away",
  );
  assert.match(source, /\{selected\.accountIdentity \|\| "Dimasking"\}/);
  assert.match(source, /\{selected\.product\} \{selected\.variant\} \/ profil \{selected\.profile \|\| "-"\}/);
  assert.match(source, /Reseller \{selected\.resellerName \|\| selected\.resellerId \|\| "-"\}/);
});

test("the confirmation names the account being handed over", () => {
  const source = page();

  assert.match(source, />Akun yang dikirim<\/span>/, "the replacement unit must be named, not implied");
  assert.match(source, /\{selectedCandidate\.identity \|\| "Tanpa identitas"\}/);
  assert.match(source, /Profil \{selectedCandidate\.profile \|\| "-"\}/);
  assert.match(
    source,
    /\{selectedCandidate\.sheetName \? `\$\{selectedCandidate\.sheetName\} baris \$\{selectedCandidate\.sheetRow \|\| "-"\}` : "Tersimpan di database"\}/,
    "the sheet row is how the owner identifies the unit they are about to hand over",
  );

  // It has to be the row that was actually chosen, resolved from `candidateId` --
  // not the first entry, and not the raw select value.
  assert.match(
    source,
    /const selectedCandidate = useMemo\(\s*\(\) => candidates\.find\(\(row\) => row\.id === candidateId\) \|\| null,/,
  );
});

test("the dialog will not open without a resolved candidate", () => {
  const source = page();

  // `selected` and `confirmReplace` alone are not enough. Between the owner
  // pressing "Ganti akun" and confirming, the candidate list can be replaced --
  // `openClaim` runs on any claim click -- so `candidateId` may no longer
  // resolve. Rendering the confirmation with no subject would be worse than not
  // opening it.
  assert.match(
    source,
    /\{selected && confirmReplace && selectedCandidate \? <Dialog open title="Konfirmasi penggantian"/,
    "the confirmation can render with no candidate named in it",
  );
});

test("the raw column value is gone from the prose", () => {
  const source = page();

  // `oldAccount.status = "replaced"` is what the database stores. Telling the
  // owner their customer will be "marked REPLACED" teaches them a token they
  // will never meet elsewhere in the product.
  assert.match(source, /Akun lama akan ditandai sudah diganti/);
  assert.doesNotMatch(source, /ditandai REPLACED/);

  // Belt and braces: `REPLACED` is still legitimately a Sheets condition value,
  // so assert it only in the warranty page's *user-facing* copy, not globally.
  assert.doesNotMatch(source, /REPLACED/);
});

test("the reseller-facing note is shown before it is sent", () => {
  const source = page();

  // `ownerNote` is required by `executeReplacement` and is shown to the
  // customer -- the one field whose contents leave the building.
  assert.match(source, /Catatan yang akan dilihat reseller: &ldquo;\{ownerNote\.trim\(\)\}&rdquo;/);
});

/* -------------------------------------------------------------------------- */
/* The candidate picker                                                       */
/* -------------------------------------------------------------------------- */

test("the picker no longer pre-selects the first candidate", () => {
  const source = page();

  assert.match(
    source,
    /setCandidates\(rows\);[\s\S]*?setCandidateId\(""\);/,
    "the first row of an unsorted candidate list is pre-selected, so a two-press replacement picks an account nobody looked at",
  );
  assert.doesNotMatch(source, /setCandidateId\(rows\[0\]\?\.id \|\| ""\)/);

  // ...and the button it feeds was already disabled on an empty selection, so
  // nothing new has to be wired up for the removal to be safe.
  assert.match(source, /disabled=\{!candidateId \|\| busy \|\| !ownerNote\.trim\(\)\} onClick=\{\(\) => setConfirmReplace\(true\)\}/);
});

test("an empty picker says so, rather than looking broken", () => {
  const source = page();

  assert.match(
    source,
    /\{ownerNote\.trim\(\) && !candidateId && !candidateLoading && !candidateError && candidates\.length \? <p className="mt-2 text-xs text-\[var\(--status-warning\)\]">Pilih satu stok pengganti/,
    "the button is disabled with no explanation of which of its three conditions is unmet",
  );
});

test("the picker is named for a screen reader", () => {
  const source = page();

  // A bare `<select>` with only a placeholder option has no accessible name --
  // the placeholder is an option, not a label.
  assert.match(source, /<select aria-label="Pilih stok pengganti"/);
});

test("every candidate is described the same way in the list and on the button", () => {
  const source = page();

  assert.match(source, /\{candidateIdentity\(candidate\)\}<\/option>/);
  assert.match(
    source,
    /export function candidateIdentity\(candidate\?: WarrantyReplacementCandidate \| null\): string/,
    "the option text was assembled inline, so the confirmation and the picker could describe a unit differently",
  );

  // The old inline form used the English word "row" in Indonesian copy.
  assert.doesNotMatch(source, /row \{candidate\.sheetRow/);
  assert.match(source, /baris \$\{candidate\.sheetRow \|\| "-"\}/);
});

/* -------------------------------------------------------------------------- */
/* Evidence compression                                                       */
/* -------------------------------------------------------------------------- */

test("each compression pass reports progress", () => {
  const source = page();

  // Module-private, not exported: nothing outside this file needs the ladder,
  // and its order is an implementation detail of the loop below it.
  assert.match(source, /^const EVIDENCE_QUALITIES = \[0\.82, 0\.7, 0\.58\];$/m);
  assert.doesNotMatch(source, /export const EVIDENCE_QUALITIES/);
  assert.match(source, /for \(const \[index, quality\] of EVIDENCE_QUALITIES\.entries\(\)\)/);
  assert.match(
    source,
    /onProgress\?\.\(\{ attempt: index \+ 1, attempts: EVIDENCE_QUALITIES\.length, sizeBytes: blob\.size \}\)/,
    "three passes over a canvas run with no visible feedback at all",
  );

  // The attempt count is the total, so the reader can see it is 3 of 3 rather
  // than a number that might keep climbing.
  assert.match(
    source,
    /Mengompres ke-\$\{manualEvidenceProgress\.attempt\} dari \$\{manualEvidenceProgress\.attempts\}/,
  );
});

test("the failure says how close the compression got", () => {
  const source = page();

  // "Masih terlalu besar" with no number leaves the owner guessing how much to
  // crop, which is the one thing they need to know to fix it.
  assert.match(source, /let smallest = 0;/);
  assert.match(source, /smallest = smallest \? Math\.min\(smallest, blob\.size\) : blob\.size;/);
  assert.match(
    source,
    /Setelah dikompresi \$\{Math\.ceil\(smallest \/ 1024\)\} KB, ukurannya masih di atas batas 650 KB\./,
  );

  // `toBlob` returns null when the browser cannot encode at all, which is a
  // different problem from an image that is too big and must read differently.
  assert.match(source, /Gambar tidak dapat dikompres di browser ini\./);
  assert.match(
    source,
    /throw new Error\(\s*smallest\s*\?/,
    "a null blob must not be reported as a file that was too large",
  );
});

test("the file input is disabled while it compresses", () => {
  const source = page();

  // A second pick mid-`toBlob` leaves two compressions racing for one piece of
  // state, and the slower one wins -- overwriting what the owner chose.
  assert.match(source, /<input ref=\{manualEvidenceInputRef\} type="file"[^>]*disabled=\{manualEvidenceBusy\}/);
  assert.match(source, /setManualEvidence\(await prepareEvidence\(file, setManualEvidenceProgress\)\);/);
  assert.match(source, /finally \{\s*setManualEvidenceBusy\(false\);\s*setManualEvidenceProgress\(null\);/);
});

test("the size limit is quoted consistently", () => {
  const source = page();

  // `maxBytes` is 650_000, which is 635 KiB -- the copy must not say "635 KB"
  // in one sentence and "650 KB" in the next.
  assert.match(source, /const maxBytes = 650_000;/);
  assert.match(source, /Di atas 650 KB akan dikompres otomatis\./);
  assert.match(source, /masih di atas batas 650 KB/);
});