# Dashboard route modules

`server/index.js` remains the composition root. It configures Express and injects
the existing services into each route module. Route modules must not import the
database store or business services directly; keeping dependencies explicit
makes endpoint contracts testable and avoids hidden global state.

Extracted domains:

- `system-routes.js`: health, maintenance, bootstrap, and server-sent events.
- `auth-routes.js`: login, session, logout, password reset, and password change.
- `settings-routes.js`: owner profile, integration settings, deposit instructions,
  and Gmail OAuth.
- `catalog-routes.js`: product reads, WA price sync, public catalog precheck, and
  reseller eligibility check.
- `product-admin-routes.js`: owner product lifecycle, locks, archive, and delete.
- `reseller-routes.js`: reseller CRUD, profile self-service, deposit QRIS/manual,
  and owner approval or rejection.
- `account-routes.js`: managed account ownership, credential updates,
  replacement, Sheets-aware archive, and reseller account-access lookup.
- `sheets-routes.js`: Sheets status, mapping preview, templates, read-only sync
  preview, and owner-triggered sync.
- `stock-routes.js`: credential-safe stock reads, owner mutations, stale
  reservation release, and daily assignment.
- `operations-routes.js`: activity feed, owner search, reseller repair,
  operations center, system status, and controlled restart.
- `whatsapp-routes.js`: bot status, rentals, group and price sync, inbound
  messages, and payment-message tracking.
- `payment-routes.js`: Pakasir webhook, authenticated payment status, and
  sanitized public payment tracking.
- `order-routes.js`: order reads, public tracking, checkout, owner smoke tests,
  manual approval, paid reconciliation, and delivery retry.

All HTTP route domains are now registered through modules. The remaining
`server/index.js` code is the composition root and shared business services;
those services should be extracted incrementally behind dedicated unit tests.

Every extraction must preserve HTTP method, path, authorization roles, response
shape, and handler order. Add the contract to `tests/route-modules.test.mjs`
before moving a route.
