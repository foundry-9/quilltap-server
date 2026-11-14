# Quilltap Changelog

## Recent Changes

### 4.14-dev

#### Themes: version 2 theme document (Calliope Live, Spec A Stage 3)

- Added the version 2 theme format (`theme.json` with `formatVersion: 2`): `tokens.json` holds author-named primitives (emitted as `--p-<name>`), overrides of registry tokens (one value, or light and dark) and choices; custom CSS is written without the theme id. `extendsTheme` is not part of version 2
- Added the theme engine, `lib/themes/engine/` (pure): Zod schemas for both files; validation (registry token and choice names with nearest-name suggestions, `var()` references, type checks, reference cycles in both modes, every referenced file present, app icon names, subsystem ids, font licences); `resolveTheme` with per-value provenance; `emitThemeCss`; `scopeThemeCss` (PostCSS: prefixes selectors with `[data-theme="<id>"]`, prefixes keyframe names, keeps `@media` / `@supports` / `@container` / `@layer`, refuses other at-rules); `url()` limited to bundle images and `data:image` URIs, rewritten to the asset route with the theme version
- `lib/themes/v2-bundle.ts` reads a bundle directory, validates and compiles it. `QtapThemeManifestSchema` is a union on `formatVersion`; version 1 bundles load as before. Install, load, registration and export handle both; a version 2 theme exports as installed
- `?action=tokens` returns, for a version 2 theme, its compiled CSS, choices and features instead of version 1 tokens. The theme provider injects that CSS as it is and sets `data-qt-<choice>` and the feature attributes on `<html>`; the theme picker's swatches and heading font come from the compiled theme; the Appearance preview renders a version 2 theme in a container carrying its `data-theme` (`qt-theme-preview-surface`)
- `_theme-defaults.css` also declares the semantic defaults on `[data-theme]` elements and re-declares Tailwind's `--color-*` / `--radius-*` / `--font-*` map on `[data-theme]:not(:root)`, so a theme previewed inside another starts from the defaults; no root value changes
- `postcss` moved to `dependencies` and, with its dependencies, into `outputFileTracingIncludes`: `server.ts` and the WebSocket entries reach the theme engine with packages external
- Added the fixture theme `__tests__/fixtures/themes/v2-sample/` and tests: every schema and CSS rejection, provenance, emitted and scoped CSS snapshots, a snapshot-harness run over the fixture (overridden tokens change, density applies, the rest keeps its default), and the loader round trip (validate, install, register, export) beside a version 1 bundle

#### Themes: semantic tier widened (Calliope Live, Spec A Stage 2)

- The semantic `--theme-*` tokens (colours, sidebar colours, radii, type and spacing scales, effects) are now in the registry and generated into `app/styles/_theme-defaults.css`, which replaces the hand-written `:root` / `.dark` blocks in `globals.css`. `DEFAULT_THEME_TOKENS` is read from the registry; the two had no disagreements
- Added semantic families, and re-expressed their component tokens through them: category palette (17 badge categories, colour + foreground, one tint), status palette (alert colour + foreground per status, fill and edge strengths), chat surfaces (assistant, Staff, and an accent + label per message kind), roleplay text, terminal palette, overlay scrim, and hover shade/tint. 96 tokens
- Added app-owned rules in `_base.css`: `::selection`, `color-scheme`, `scrollbar-width` / `scrollbar-color` (in `@layer base`); WebKit scrollbar styling, a `:focus-visible` ring and a page background image behind `data-qt-scrollbar`, `data-qt-focus-ring` and `data-qt-page-background`, which `applyThemeToDom` now sets on request. The default theme's `::selection` rule became the token defaults
- Added optional hooks (read with a fallback, never declared): heading weight, letter spacing, transform and colour on `.qt-heading-*`; letter spacing and transform on `.qt-button`. Added `--qt-dialog-border-width`
- Added the `density` choice: 31 tokens take a `comfortable` value under `[data-theme][data-qt-density="comfortable"]`; `compact` is the existing defaults. Nothing sets the attribute yet
- Registry: `optional` and `byChoice` on tokens, `sheet` on groups, choices in `lib/themes/registry/choices.ts`
- Added `lib/themes/color/` (CSS colour evaluation, OKLab difference), checked against Chrome on every colour in the fixtures. The theme snapshot now compares colours by rendered 8-bit RGBA, so an equal formula is not a change; `scripts/theme-snapshot.ts --add` records new names without touching recorded values
- No resolved value changed in any of the fourteen theme/mode fixtures; an in-browser comparison of 5,278 computed properties per run (headings, buttons, dialog, inputs, card, selection, root, shell) found no difference in any theme or mode
- Added the fit report, `docs/developer/features/calliope-live-spec-a-fit.md`, and `scripts/theme-fit-report.ts`, which generates its tables
- `scripts/check-css-vars.mjs` now also checks untracked, non-ignored files, so a new stylesheet is checked before it is staged
- theme-storybook 1.0.119: regenerated CSS

#### Themes: token registry generates the variable defaults (Calliope Live, Spec A Stage 1)

- Added the theme token registry in `lib/themes/registry/`: 518 tokens in 36 groups (one file per group), each with tier, type, group, label, default, optional dark default and visibility, plus lookups by name and by group
- `app/styles/qt-components/_variables.css` is now generated from it (`npm run generate:theme-variables`); `npm run lint` runs `scripts/check-theme-variables.ts`, which fails when the file and the registry disagree. Same selectors and specificity as before
- Moved the hand-written rules from `_variables.css` (root baseline, `::selection`, reduced motion) unchanged to `app/styles/qt-components/_base.css`, imported right after it
- Declared 13 hook variables the app read only through `var(--hook, fallback)` (the copy-button set, `--qt-thinking-duration` / `-origin`, `--qt-workspace-accent`, `--qt-workspace-tab-active-fg`), each defaulting to its fallback. `--qt-badge-secondary-border` is read with no fallback and was left undeclared
- Marked the 12 variables nothing in the app reads as `internal`; they stay because bundled themes still set them
- Dropped 22 dark-block declarations that repeated the shared value
- Theme snapshot: no existing value changed in any theme or mode; the fixtures gained only the 13 hooks
- theme-storybook 1.0.119: regenerated CSS

#### Themes: resolved-variable snapshot (Calliope Live, Spec A Stage 0)

- Added `scripts/theme-snapshot.ts` (`--check` to compare): compiles `app/globals.css` with Tailwind's compiler and source scan, applies each theme's injected CSS, and records what every custom property resolves to on `<html>` for the default theme and the six bundled themes in light and dark
- The resolver is `lib/themes/snapshot/` (cascade layers, specificity, order, `!important`, CSS nesting, `@supports` for the conditions Tailwind writes, `@property` initial values, recursive `var()` with fallbacks; cycles and unresolvable references are reported). Tailwind's own default theme variables and `--tw-*` internals are used for resolution but left out of the output
- Added the fourteen fixtures under `__tests__/unit/lib/themes/fixtures/snapshots/` and a test that recomputes and compares them; checked against Chrome's computed styles for all fourteen
- Confirmed that the font stacks in a bundle's `tokens.json` never take effect (recorded in the audit). earl-grey and rains render system fonts in the UI because they do not re-declare `--theme-font-*` in `styles.css`. Not fixed here

#### Themes: structural hook catalogue (Calliope Live, Spec B)

- Added the theme hook catalogue in `lib/themes/hooks/`: 156 `qt-*` classes, with the data attributes and states a theme may select on, version 1
- Added `npm run generate:theme-hooks-doc`, which writes `docs/developer/THEME_HOOKS.md`; `npm run lint` now runs `scripts/check-theme-hooks.ts`, which fails when a catalogued hook leaves the markup, a literal variant value is not listed, or the reference doc is stale, and reports (without failing) the bundled themes' selectors that target something other than a hook
- Added hooks: home cards carry `data-section`, plus `qt-homepage-row`, `qt-homepage-empty`, `qt-homepage-welcome`; rail items carry `data-nav`, popouts `qt-left-sidebar-popout`; `<main>` is `qt-app-content`, its scroll area `qt-app-scroll`; workspace pane chrome and tab panes carry `data-pane`, tabs and tab panes `data-tab-kind`
- Added Salon hooks: message rows carry `data-role` (`user`, `assistant`, `staff`, `tool`) and Staff rows and announcement chips `data-staff`; `qt-chat-tool-call` with `data-tool`, `qt-chat-pending-tools`, `qt-chat-message-streaming`, `qt-chat-avatar-carried`; the shared avatar box is `qt-avatar-image`
- Added character page hooks: `qt-character-page`, `-header`, `-avatar`, `-identity`, `-tags`, `-stats`, `-actions`, `-archived-banner`; field sections are `qt-section-card` with `data-section`, `-header` and `-body`
- Added settings hooks: rail items carry `data-group`, settings cards `data-card`
- The left rail now marks the item for the focused pane's active tab with `aria-current="page"` (it had no active indication); the themes and quick-hide buttons carry `aria-expanded`
- Changed dialogs: `BaseModal` always applies `qt-dialog-body` / `qt-dialog-footer`, which now carry no styling; the default padding and footer look moved to `qt-dialog-body-default` / `qt-dialog-footer-default`, applied when the caller passes no classes of its own. Callers that relied on the old classes now name the `-default` ones. The close button is `qt-dialog-close`
- Removed great-estate's `[data-role="assistant"]` / `[data-role="user"]` border rules, which had never matched and would have started to (theme 1.0.13)
- `SectionCard`'s `anchor` prop is now required and typed from the catalogue's list of character-page sections; the seven cards that had none (Facts, Dossier, and the five Chat Defaults cards) now have one
- theme-storybook 1.0.118: regenerated CSS and the Dialogs story for the dialog change

#### Docs: feature spec for Calliope Live

- Added pre-spec for Calliope Live, an in-app theme editor and theme overhaul for Quilltap
- Added the Phase 0a audit of the theme system (`calliope-live-audit.md`, with the variable-by-theme table as a CSV): 505 component variables, how each bundled theme uses them, the hand-written rules, assets, and structural hooks
- Added Spec A (token registry and bundle format v2) and Spec B (structural hook catalogue), and linked all three from the proposal
