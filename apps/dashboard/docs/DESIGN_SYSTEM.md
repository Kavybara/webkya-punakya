# The Kavya design system

Everything in this document describes code that already exists. It is a map of
the system, written so that the next component can be built without re-reading
the twelve files the first one was.

Where a decision has a reason attached, the reason is here too. A token with no
stated intent is a token the next person will "fix".

---

## 1. Where things live

| What | Where |
|---|---|
| Tokens (colour, shape, rhythm, glass, motion, elevation, type) | `src/styles/tokens.css` |
| The shared component kit | `src/components/ui/` |
| The signed-in frame | `src/components/ui/AppShell.tsx` + `shell.css` |
| The kit's own styles | `src/components/ui/ui.css` |
| The legacy base kit (**still live** — see §7) | `src/components/base/` |

**Tokens are not in `ui.css` or `shell.css`.** Neither file has a `:root` block;
both consume the tokens. If you are looking for a colour and cannot find it in
`ui.css`, it is in `tokens.css` by design.

The palette lives in **exactly one rule**: `:root` in `tokens.css`. It used to be
declared twice — a light `:root` and a dark palette on `.theme-dark`,
`.auth-shell` and `.ui-shell` — and both had to be kept in step. Nothing ever
rendered the light one, because `index.css` sets colour on `:root` and `:root`
*was* light. `design-tokens.test.mjs` enforces the single rule and fails the
build if a second copy appears.

The class names `.theme-dark`, `.auth-shell` and `.ui-shell` remain, but they are
**layout and scoping hooks now, not colour hooks.** `.theme-dark` is a misnomer
that survived the theme inversion; it means "full-bleed public surface".

---

## 2. The kit imports its own stylesheet

`src/components/ui/index.ts` begins with `import "./ui.css"` and
`import "./shell.css"`. That is deliberate:

> The kit brings its own stylesheet. A shared component whose appearance depends
> on a consumer remembering to load a stylesheet is not shared, it is a
> component that only looks right on the page that happened to be written first.

**Import from `@/components/ui` (the barrel), never from a leaf file.** A leaf
import skips the stylesheet and the component arrives unstyled.

---

## 3. Tokens

### Naming

By role, never by appearance or by screen of origin. A component asks for
`--surface`, not for "the console grey". Before this file existed there were four
private vocabularies (`--kavya-*`, `--console-*`, `--auth-*`, `--reseller-*`),
three holding the same thirteen values under different names and nine of sixty
declared tokens read by nothing at all.

### The palette

Sampled from `media/capybara-farm.mp4` — sky `#18A8F0`, grass `#48A818`, sun
`#D8D830`, pond cyan. The UI and the background footage are the same world rather
than a dark console laid over a bright field.

| Group | Tokens |
|---|---|
| Canvas | `--bg-canvas`, `--bg-raised`, `--surface`, `--surface-hover`, `--surface-glass`, `--surface-glass-strong` |
| Ink | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`, `--text-on-inverse`, `--text-on-accent` |
| Border | `--border`, `--border-strong` |
| Accent | `--accent-violet`, `--accent-magenta`, `--accent-cyan` |
| Status | `--status-success`, `--status-warning`, `--status-danger`, `--status-info` |
| Shape | `--radius-sm` … `--radius-xl`, `--radius-pill` |
| Rhythm | `--space-card`, `--space-gutter`, `--space-section` |
| Glass | `--glass-blur`, `--glass-blur-strong` |
| Motion | `--duration-fast`, `--duration-normal`, `--duration-slow`, `--ease-out-expo` |
| Elevation | `--shadow-lift`, `--shadow-float`, `--shadow-glow` |

### Three rules that are load-bearing

**Surfaces are layers of light, not colours.** Panels are translucent sheets over
the canvas, separated by what is behind them rather than by a border drawn around
them. An opaque surface would be the one place the background video stopped
showing.

**Glass is light, never dark.** A 0.6-alpha white sheet is what keeps text
legible while the video scrolls behind it; a dark tint becomes an opaque grey slab
the moment bright sky passes under it. Hence the generous `--glass-blur: 18px`.

**There is one easing curve.** `--ease-out-expo`. Anything that enters, lifts or
settles uses it, so the product decelerates in one dialect rather than four.

### The one exception to the theme: brand art

`--fx-art-plate`, `--fx-art-plate-ink`, `--fx-art-scrim`, `--fx-art-scrim-ink`,
`--fx-art-drop`, `--fx-scan-plate`. A product's logo plate sits on a
per-product gradient from `productBrandAssets`; inverting it would make the
monogram look like a hole in the tile. `--fx-scan-plate` cannot even be
translucent — a QRIS scanner resolves the code from module contrast.

### Backdrop-filter

`backdrop-filter` is permitted only via the standard property. There is a
`.ui-shell.ui-shell *` kill-switch setting `backdrop-filter: none !important`
(commit `920e33c`): the sticky console bars are opaque, because a translucent bar
over scrolling content costs GPU time on every frame and the console lag was real.
Do not write `-webkit-backdrop-filter` or vendor variants into source.

---

## 4. `Tone` — the one status vocabulary

```ts
export type Tone = "default" | "success" | "warning" | "danger" | "info" | "muted";
```

`Badge`, `Notice` and `Toast` all take it. It previously existed three times over
as `Tone`, `ConsoleTone` and `ResellerTone`; the duplicates are gone.

- `default` is the neutral.
- `muted` is the explicit synonym for "quiet but deliberate".
- **Never pass both `default` and `muted` to the same component.** Pick one.

---

## 5. The component kit

Exported from `src/components/ui/index.ts`.

### Actions

**`Button`** — `ButtonHTMLAttributes<HTMLButtonElement> & { weight?: ButtonWeight; children?: ReactNode }`

```ts
type ButtonWeight = "primary" | "secondary" | "danger" | "quiet";
```

Default weight is **`secondary`**, not `primary` — the safe plate is the one you
get for free, and reaching for the loudest thing should be deliberate.
`primary` is the near-white plate used by the sign-in button, the landing CTAs
and both consoles' primary actions. `danger` is the only weight that keeps a
colour, because a destructive action should not look like every other button.

**`ActionCard`** — `{ title, description, icon, onClick, variant }`, where
`variant: "card" | "bare"`. `card` is a pressable surface; `bare` is the same
content without the plate.

### Display

- **`Bento` / `BentoCell` / `BentoStat`** — the bento grid. `Bento` takes
  `{ children, className, label, rows, rowHeight }`. `BentoCell` takes
  `span?: { col?, row? }`, `emphasis?`, and `as?: ElementType` (defaults to
  `"article"`). `BentoStat` takes `tone?: "default" | "info" | "success" | "warning" | "danger"`.
- **`Metric` / `MetricRow`** — `{ label, value, hint, icon, tone, loading, error, active, onClick }`
  and `{ items, label }`. A `Metric` is clickable when given `onClick`.
- **`DetailRow` / `Field`** — `{ label, children }` and
  `{ label, children, hint, required }`.

### Data

**`DataTable<Row>`** — `rows`, `columns`, `rowKey`, `filters?`, `loading?`,
`error?`, `emptyText?`, `initialPageSize?`, `bulkAction?`.

```ts
type DataColumn<Row> = {
  id: string; header: string; value: (row: Row) => string | number;
  cell?: (row: Row) => ReactNode; sortable?: boolean; hideOnMobile?: boolean;
};
type DataFilter<Row> = {
  id: string; label: string;
  options: Array<{ label: string; value: string }>;
  value: (row: Row) => string;
};
```

Note `DataFilter.options` is a list of `{ label, value }` pairs, not a list of
strings — a filter option may display something other than its value. `value` is
a predicate over the row, not the currently-selected value.

Pagination, sort, filtering, the loading and error states and the empty state are
the table's job. A page that hand-rolls any of them is rebuilding this.

### Overlays

**`Dialog`** and **`Drawer`** share one implementation with
`variant: "dialog" | "drawer"`. Both take `wide?`, `title`, `description?`,
`eyebrow?`, `footer?`, `closeLabel`. **`DialogActions`** lays out a footer.

**`useOverlayFocus(open, onClose)`** — focus trap plus focus return. Use it for
any overlay you add; it is the same hook both console overlays use.

**`useDismiss(open, onClose)`** — Escape or an outside click closes it, and returns
the ref to attach. Exported because a popover living in a slot (the notification
centre) needs the same behaviour and a second implementation would drift.

### States

Always reach for these instead of an ad-hoc spinner or empty block:

- **`LoadingState`** — `{ label = "Memuat data" }` for a whole region.
- **`LoadingSkeleton`** — `{ lines = 1 }` for inline placeholders.
- **`EmptyState`** — `{ title, description, action }`.
- **`ErrorState`** — `{ message, onRetry }`. `onRetry` is what makes it an error
  state rather than an error message.

### Feedback

**`Notice`** and **`Toast`**, both taking `Tone`. **`Badge`** —
`{ children, tone = "default" }`.

### Secrets

**`SensitiveValue`** — `{ value, kind = "identity", concealAfterMs = REVEAL_AFTER_MS }`
renders a masked value that reveals on demand and re-conceals itself.

**`maskIdentity` / `maskSecret`** do the masking; **`CopyButton`** —
`{ value, label = "Salin", onCopied }` — copies without rendering. Use these
rather than printing a credential into the DOM.

### Command palette

**`CommandPalette`** with `CommandGroup` / `CommandHit`, and **`CommandKeyHint`**
for the shortcut chip.

### Navigation

**`ShellNav`** — `{ groups, collapsed, label, onNavigate? }`.

---

## 6. The shell API

`AppShell` is the frame every signed-in page sits in. There were two of them, 79%
identical, and they had drifted: one had a notification centre and no bottom bar,
the other the reverse; one remembered its collapsed state and one did not; both
spelled the same refresh button differently. There is one now.

```tsx
<AppShell
  role="owner" | "reseller"
  product="Kavya"
  homePath="/owner-v2"
  homeLabel="Owner console"
  deniedPath="/reseller-v2/summary"
  navigation={AppShellNavGroup[]}
  bottomNavigation={AppShellNavItem[]}
  settings={{ path: string; label: string }}
  title={string}
  description={string}
  lastUpdated?: string
  refreshing?: boolean
  onRefresh?: () => void | Promise<void>}
  sidebarTop?: ReactNode
  topbarLeading?: ReactNode}
  topbarActions?: (controls: { closePopovers: () => void }) => ReactNode}
  search?: (controls: { close: () => void }) => ReactNode}
  searchPlaceholder?: string}
  searchLabel?: string}
>
  {children}
</AppShell>
```

### What the shell owns

The session gate, the collapsible rail, the mobile drawer, the search trigger and
its Ctrl+K, the profile popover, sign-out, and the page header.

This is the part that must behave identically for an owner and a reseller,
because someone who switches roles should not relearn where anything is.

The gate: signed out → `/login?next=<homePath>`; wrong role → `deniedPath`.

The page header is a **region of the frame**, not a `div` a page happens to start
with. Every page inherits the same rhythm, and a long product name pushes the
description down without shoving the refresh button off the edge.

### What it does not own

Passed in as slots: the notification centre, the balance and top-up controls, the
search palette. Those know what data they show; the shell knows only where to put
them.

### `onRefresh` is deliberately `() => void | Promise<void>`

Every caller's reload is async. The shell only ever calls it from a click
handler, where a returned promise is discarded by design, so awaiting it would
buy nothing. Declaring `() => void` made every call site a type error whose only
escape was a `void` operator that promised nothing was awaited.

### Nav item

```ts
type AppShellNavItem = {
  label: string; path: string; icon: LucideIcon;
  shortLabel?: string;  // shown under the icon on a phone; falls back to label
  badge?: number;       // renders nothing when 0
  end?: boolean;        // match exactly
};
type AppShellNavGroup = { label: string; items: AppShellNavItem[] };
```

Set `end` on a link to a section index. Without it, `/owner-v2` stays lit on
every page beneath it, which reads as "you are still on the overview".

### Responsive visibility

The rail is one fragment rendered into **two** `<aside>` elements — the desktop
rail and the mobile drawer — so no rail button can leave the DOM. Visibility flips
at one breakpoint and **both sides of the flip are stated** in `shell.css`:

- `.is-mobile-only { display: none; }` — the default, because the desktop rail is
  the default.
- The `max-width: 1023px` block re-states both.

This used to be inverted, which put the drawer's close button — wired to
`setDrawerOpen(false)`, a no-op while no drawer is open — on desktop screens in
place of the collapse button. `shell-responsive-visibility.test.mjs` pins it.

---

## 7. The legacy base kit — still live

`src/components/base/` holds three files. **They are not dead code**, and the
exit condition for removing them has not been met:

| File | Live consumers |
|---|---|
| `ErrorBoundary.tsx` | `src/main.tsx`, `src/router/index.tsx` |
| `Card.tsx` | `src/pages/NotFound.tsx` |
| `Button.tsx` | `src/pages/NotFound.tsx` |

Both files carry a comment saying Phase 6 removes them once the last callers move
to `ui/`. That has not happened, and this document is where the honest status
goes: **the migration is still outstanding.**

Note that `ErrorBoundary` has no `ui/` equivalent — it needs porting or a new home
before `base/` can go. `NotFound.tsx` is the only remaining `Button`/`Card`
caller and is the cheap half.

Until then, both kits are live. Two rules keep that from turning into drift:

- **New components go in `ui/`, always.** `base/` is read-only.
- Both kits already resolve colour through the same tokens, so a component that
  has not yet migrated still looks like the same product.

---

## 8. The lint gate

`eslint.config.js` runs type-aware rules over `src/**/*.{ts,tsx}`.

Type-aware rules need `projectService: true` — **not** `project`, because this
package uses TS project references with `noEmit` and a plain `project` path
cannot resolve those.

Without `projectService` the type-aware rules **fail open**: they report nothing
and pass, which is byte-identical to a clean codebase. A gate that cannot fail is
worse than no gate, because it is believed. `eslint-gate.test.mjs` asserts the
configuration so this cannot be undone quietly.

Rules are at `error`:

| Rule | Why |
|---|---|
| `no-floating-promises` | `tsc -b` proves the program compiles; it cannot see a promise nobody awaited. |
| `await-thenable` | Same class. |
| `no-misused-promises` | See the option below. |
| `no-unused-vars` | `^_` is the ignore prefix. |
| `no-empty-object-type` | v8 removed `ban-types` and split it; this is the piece that catches `{}` as "any object". |
| `consistent-type-imports` | `fixStyle: "inline-type-imports"`. |

```js
"@typescript-eslint/no-misused-promises": [
  "error",
  { checksVoidReturn: { attributes: false, arguments: true } },
]
```

`attributes: false` is **not a suppression** — it is how the rule is meant to be
used with React. `onClick={async () => save()}` is correct code, because React
discards whatever the handler returns. Only the `arguments: true` half stays on,
where an async value handed to a void-returning parameter really is a caller that
cannot see the failure. Do not "fix" this.

Four `no-unsafe-*` rules are `off` on purpose: the API layer types most of its
boundary as `unknown` and parses at runtime, so switching them on is a typing
project rather than a config edit. The reason is recorded in the config as prose
and asserted by the test.

`react-hooks/exhaustive-deps` is still `warn`. It is the one rule not yet
promoted.

Each of these was enabled as a warning first, the codebase made clean, and only
then promoted — turning a rule on across an existing codebase as an error
immediately is how a lint gate gets disabled rather than obeyed. The promotion
took 137 warnings to 0, resolved by measurement: two prop-type widenings, one
correct rule option, and `void` on 15 deliberate fire-and-forget calls.

### Not yet done: `jsx-a11y`

`eslint-plugin-jsx-a11y@6.10.2` peer-requires ESLint `^3 || … || ^9` and rejects
the ESLint 10 this project runs. A runtime compatibility probe was **denied by
the permission classifier** and was not worked around. The rule set is therefore
absent, and accessibility in this codebase rests on the manual discipline recorded
throughout this document. This is an open item, not a completed one.

---

## 9. Writing a new component

1. Check whether the kit already has it. `DataTable` covers pagination, sort,
   filter, loading, error and empty. `State` covers all four states.
2. If not, add it to `src/components/ui/`, import `ui.css` via the barrel, and
   use tokens only. No raw hex, no `bg-gray-100`, no one-off `clamp()`.
3. Give it a `Tone` rather than a new colour vocabulary.
4. If it is an overlay, use `useOverlayFocus`. If it is a popover, use `useDismiss`.
5. Only things a reader can press move. Containers get a shadow and no hover.
6. Animate `transform` and `opacity`, not `width`, `height`, `top` or `margin`.
7. Add it to `index.ts`.
