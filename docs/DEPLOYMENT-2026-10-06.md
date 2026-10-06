# Live Deployment, 6 October 2026

User authorized deploying panel changes while preserving VPS data. GitHub was
not pushed at deployment time. No laptop database, environment file, or WhatsApp session was uploaded.

## Release

- Code-only release: 887 files.
- Archive SHA-256: `cd67b1c90acc11713df2ad9f19d2625ee64a654632b6840b8e10c832bdfa98e9`.
- Manifest verified on VPS; Linux build and bot check passed before replacement.
- Reused dependencies installed from identical root/dashboard/bot lockfiles in
  the previously verified isolated staging directory.
- Live database remains `/opt/kavya/kavya-digital-dashboard/runtime/kavya-db.json`.

## Preservation Evidence

Full-array SHA-256 comparisons passed before/after deployment and again after
enabling background jobs for `resellers`, `whatsappRentals`, and
`whatsappGroupLists`. This includes reseller balances and paused rental states.

- Resellers: 68.
- Group list records: 67.
- Rentals: 12, comprising 2 active and 10 paused.
- Orders: 536; stock: 417; managed accounts: 2,796. Record counts preserved.

The first attempt deliberately rolled back code when strict comparison of
orders/stock/accounts detected startup reconciliation. No database restore was
performed. Startup contains historical fulfillment/stock/account reconciliation;
background Sheets synchronization also legitimately updates these collections.
Their metadata is therefore not claimed byte-identical. The final attempt kept
strict full-record checks for lists/rentals/resellers and record-count checks for
the reconciled collections.

Encrypted backups are retained privately on VPS and laptop. Final stopped-service
snapshot SHA-256: `038490fba00200ba220f990aaa0e1db8d0a84902d567f7489b039c3d84dc017e`.
Backup envelope: `KVDEPLOY1`, AES-256-GCM, 12-byte IV, 16-byte tag, key derived
with SHA-256 from the existing VPS `BACKUP_ENCRYPTION_KEY`. It is a deployment
snapshot, not an interchangeable standard runtime-backup archive. The key is
required for recovery and must remain private.

## Live Checks

- PM2 `kavya` online; background jobs enabled.
- Public health returns HTTP 200 and `{ "ok": true }`.
- Production JavaScript/CSS assets return HTTP 200 with correct content types.
- Owner login and authenticated diagnostics return success.
- Owner WhatsApp status reports connected.
- Chromium desktop 1440x900 and mobile 390x844 render nonblank public pages
  without page errors; screenshots inspected.
- Legacy import and forced legacy import disabled persistently; canonical
  database/runtime paths pinned. Startup install/build and startup backup are
  disabled for this prebuilt release; scheduled backup configuration preserved.

This verifies deployment and core data preservation, not every integration.
The real paid order/fulfillment/warranty staging drill remains incomplete,
as documented in STAGING-VERIFICATION-2026-10-06.md. CI has not run because
GitHub push was withheld at the time these deployment checks ran.

## Subsequent Pre-Push Findings

The user subsequently authorized pushing the current branch. A fresh production
dependency audit reported zero vulnerabilities for root and bot, but a critical
`proxy-addr` advisory for dashboard: GHSA-jqcg-44mw-7w3h. This dependency has not
been changed as part of the push; CI's audit gate may fail until it is addressed.

Live checkout of iQiyi also remains unresolved: the connected spreadsheet has
no iQiyi tab, while its locally stored inventory has no Sheet-backed scope.
Checkout currently requires product-scoped Sheets synchronization and rejects
this configuration with `product_sheet_scope_unresolved`. No trial order,
payment, or stock mutation was performed while diagnosing this issue.
