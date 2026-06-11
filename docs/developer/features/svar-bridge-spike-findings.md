# SVAR File Manager — Phase 0 Findings

**Status:** Install + license gate PASSED (2026-06-10). CSS bridge spike pending (needs human go/no-go).
**Parent plan:** [svar-file-manager-implementation-plan.md](svar-file-manager-implementation-plan.md)

---

## 1. Install + pin

- Installed `@svar-ui/react-filemanager@2.6.0` with `--save-exact`; pinned in
  `package.json` as `"@svar-ui/react-filemanager": "2.6.0"` (no caret).
- Pulled **27 `@svar-ui/*` packages** total (the wrapper drags in the wider
  family — comments/editor/filter/grid/tasklist/toolbar/uploader stores +
  locales + `lib-*`). Footprint: **6.2 MB** under `node_modules/@svar-ui`.
- **No native modules** (`*.node` / `binding.gyp` / `*.wasm`): none. **No
  install/postinstall hooks** in any `@svar-ui` package. So no `next.config.js`
  `serverExternalPackages` / `outputFileTracingIncludes` work is needed — SVAR
  is browser-only JS/CSS.
- Pre-existing `npm audit` reports 3 moderate vulns — **none in any `@svar-ui`
  package** (unrelated to this install). The `EBADENGINE` warning (Quilltap
  wants node ≥24, env has v22) also predates this change.

## 2. License gate — PASS

Verified the **actual** license files, not just `package.json#license` metadata:

- All **27** `@svar-ui/*` packages declare `license: "MIT"`.
- **13** ship a verbatim MIT `license.txt` (© 2025 XB Software Sp. z o.o.);
  the other 14 (the `*-locales`, `lib-*`, and `*-data-provider` leaf packages)
  declare MIT in `package.json` with no separate file.
- A copyleft/commercial keyword scan (`GPL|AGPL|LGPL|MPL|commercial|proprietary`)
  produced one apparent hit per file — confirmed a **false positive**: the regex
  matched the substring `MPL` inside `IMPLIED` in the MIT warranty disclaimer.
  No genuine copyleft or commercial-license terms anywhere.

**Verdict:** clean for redistribution in the standalone tarball + Electron
shell. The May-survey GPL/commercial concern does **not** apply to this npm
distribution.

## 3. Versions installed (for reproducibility)

Wrapper + react family at `2.6.0`; grid family at `2.7.0`;
`lib-data-provider 1.7.1`, `lib-dom 0.13.1`, `lib-react 1.3.0`,
`lib-state 1.9.7`, `uploader-locales 2.5.3`. (Full list captured at install
time; all MIT.)

---

## 4. CSS bridge spike — built; preliminary lean **GO** (full human sweep pending)

Harness: `spike/svar-bridge/` (throwaway esbuild static app, zero new deps — uses
the repo's existing esbuild + react). Bare SVAR `<Filemanager>` on mock data with
a 6-theme + light/dark switcher. Run with `node spike/svar-bridge/build.mjs`.

### SVAR's CSS surface
- SVAR exposes **257 `--wx-*` custom properties**, but ~330 of its CSS
  declarations are `var(--wx-*)`-driven from a **small root token set** — so the
  bridge remaps ~25 roots and the rest cascade. `_svar-bridge.css` is ~30 lines.
- The file manager has its **own** `--wx-fm-*` namespace (panel background, grid
  border, header, selection bg) that does **not** derive from `--wx-background`.
  Missing these first left the panels willow-grey under a dark theme; mapping the
  six `--wx-fm-*` vars fixed it. (Lesson for Phase 2/4: map `--wx-fm-*`
  explicitly, not just the core `--wx-*`.)
- SVAR does **not** self-apply a theme — the component must be wrapped in
  `.wx-willow-theme` (SVAR's `<Willow>` from `@svar-ui/react-core`, or the bare
  class). Noted for the adapter.

### Reachability measurement (the go/no-go crux)
Stripping SVAR's own `--wx-*` definition blocks, the component CSS has
**331 `var(--wx-*)`-driven color/border/shadow declarations vs. only 11 literal
colors.** The 11 literals are cosmetic and enumerable:
- `color: #fff` ×2 (white-on-primary button text — fine on a brass/primary fill)
- color-picker / slider `box-shadow`s ×4 (a widget the file manager doesn't use)
- print-filter highlight `#ffeb3b`, modal overlay `#00000080`,
  drop-shadow `#2c2f3c1f` / `#0009`, one muted `#94a1b3`.

None are structural (no hardcoded row/panel/selection colors once `--wx-fm-*` is
mapped). This is the "short + cosmetic" outcome the plan defines as **GO**.

### Verified live
- **Quilltap Default (light):** renders cleanly — card surfaces, border radius,
  muted text all from qt tokens.
- **Madman's Box (dark-only, the stress case):** after the `--wx-fm-*` mapping,
  panels are walnut (`--color-card`), text warm parchment, the toolbar action
  button and scrollbar **brass** (`--color-primary`) — all from the bridge, with
  **zero** per-theme SVAR CSS.

### Context-menu / popup surface (found + fixed 2026-06-10)
SVAR portals context menus to `<body>` (via `createPortal`) with a
`wx-willow-theme` portal div — so the bridge's `--wx-*` rules DO reach them, but
the `var(--color-*)` they reference only resolve if the theme tokens cascade to
`<body>`. That requires `[data-theme]` on `<html>`, which the app already does
(`applyThemeToDom` → `document.documentElement`); the spike originally put it on
a nested div (Storybook-style), so menus fell back to the `:root` light defaults
and looked transparent/low-contrast on dark themes. Two fixes: (1) the bridge
now maps `--wx-popup-background/-border/-shadow` to the **popover** tokens
(solid surface, real border, themed shadow — willow's default popup border is a
near-transparent white that vanishes on dark); (2) the spike applies the theme on
`<html>` to mirror the app. Verified: under Madman's Box the menu is opaque
walnut (`--color-popover`) with parchment text. **Lesson for Phase 4:** the
promoted bridge themes SVAR's body-portals correctly *because* the app themes on
`<html>` — no extra portal plumbing needed.

### Selection / list-header surfaces (found + fixed 2026-06-10)
On dark themes the list-view column header and selected rows fell back to
willow's LIGHT defaults (a near-white `--wx-table-header-background` /
`--wx-table-select-background`), and the tree/grid selection had been mapped to
the FULL saturated `--color-accent` (Madman's Box accent is bright amber) — so
SVAR's light `--wx-color-font` text sat on a loud light fill, unreadable. Fixes
in the bridge:
- `--wx-table-header-background` → `--color-muted` (dark header).
- A single `--_qtap-selection` token = `color-mix(in srgb, var(--color-accent)
  24%, var(--color-card))` — a dark, accent-TINTED fill — drives
  `--wx-fm-select-background`, `--wx-table-select-background`, and
  `--wx-color-primary-selected`, with `--wx-table-select-color: --color-foreground`
  and a brass left-edge marker (`inset 3px 0 --color-primary`) as the strong cue.
- Row hover dropped from the loud accent to a subtle `--color-muted`.

Net hierarchy on dark themes: rest (card) < hover (muted) < selected (amber-tint
+ brass edge), all with readable parchment text. **General principle for the
bridge: a theme's *accent* may be a loud saturated hue, so never use it as a
full selection FILL behind SVAR's light body text — tint it into the card.**

### Remaining for the human go/no-go
Click through the other four themes (Art Deco, Earl Grey, Great Estate, Old
School, Rains) × {light, dark}, exercise split-pane + selection + drag + focus
ring, and confirm legibility. Drop screenshots here and stamp the final
**GO / NO-GO**. Preliminary engineering lean: **GO** — the reachability ratio and
the two themes verified so far clear the bar.
