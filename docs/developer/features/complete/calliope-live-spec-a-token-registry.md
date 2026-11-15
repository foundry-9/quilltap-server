# Calliope Live — Spec A: token registry and bundle format v2

**Status:** ready to run, 2026-11-14 (design decisions confirmed by the human). Implements Phase 0b of
[calliope-live.md](../calliope-live.md). Read that document and the audit,
[calliope-live-audit.md](calliope-live-audit.md), before starting; this spec
assumes both. The audit's variable table is
[calliope-live-audit-matrix.csv](calliope-live-audit-matrix.csv).

**Scope:** `quilltap-server` only.

## Goal

Make the theme system's variables structured data with one source of truth,
widen the semantic tier so that component values can derive from it, and define
and implement the version 2 theme document — **without changing how anything
looks**. The six bundled themes are not migrated here (that is Spec C). At the
end of this spec:

- every `--qt-*` and `--theme-*` default comes from a registry in
  `lib/themes/`, and the CSS that declares them is generated;
- a version 2 theme (tokens + scoped custom CSS + assets) can be validated,
  resolved, emitted and loaded, proven by a fixture theme;
- version 1 bundles still load exactly as before.

## Out of scope

Migrating the bundled themes; removing version 1; the `quilltap themes` CLI and
`create-quilltap-theme`; the published JSON Schema; the hook catalogue (Spec
B); contrast validation; any editor UI; layout variants beyond the one choice
token defined below.

## Decisions taken

| # | Decision | Status |
|---|---|---|
| 1 | The registry is TypeScript in `lib/themes/registry/`; a `tsx` script generates the CSS from it. Same pattern as `components/ui/icons/icon-registry.ts` → `_icons.css`. | settled |
| 2 | Token values are plain CSS strings. References are ordinary `var(--name)`. There is no separate reference syntax. | settled |
| 3 | Primitives are an open, author-named set, emitted as `--p-<name>`. | settled |
| 4 | Version 1 and version 2 bundles both load until Spec C removes version 1. | settled |
| 5 | Version 2 drops `extendsTheme`. Every theme inherits from the registry defaults; "start from an installed theme" is a copy. | confirmed 2026-11-14 |
| 6 | Enumerated settings ("choices", starting with `density`) are expressed as a `data-qt-<name>` attribute on `<html>`, with the registry generating the per-option values. Layout variants will later use the same mechanism. | confirmed 2026-11-14 |
| 7 | Custom CSS may not use `@import`, and `url()` may only be bundle-relative or `data:image/…`. No attempt is made at a list of selectors a theme may not restyle. | confirmed 2026-11-14 |


## Constraints that apply throughout

- **No visual change.** The snapshot test from Stage 0 is the proof; it must
  stay green at the end of every stage. Where a stage adds names, existing
  names keep their values.
- Follow `CLAUDE.md`. In particular: no stubs or `TODO`s; run `npm run lint`
  (four of its gates read this CSS); check types with `npx tsc`; after any
  change under `app/styles/qt-components/` or to `theme-tokens.css`, run
  `npm run generate:storybook-css` and bump `packages/theme-storybook`'s patch
  version; record changes in `docs/CHANGELOG.md` in plain voice.
- New backend paths log at debug through the built-in logger.
- Nothing here is user-visible, so no `help/*.md` change is needed. If that
  turns out to be untrue, say so and document it.
- `.claude/plans/calliope-live-css-safety.md` (untracked, private) lists what
  the current loader permits. Stage 3 must close the items that concern bundle
  CSS and manifest strings for version 2. Do not copy its contents into any
  tracked file, commit message or the changelog.
- Commit nothing; leave the work for the human to review and commit per stage.

## Stage 0 — snapshot harness and one check

### 0.1 Resolved-variable snapshot

Write `scripts/theme-snapshot.ts` (run with `tsx`). For each of the seven
themes (`default` plus the six bundles) in each mode (light, dark) it computes
the value every custom property resolves to **on the `<html>` element**, and
writes one JSON file per theme and mode.

How it resolves:

1. Gather declarations in cascade order: the app's CSS in import order from
   `app/globals.css` (including the `@theme inline` map in
   `app/styles/theme-tokens.css`, treated as declarations on `:root`); then,
   for a bundle, what `theme-style-injector.tsx` injects, in its order — token
   CSS from `themeTokensToCSS`, then the bundle's `styles.css`.
2. Keep declarations of custom properties whose selector matches `<html>` with
   `data-theme="<id>"`, class `light` or `dark`. Selectors that target
   descendants are ignored.
3. Pick the winner per property by cascade layer, then specificity, then
   order. Unlayered beats layered.
4. Substitute `var()` references recursively, honouring fallbacks. Report a
   cycle or an unresolvable reference as an error.

Output is a sorted `name → resolved string` map with whitespace normalised.
Commit the fourteen files as fixtures under
`__tests__/unit/lib/themes/fixtures/snapshots/`, and add a Jest test that
recomputes and compares. This test is the guard for every later stage.

### 0.2 Confirm or dismiss the font-token defect

The audit infers (section 5) that `tokens.typography.fontSans/fontSerif/
fontMono` never take effect, because `_variables.css` declares
`--theme-font-*` at higher specificity than the injected `:root`. The snapshot
answers it: compare each bundle's `tokens.json` font stacks with the resolved
`--theme-font-sans/serif/mono`, with the theme's own `styles.css` font
declarations removed. Record the finding in the audit document. **Do not fix
it here** — a fix changes rendering; Spec C decides.

**Done when:** the fixtures exist, the test passes, and the audit carries the
finding.

## Stage 1 — the registry becomes the source of truth

No value changes. This stage moves what exists.

### 1.1 Registry shape

`lib/themes/registry/`, framework-free, importable by server, client and
scripts.

```ts
type TokenType =
  | 'color' | 'length' | 'radius' | 'shadow' | 'font-family' | 'font-weight'
  | 'font-style' | 'duration' | 'easing' | 'transition' | 'opacity'
  | 'image' | 'border' | 'blur' | 'z-index' | 'number' | 'keyword' | 'raw';

interface TokenDef {
  name: `--${string}`;          // the CSS custom property
  tier: 'semantic' | 'component';
  type: TokenType;
  group: string;                // 'badge', 'chat', 'terminal', …
  label: string;                // plain English, for a future editor
  description?: string;
  default: string;              // CSS value; may reference other tokens
  defaultDark?: string;         // only when dark differs
  visibility: 'standard' | 'advanced' | 'internal';
}
```

One file per group, one exported array each, collected in `index.ts` with
lookups by name and by group. A unit test enforces: unique names; every
`var()` in a default names a registry token, a Tailwind token from
`theme-tokens.css`, or carries a fallback; no reference cycles; a `component`
default may reference `semantic` and `component` tokens, a `semantic` default
may not reference a `component` one.

Populate it from `_variables.css` as it stands: 505 entries, `tier:
'component'` (the five `--theme-font-*` are `semantic`). Preserve the
section comments as `description` on the group. Set `visibility` from the
audit CSV: class `most` or `some` → `standard`; `few` or `never` →
`advanced`.

Also add the 14 variables the app reads as `var(--hook, fallback)` but never
declares (audit 1.7), each with `default` equal to the fallback in use, so
nothing changes. Where the same hook has different fallbacks at different call
sites, do not add it; list it in the stage report instead.

The 12 variables nothing reads (audit 1.7) stay in the registry with
`visibility: 'internal'` and a description saying so. Removal is Spec C's,
because bundled themes still set eight of them.

### 1.2 Generation

`scripts/generate-theme-variables.ts`, `npm run generate:theme-variables`,
writes `app/styles/qt-components/_variables.css` with a generated-file header.
It emits the same two blocks the file has now, with the same selectors
(`:root, [data-theme], [data-theme].dark, [data-theme].light` for defaults and
`[data-theme].dark` for `defaultDark`), grouped and commented by group. Do not
change selectors or specificity in this stage.

The hand-written rules in today's file — the `[data-theme="default"]` root
baseline, `::selection`, and the reduced-motion block — move unchanged to a
new hand-written `app/styles/qt-components/_base.css`, imported from
`_index.css` in the position that preserves the present order.

Add `scripts/check-theme-variables.mjs` to `npm run lint`, in the manner of
`check-storybook-css.mjs`: it fails when the committed file differs from what
the registry generates. Make sure `check-css-vars.mjs`,
`check-qt-classes.mjs` and `check-storybook-css.mjs` still pass, and that
`scripts/lib/storybook-css.mjs` still finds what it needs.

**Done when:** the snapshot test is green with untouched fixtures; `npm run
lint` and `npx tsc` pass; `_variables.css` is generated; the Storybook CSS is
regenerated (bump the package if its output changed at all).

## Stage 2 — widen the semantic tier

The audit's central finding is that bundled themes set about 85% literal
values because the semantic tier is too narrow to derive from. This stage
designs the missing semantic tokens and re-expresses component defaults in
terms of them. It is design work; the fit report (2.4) is what keeps it honest.

### 2.1 Bring the existing semantic tokens into the registry

Add registry entries (`tier: 'semantic'`) for everything `ThemeTokensSchema`
declares and `themeTokensToCSS` emits: the 27 colours, typography, radii and
spacing, shadows, transitions, focus ring. Defaults are the values in the
`:root` and `.dark` blocks of `app/globals.css` (lines 80–217 today).

Generate those two blocks into `app/styles/_theme-defaults.css` from the
registry and import it from `globals.css` in their place. Make
`lib/themes/default-tokens.ts` derive `DEFAULT_THEME_TOKENS` from the registry
rather than restating the values; if the two disagree today, the CSS is the
truth (it is what renders) — list every disagreement in the stage report.

### 2.2 New semantic families

Design a small set of semantic tokens for each family below, then rewrite the
component defaults in that family to derive from them (`var()`,
`color-mix()`), keeping every existing component token as an override point.
Each new token's default must make every existing name resolve to exactly its
current value in the default theme, both modes.

| Family | Component variables involved | Intent |
|---|---|---|
| Category palette | `--qt-badge-*` (76) | one colour per entity category; bg / fg / border per badge derived by one formula |
| Status | `--qt-alert-*` (12), `--qt-warning-*`, status badges | bg / fg / border derived from `success` / `warning` / `info` / `destructive` |
| Chat surfaces | `--qt-chat-*` (57) | assistant, user, system and whisper surfaces and their text |
| Roleplay text | `--qt-rp-*`, `--qt-roleplay-*` (31) | dialogue, narration, inner monologue, out-of-character |
| Terminal | `--qt-terminal-*` (30) | background, foreground, cursor, selection, the 16 ANSI colours — these are already primitives in effect; make them a named semantic block |
| Overlay | `--qt-overlay-*`, dialog backdrop | scrim colour and strength |
| Interaction states | hover / active variants across button, tab, card, navbar, filter | a hover and an active mixing rule, so `*-hover-bg` derives instead of being literal |

Naming: semantic tokens are `--theme-<family>-<role>` (for example
`--theme-category-character`, `--theme-terminal-ansi-red`). Add each to the
Tailwind map in `theme-tokens.css` only if app CSS needs it as a `--color-*`
utility.

### 2.3 Things every theme hand-writes, as tokens with app-owned rules

For each row, add the tokens and one app-owned rule that uses them. The rule
goes in `@layer base` or `@layer components` so that a version 1 theme's
unlayered rule still wins, and the token defaults must leave the default theme
rendering as it does now (where the default theme has no such rule today, the
default value is the one that makes the new rule a no-op).

| Feature | Tokens |
|---|---|
| Text selection | background, foreground |
| Scrollbar | size, track, thumb, thumb hover, thumb radius |
| Focus ring | wire the existing `effects.focusRing*` tokens to one `:focus-visible` rule; add an optional glow |
| Headings | font, letter spacing, text transform, weight, colour — applied to the `qt-heading-*` classes, not to bare `h1`–`h6` |
| Button text | letter spacing, text transform |
| Form control radius | one token for `.qt-input`, `.qt-textarea`, `.qt-select` |
| Card and dialog border | colour (and width for dialog) |
| Colour scheme | `color-scheme` for the root |
| Page background image | image, size, position, attachment, repeat; per mode |

Page background needs app-owned behaviour, not only a rule: three themes each
hand-write fifteen rules to paint an image on `body`, make eight surface
classes transparent over it, and undo that when a story background is showing
(audit 2.1). Implement it once: when the page-background image token is set,
the app marks the root (a `data-qt-page-background` attribute set by
`applyThemeToDom`), and app CSS keyed on that attribute does the transparency
and yields to the story background. With the token unset nothing changes.

The reduced-motion block and the root baseline (font smoothing, scroll
behaviour) are already app-owned after Stage 1; make the baseline apply to
every theme rather than `[data-theme="default"]` only if, and only if, the
snapshot and a visual check of one bundled theme show no change.

### 2.4 Density

Add a choice token `density` with options `compact` and `comfortable`. The roughly 30
registry variables that all six themes set to one identical value different
from the default (audit 1.4; in the CSV, `class = most`, `themes_setting = 6`
and `distinct_values = 1`, less any whose value equals the default)
get a second value in the registry (`byChoice: { density: { comfortable: '…' } }`
on `TokenDef`). The generator emits a
`[data-theme][data-qt-density="comfortable"]` block. `compact` is the current
default and emits nothing. Nothing sets the attribute yet; Stage 3 does, for
version 2 themes.

### 2.5 Fit report

Write `docs/developer/features/calliope-live-spec-a-fit.md`. For each family
in 2.2 and each feature in 2.3, state the tokens added and the derivation, and
then test it against the six bundled themes' actual values (from the Stage 0
fixtures): if a theme set only the new semantic tokens for that family, how
many of its current component values would the derivation reproduce exactly,
how many within a small colour difference (state the measure), and how many
would still need a component override. Give one table per family.

A family whose derivation reproduces fewer than about half of the values
across the six themes is the wrong derivation: try another, or say plainly
that the family should stay literal at the component tier, and why. Do not
tune formulas to the default theme alone.

**Done when:** the snapshot test is green — every pre-existing name unchanged
in all fourteen fixtures, new names added (regenerate fixtures only to add
names, and show the diff is additions only); lint, types and Storybook CSS as
in Stage 1; the fit report is written.

## Stage 3 — the version 2 theme document

A framework-free engine in `lib/themes/engine/`: pure functions, no React, and
no file access in `resolve`, `emit` or `scope` (the loader reads files and
passes strings in).

### 3.1 Document

`theme.json`, `formatVersion: 2`. Same identity fields as version 1 (`id`,
`name`, `description`, `version`, `author`, `license`, `tags`,
`supportsDarkMode`, `previewImage`, `tokensPath`, `stylesPath`). Changes:

- `extendsTheme` is not part of version 2 (decision 5).
- `fonts[]` gain a required `license` (SPDX identifier or `"proprietary"`) and
  optional `licenseFile` (bundle-relative).
- `icons` names are validated against the app's icon list; each path must be
  `.svg` or `.webp` and exist.
- `subsystems` keys are validated against the known subsystem ids
  (`lib/foundry/subsystem-defaults.ts`); `thumbnail` and `backgroundImage` are
  bundle-relative paths or `"none"`, nothing else.
- Every manifest string that reaches CSS (font family, paths) is escaped at
  the point of emission.

`tokens.json`:

```json
{
  "primitives": {
    "gold":      { "type": "color", "value": "#C19015", "dark": "#F4BE34" },
    "line-thin": { "type": "length", "value": "1px" }
  },
  "tokens": {
    "--theme-primary": "var(--p-gold)",
    "--qt-card-shadow": { "value": "0 1px 3px rgb(0 0 0 / 0.1)", "dark": "0 1px 3px rgb(0 0 0 / 0.4)" }
  },
  "choices": { "density": "comfortable" }
}
```

- `primitives`: author-named, kebab-case, typed. Emitted as `--p-<name>`.
- `tokens`: keys are registry names. A value is a string (both modes) or
  `{ value, dark }`. A theme stores only what it overrides.
- `choices`: registry choice tokens and one of their options.

Zod schemas are the source of truth. Validation errors name the key and, for
an unknown token name, suggest the nearest registry name.

Validation rules: unknown token or choice → error; a `var()` reference must
name a primitive in the document, a registry token, or carry a fallback;
no cycles; values are checked against the token's type where that is cheap
and certain (a literal colour parses as a colour, a length has a unit), and a
value containing `var()`, `calc()` or `color-mix()` is accepted for any type;
a value may not contain `;`, `{`, `}` or `</`; `url()` follows 3.3.

### 3.2 Resolve and emit

- `resolveTheme(doc, registry)` → for light and dark, the full map of every
  token and primitive to its unresolved value plus where it came from
  (`default`, `default-dark`, `choice`, `theme`, `theme-dark`). The editor
  will need the provenance; the emitter needs only the theme's own entries.
- `emitThemeCss(doc, { id, version })` → CSS declaring only what the theme
  sets. Base values go under the selector list
  `[data-theme="<id>"], [data-theme="<id>"].light, [data-theme="<id>"].dark`,
  dark values under `[data-theme="<id>"].dark` after it — the pattern the
  bundled themes use today, which is what outranks the generated defaults.
  Version 2 does not go through `themeTokensToCSS`.
- Choices: `applyThemeToDom` sets or removes `data-qt-<name>` on `<html>` from
  the active theme's choices, and `data-qt-page-background` per 2.3.

### 3.3 Custom CSS and assets

Authors write ordinary selectors with no theme id. `scopeThemeCss(css, { id,
version, files })` parses with PostCSS and re-emits:

- every selector is prefixed with `[data-theme="<id>"]` as an ancestor;
  a leading `:root` or `html` becomes the prefix itself; a leading `.dark` or
  `.light` attaches to the prefix (`[data-theme="<id>"].dark …`); `body` stays
  a descendant;
- `@keyframes` names are prefixed with the theme id, and `animation` /
  `animation-name` values that use them are rewritten to match;
- `@media`, `@supports`, `@container` and `@layer` are kept, their contents
  scoped; `@font-face` is rejected (fonts are declared in the manifest);
  `@import`, `@charset` and `@namespace` are rejected;
- `url()` — in custom CSS and in token values — must be a relative path to a
  file present in the bundle with an allowed image extension, or a
  `data:image/…` URI. Relative paths are rewritten to
  `/api/themes/assets/bundle:<id>/<path>?v=<version>`. Absolute, remote and
  protocol-relative URLs are rejected;
- anything PostCSS cannot parse is rejected, and the output is re-serialised
  from the tree, never passed through as text.

A rejection is a validation error naming the line. `postcss` must move to
`dependencies`; it is then a runtime dependency of the server, so check the
standalone build (`next.config.js` `outputFileTracingIncludes`, and the
tarball) per the native-and-runtime dependency notes in `CLAUDE.md`.

### 3.4 Loader

- `QtapThemeManifestSchema` becomes a discriminated union on `formatVersion`.
  The version 1 branch and everything it feeds are untouched.
- A version 2 bundle is validated (manifest, tokens, custom CSS, every
  referenced file resolved through `resolveInside`), then registered with its
  emitted token CSS and scoped custom CSS. `theme-style-injector.tsx` injects,
  for version 2: `@font-face`, emitted token CSS, icon overrides, scoped
  custom CSS.
- The `?action=tokens` response of `/api/v1/themes/[themeId]` carries what the
  client needs for version 2 (choices; the version 1 token shape is absent).
  Check every consumer of that response — `ThemeProvider`, the Appearance
  card's previews — and make each handle both versions.
- Export of an installed version 2 bundle writes `formatVersion: 2`.

### 3.5 Fixture theme and tests

Create a small version 2 theme under `__tests__/fixtures/themes/v2-sample/`
(not in `themes/bundled/`): a handful of primitives, semantic and component
overrides in both modes, `density`, a page-background texture, one font with
a licence, one icon, and a custom CSS file exercising every scoping rule
(`:root`, `.dark`, `body`, a pseudo-element, a keyframe animation, a media
query, a relative `url()`).

Tests: schema acceptance and each rejection in 3.1 and 3.3; resolve
provenance; emitted CSS (snapshot); scoped CSS (snapshot); a snapshot-harness
run over the fixture theme showing overridden tokens take their new values and
everything else keeps its default; loader round trip (validate → install →
register → export) for the fixture; a version 1 bundle still loading.

**Done when:** all of the above pass with the Stage 0 fixtures untouched
since Stage 2; lint and types pass; the changelog has one entry per stage.

## Report back

At the end of each stage, stop and report: what changed, the snapshot result,
anything in this spec that proved wrong or underspecified and what was done
instead, and (Stage 2) a one-paragraph reading of the fit report — which
families derive well and which do not.
