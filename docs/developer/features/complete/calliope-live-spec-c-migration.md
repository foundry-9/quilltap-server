# Calliope Live — Spec C: migrate the bundled themes and retire version 1

**Status:** implemented 4.14-dev, 2026-11-14 (design decisions confirmed by the human).
Implements Phase 0c of
[calliope-live.md](../calliope-live.md). Read, before starting:

- the audit, [calliope-live-audit.md](calliope-live-audit.md), with its
  variable table [calliope-live-audit-matrix.csv](calliope-live-audit-matrix.csv);
- Spec A, [calliope-live-spec-a-token-registry.md](calliope-live-spec-a-token-registry.md),
  and its fit report, [calliope-live-spec-a-fit.md](calliope-live-spec-a-fit.md);
- Spec B, [calliope-live-spec-b-hook-catalogue.md](calliope-live-spec-b-hook-catalogue.md),
  and the generated reference [THEME_HOOKS.md](../../THEME_HOOKS.md).

**Scope:** `quilltap-server` only.

## Goal

Move the six bundled themes onto the version 2 theme document, make them use
it properly (primitives, the semantic families, app-owned features, catalogued
hooks), and then remove version 1 from the app, the CLI, the scaffolder and the
published schema. At the end of this spec:

- `themes/bundled/*` are version 2 bundles; each `styles.css` holds only the
  CSS that is particular to that theme (audit §2.2), written against hooks;
- every difference in how a theme renders is listed, with its reason, in one
  tracked file, and the human has seen it;
- nothing in the app reads a version 1 theme; an old bundle is refused with a
  clear message instead of being loaded;
- `quilltap themes validate`, `create-quilltap-theme` and
  `public/schemas/qtap-theme.schema.json` describe version 2 and share the
  engine's rules;
- `npm run lint` fails when a bundled theme targets something that is not a
  hook.

Phase 0 ships when this is done.

## Out of scope

Any editor UI; contrast validation (Phase 1); layout variants; new semantic
families beyond what the fit report already measured; Storybook's long-term
role (Phase 3); changing how any theme looks beyond the listed differences;
`packages/plugin-types` (see decision 2).

## Where things stand

- **Version 2 works end to end** for one fixture theme
  (`__tests__/fixtures/themes/v2-sample/`): `lib/themes/engine/` validates,
  resolves, emits and scopes; `lib/themes/v2-bundle.ts` reads a bundle;
  the loader, registry, theme provider, `?action=tokens` and export all branch
  on `formatVersion`.
- **All six bundled themes are still version 1**, and so is the default
  theme's injected token CSS (`themeTokensToCSS(DEFAULT_THEME_TOKENS)`).
- **Fit** (Spec A Stage 2.5): status 100%, category 95%, chat surfaces 84%,
  overlay 64%, interaction states 46%; roleplay and terminal are one-to-one
  palettes. App-owned features express 71–100% of the declarations themes
  hand-write for them.
- **Selectors** (`npx tsx scripts/check-theme-hooks.ts --verbose`, report
  only): 165 selectors off the catalogue across the six themes —
  uncatalogued `qt-*` class 105, bare element 33, uncatalogued attribute 25,
  non-`qt` class 13, class substring 9 (a selector can have more than one
  finding). That list is the Stage 2 worklist.
- **Known defect, not yet fixed:** font stacks in a version 1 `tokens.json`
  never take effect (audit §5). Four themes work around it in `styles.css`;
  earl-grey and rains do not, and render the UI in system fonts.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **earl-grey and rains get their intended fonts.** Their version 2 tokens set `--theme-font-sans` / `-serif` / `-mono` to the stacks their `tokens.json` always named, so the UI renders in the bundled Rethink Sans / Nunito Sans / Fira Code. This is the largest intended visual change in the spec. The alternative is to keep system fonts and drop the unused font files. | confirmed 2026-11-14 |
| 2 | **Old themes are refused, not converted.** A version 1 bundle (installed under `<dataDir>/themes/`, offered by a registry, or passed to the CLI) and a theme supplied by an npm plugin are refused with a message saying the theme was made for an earlier Quilltap. No converter ships. The plugin theme code path is deleted from the app; the plugin manifest schema keeps accepting a `themeConfig` capability so an old plugin still loads, and `packages/plugin-types` is not touched here. The alternative is to ship a best-effort converter in the CLI. | confirmed 2026-11-14 |
| 3 | **Values that derive to within a just-noticeable difference are derived.** When a semantic token reproduces a theme's component value exactly, the override is dropped. When it reproduces it *near* (ΔE in OKLab ≤ 0.02, the fit report's threshold), the override is also dropped and the value is listed as an intended difference. Anything further stays an override. The alternative is to keep every non-exact value as an override, which leaves roughly 115 more literal values in the themes. | confirmed 2026-11-14 |
| 4 | **The CLI validates with the engine itself.** `packages/quilltap` is plain JavaScript with no build step, so a script bundles `lib/themes/engine` and the registry data into one generated, committed file in the CLI package, and `npm run lint` fails when it is stale (the pattern of `check-storybook-css.mjs`). The alternative is a shape-only check against the published JSON Schema, which would not catch unknown tokens, bad `var()` references or unsafe CSS. | confirmed 2026-11-14 |
| 5 | Migration is in two steps per theme: a mechanical conversion that changes nothing visible (Stage 1), then a refinement that removes literal values and hand-written rules (Stage 2). The first gives a proven baseline for the second. | settled |
| 6 | The proof is three things together: the resolved-variable snapshot (`scripts/theme-snapshot.ts`), a computed-style probe run in a browser, and screenshots. No pixel comparison is attempted. | settled |
| 7 | `density` keeps the 28 sizing tokens. `--qt-button-transition`, `--qt-card-transition` and `--qt-app-header-blur` leave it (fit report, Density); themes that want the other value set those tokens. | settled |
| 8 | No glass-button accent token is added to the overlay family, and hover colours stay literal at the component tier (fit report recommendations). | settled |
| 9 | A version 2 manifest may declare `hooksVersion` (integer, optional): the catalogue version the theme's custom CSS was written against. On load, a theme whose `hooksVersion` is behind `HOOK_CATALOGUE_VERSION` gets a logged warning naming any hook from `hooksRemovedSince(version)` that its CSS uses. The six bundled themes declare the current version. | settled |
| 10 | The bundled-theme selector check becomes a lint failure. For an installed (non-bundled) theme the same findings are warnings at load, never a refusal. | settled |
| 11 | Each bundled theme's version becomes `2.0.0`. | settled |

## Constraints that apply throughout

- Follow `CLAUDE.md`: no stubs or `TODO`s; `npm run lint`; `npx tsc`; debug
  logging on new backend paths; changelog in plain voice, one entry per
  stage; after any change under `app/styles/qt-components/` or to
  `theme-tokens.css`, `npm run generate:storybook-css` and bump
  `packages/theme-storybook`; after a registry change,
  `npm run generate:theme-variables`.
- **Stages 3 and 4 are user-visible** (a refused theme, the CLI, the
  scaffolder). Update `help/themes.md` and `help/appearance-settings.md`
  (frontmatter `url` and the In-Chat Navigation section intact), in the house
  voice. Messages shown to the user are in the house voice too.
- `packages/create-quilltap-theme` changes need a version bump and then a
  **stop**: ask the human to `npm publish`. `packages/quilltap` and
  `packages/theme-storybook` are bumped but publish at release.
- Use V4test for anything that needs a running app:
  `~/iCloud/Quilltap/V4test`, dev server on port 3005. Do not start or stop a
  server on port 3000.
- Commit nothing. Stop at the end of each stage and report (see the end).
- `.claude/plans/calliope-live-css-safety.md` (untracked, private) has a
  section "For Spec C". Stage 3 and Stage 4 must do what it lists. Do not
  copy its contents into any tracked file, test name, commit message or
  changelog entry; after the work, a neutral changelog line ("bundle
  extraction and asset serving share the app's path rules") is enough.

## Stage 0 — baseline and tools

Nothing in `themes/bundled/` changes in this stage.

### 0.1 Computed-style probe

The snapshot only sees custom properties on `<html>`. Rules need a second
measure.

- Write `scripts/theme-probe/` : a page-side function (plain JavaScript,
  no dependencies) that, for a fixed list of elements, records a fixed list
  of computed properties, including `::before`, `::after`, `::selection`
  where a theme styles them; and a small driver note saying how to run it.
- **Elements** come from the hook catalogue (`lib/themes/hooks/`): every
  catalogued hook present on the page, plus `html` and `body`. Record how
  many elements matched each hook so that a missing element is not read as
  "unchanged".
- **Properties:** colour, background (colour, image, size, position,
  attachment), border (width, style, colour, radius), font (family, size,
  weight, style, letter spacing, text transform, line height), padding, gap,
  box shadow, outline, opacity, transition, animation name, filter and
  backdrop filter, scrollbar width and colour, `color-scheme`.
- **Pages:** home; a Salon chat with user, assistant, Staff, whisper and
  tool-call rows (use an existing V4test chat; create nothing new if one
  fits); a character page; Settings with one card open; an open dialog; the
  Appearance card.
- Run it for the default theme and the six bundled themes in light and dark,
  and save the results outside the tracked tree (a git-ignored directory;
  say which in the report). This is the **version 1 baseline**. It is also
  rerun for the default theme at the end of every stage: the default theme
  must never differ.

### 0.2 Screenshots

For the same pages, themes and modes, capture a screenshot at one fixed
viewport size. Keep them beside the probe results. They are for the human to
look at, not for automatic comparison.

### 0.3 Differences file

Create `docs/developer/features/calliope-live-spec-c-differences.md`. One
table per theme: what differs, where it shows, old value, new value, reason
(one of: decision 1; decision 3 near-match; dead rule removed; app-owned
feature replaces a hand-written rule; selector moved to a hook; other, with
an explanation). It starts empty. **Every snapshot or probe difference from
here on must be either fixed or entered in this file.**

### 0.4 Converter

Write `scripts/convert-theme-v1.ts`. It is a tool for this spec only and is
deleted in Stage 3. For one bundled theme it writes a version 2 bundle whose
resolved values are the same as the version 1 theme's:

- **Tokens come from what the theme resolves to, not from its source files.**
  For each registry token, compare the theme's resolved value (the Stage 0
  snapshot fixtures of Spec A, light and dark) with the registry default's.
  Where they differ, write an override: the theme's own declaration text
  where it has one (so `var()` references survive), otherwise the resolved
  literal. This is what makes the font defect harmless here: a font stack
  that never took effect is not written.
- **Private names** (`--deco-*`, `--estate-*`, `--box-*`, the earl-grey and
  rains palettes) become primitives, with every reference rewritten to
  `var(--p-<name>)`. Keep the names as they are for now.
- **Names nothing reads** — not in the registry, not a private name that
  some surviving value references — are dropped and listed in the
  converter's output (audit §1.7 expects about 100 in earl-grey and rains).
- **Rules:** every rule that is not purely custom-property declarations on
  the theme's root selector goes to custom CSS with the
  `[data-theme="<id>"]` prefix removed (the engine puts it back). Root
  blocks' non-variable declarations become a `:root { … }` rule. Absolute
  asset URLs (`/api/themes/assets/bundle:<id>/…`) become bundle-relative.
- **Manifest:** `formatVersion: 2`; fonts gain `license` (0.5); icons and
  subsystems carried over; `tokensPath` and `stylesPath` kept.
- The engine must accept the output. Where it refuses something the theme
  does (an at-rule, a `url()`), stop and report instead of loosening the
  engine.

### 0.5 Font licences

Version 2 requires a licence per font. For each font family in the six
bundles, establish the licence from the font itself (the name table in the
file) or its upstream project, not from memory. Add the licence text file to
each bundle that lacks one and name it in `licenseFile`. If a font's licence
cannot be established, or does not allow redistribution, stop and report.

### 0.6 Registry adjustments

- Decision 7: take the three non-sizing tokens out of `density`'s
  `byChoice`.
- Decision 9: add `hooksVersion` to `ThemeManifestV2Schema`, the load-time
  warning, and tests.

**Done when:** the baseline probe and screenshots exist for 7 themes × 2
modes; the converter runs on all six themes and the engine accepts all six
outputs (written to a scratch directory, not yet into `themes/bundled/`);
lint, types and the existing snapshot test pass; the default theme's probe
is unchanged.

## Stage 1 — mechanical conversion

Replace each bundle in `themes/bundled/` with its converted form, one theme
at a time, earl-grey and rains together.

- `lib/themes/snapshot/themes.ts` already takes the version 2 path for a
  version 2 bundle. Re-record the fixtures with `scripts/theme-snapshot.ts`
  and **review the diff**: the only acceptable changes are private names now
  appearing as `--p-*`, dropped unread names disappearing, and the density
  attribute's values arriving by a different route with the same result.
  Any registry token whose resolved value moved is a converter bug.
- Run the probe. A version 2 theme switches on the app's focus ring
  (`features.focusRing`) and may switch on the scrollbar and page-background
  features; a theme's own unlayered rule should still win, but check, and
  check old-school in particular, which has no focus rule of its own. Record
  anything that differs.
- The theme picker's swatches and heading font come from the compiled theme
  for version 2; confirm each card in the Appearance settings still shows
  the right colours.

**Done when:** all six bundles are version 2; the snapshot diff is explained
line by line in the report; the probe shows no difference that is not in the
differences file; the differences file is short (ideally only the focus
ring on old-school, if that).

## Stage 2 — refinement

This is the stage that makes the themes editable. Work one theme at a time;
after each, rerun the snapshot and the probe and bring the differences file
up to date. Do earl-grey and rains as a pair: they are one structure with two
palettes, and should end with the same primitive names and the same custom
CSS apart from values.

### 2.1 Primitives

Give the private palette plain names (`gold`, `navy`, `line-thin`, not
`deco-gold`), typed (`color`, `length`, `shadow`, …), with a `dark` value
where the theme's light and dark differ. Literal colours that recur across
many tokens become primitives too; a colour used once stays where it is.

### 2.2 Semantic families

Use the fit report's anchoring (`scripts/theme-fit-report.ts` already
computes it) to set each theme's semantic tokens — category palette and
tint, status palette and strengths, chat surfaces, roleplay text, terminal
block, scrim — then remove every component override the semantic tokens now
reproduce, by decision 3. Expected to remain as overrides, per the fit
report:

- category: badges whose tint differs from the theme's `character` tint;
- chat: the whisper, silent and wardrobe backgrounds where the mix share is
  the theme's own;
- overlay: the dialog backdrop and the glass buttons;
- interaction: hover colours, all of them. Set `--theme-hover-shade` only
  where it removes overrides.

Each *near* value removed is a row in the differences file with its ΔE.

### 2.3 App-owned features

Replace the rules every theme hand-writes with the tokens Spec A added
(audit §2.1; fit report "The 2.3 features"): text selection, scrollbar,
focus ring, heading treatment, button text, form control radius, card and
dialog border, colour scheme, and the page background image with its
fifteen-rule block. Delete outright: the reduced-motion reset, the root
baseline the app already applies, the badge and alert rules that repeat the
variables, the transition on `*`.

Where a token cannot express what the theme wrote (the fit report counts
these: 3 scrollbar declarations, 1 heading, 2 button, 12 page background),
keep the remainder as custom CSS on a hook.

**Headings need care.** Themes style bare `h1`–`h3`; the heading tokens are
read by `.qt-heading-*`. A heading in the app that has no such class would
lose its treatment. Find those (the probe's heading results per page show
them), and for each either give the element the class, following Spec B's
rule that it must cause no change in the default theme, or record the loss
as a difference. Headings inside rendered Markdown are content, not chrome;
if a theme styled them only by accident of the bare selector, say so in the
differences file and let the human decide.

### 2.4 Selectors

Clear the worklist from `check-theme-hooks.ts --verbose`:

- **Dead** (audit §2.3: `[data-sidebar]`, `.app-shell`, `.message-enter`,
  the old sidebar and navbar item classes, anything matching no element in
  the probe): delete the rule.
- **Live, but a stand-in** (bare `button` / `input`, `[class*="card"]`,
  `.bg-background`, the inline-style `:has()`): replace with the token from
  2.3 or with the hook that names the element.
- **Live `qt-*` class not in the catalogue:** if the theme has a real reason
  to target it, add it to the catalogue under Spec B's rules (identity is a
  class, set membership a data attribute, state ARIA first). Additions do
  not raise `HOOK_CATALOGUE_VERSION`. If the rule only repeats a variable,
  delete the rule.
- great-estate's message accent borders, removed in Spec B because the
  selector had never matched: restore them on `data-role` **only if** the
  human asks; otherwise leave them out and note it.

### 2.5 What should be left

Each `styles.css` should now be close to audit §2.2:

| Theme | Custom CSS that remains |
|---|---|
| art-deco | little or nothing |
| great-estate | the `body::after` texture overlay; light-mode sidebar colour fixes |
| madmans-box | homepage backdrop, brand and primary-button glows, diagram shadow, spinner and thinking-indicator animations |
| old-school | the grid re-layout of `.qt-foundry-card` |
| earl-grey, rains | chat toolbar button shape, composer focus glow, message fade-in; rains also skeleton shimmer and tab / participant accents |

Report each theme's before-and-after size: token overrides, primitives,
custom CSS rules.

### 2.6 Decision 1

Apply it here, as its own step and its own rows in the differences file, so
that it can be reverted alone if the human changes their mind after seeing
it.

**Done when:** `check-theme-hooks.ts` reports every bundled theme clean; the
snapshot fixtures are re-recorded and every changed value is in the
differences file; the probe agrees; new screenshots are captured beside the
baseline ones; the default theme is unchanged in snapshot and probe.

**This stop is the visual review.** Give the human the differences file and
the paired screenshots, and wait.

## Stage 3 — remove version 1

Only after the human has accepted Stage 2.

### 3.1 App

- `QtapThemeManifestSchema` is the version 2 schema. `ThemeTokensSchema`,
  `DEFAULT_THEME_TOKENS`, `themeTokensToCSS`, `mergeThemeTokens`, the
  version 1 `@font-face` and icon-override generators, and every
  `formatVersion === 1` branch go: `lib/themes/types.ts`, `utils.ts`,
  `default-tokens.ts`, `bundle-loader.ts`, `theme-registry.ts`,
  `snapshot/themes.ts`, `components/providers/theme-style-injector.tsx`,
  `components/providers/theme/`, `app/api/v1/themes/[themeId]/route.ts`,
  the Appearance card's components and hooks, `nav-user-menu-theme.tsx`.
  Find the rest by type errors, not by this list.
- **The default theme** injects nothing: `_theme-defaults.css` already
  declares its values. Give the registry what the picker needs for it
  (swatches, heading font) from the registry defaults.
- Rename as the version suffix stops meaning anything
  (`v2-bundle.ts`, `compileThemeV2`, `LoadedBundleThemeV2`, `theme.v2`) —
  but keep `formatVersion: 2` in the document.
- Remove the 12 registry tokens marked `internal` because nothing reads
  them (Spec A 1.1), now that no theme sets them. Regenerate.
- Delete `scripts/convert-theme-v1.ts`, `scripts/convert-theme-to-module.ts`
  and `scripts/convert-plugin-themes-to-bundles.sh`.

### 3.2 Refusing old themes (decision 2)

- **Installed bundles.** A version 1 bundle under `<dataDir>/themes/` is not
  registered. The loader records it as refused (id, name, version, reason);
  the Appearance card lists refused themes with the message and an
  uninstall button. Nothing is deleted automatically.
- **The active theme.** If the stored preference names a theme that is
  refused or missing, the app falls back to the default theme and says so
  once.
- **Install** (file, URL or registry) validates before anything is written
  and refuses a version 1 bundle with the same message. Where a registry
  index entry already says the format version, do not offer the theme.
- **Plugin themes.** A plugin declaring a theme is still loaded as a plugin;
  its theme is not registered, and is listed as refused. Delete the plugin
  theme registration code.
- The message names the theme, says it was made for an earlier Quilltap, and
  points to the help page.

### 3.3 Hook lint

`scripts/check-theme-hooks.ts` fails on any finding in a bundled theme
(decision 10). Loading an installed theme logs the same findings as
warnings.

**Done when:** `ggrep -rn "themeTokensToCSS\|ThemeTokensSchema\|formatVersion === 1"`
finds nothing outside the changelog and completed specs; a version 1 fixture
bundle is refused at load, at install and as a plugin theme, each with a
test; the snapshot and probe are unchanged from the end of Stage 2 for all
seven themes; lint, types and unit tests pass; help is updated.

## Stage 4 — tools and published format

### 4.1 JSON Schema

Add `scripts/generate-theme-schemas.ts` (`npm run generate:theme-schemas`;
the pattern of `scripts/generate-plugin-manifest-schema.ts`), generating:

- `public/schemas/qtap-theme.schema.json` from the manifest schema;
- `public/schemas/qtap-theme-tokens.schema.json` from the tokens document
  schema, with the registry's token names and each choice's options
  enumerated, so an editor can complete them.

`npm run lint` fails when either is stale. The bundled themes and the
scaffolder's templates name them in `$schema`.

### 4.2 CLI (decision 4)

- A script bundles the engine, the registry data, the icon names and the
  subsystem ids into one CommonJS file under `packages/quilltap/lib/`
  (generated, committed, never edited; a lint check for staleness; `postcss`
  and `zod` bundled in, so the CLI gains no dependency).
- `quilltap themes validate` uses it and prints the engine's errors, each
  with its file and, for CSS, its line. `theme-validation.js`'s hand-written
  rules are deleted.
- `install`, `export` and `update` validate with it and refuse version 1.
- Update `packages/quilltap/README.md`, the completions if a command or flag
  changed, and `docs/developer/CLI.md`.

### 4.3 Scaffolder

`create-quilltap-theme` writes a version 2 bundle: manifest with `$schema`,
a `tokens.json` holding a few primitives and semantic overrides in both
modes and `density`, a short `styles.css` written without the theme id and
against hooks, and a README that links the token and hook references. Its
own copy of default token values and its commented copy of the `--qt-*`
defaults are deleted; the generated bundle must pass `quilltap themes
validate` (test this). `--plugin` is removed. Bump the version and stop for
the human to publish.

### 4.4 Documentation

- Replace `docs/developer/THEME_PLUGIN_DEVELOPMENT.md` (and the scaffolder's
  template copy) with a version 2 authoring guide: the three tiers, the
  tokens document, choices, app-owned features, custom CSS rules, hooks and
  `hooksVersion`, fonts and licences, validation.
- Add a generated token reference, `docs/developer/THEME_TOKENS.md`, from
  the registry (name, type, group, default, dark default, visibility),
  generated and lint-checked like `THEME_HOOKS.md`.
- `CLAUDE.md`'s Themes section: remove the version 1 and plugin-format
  sentences; name the new generators and gates.
- `help/themes.md`, `help/appearance-settings.md`.
- Move this spec, Spec A, Spec B, the fit report, the audit and the
  differences file to `docs/developer/features/complete/` and fix the links
  in the proposal, which stays where it is.

### 4.5 Private notes

Do what `.claude/plans/calliope-live-css-safety.md` lists under "For Spec C",
then update that file's status section.

**Done when:** both schemas, the CLI bundle and the token reference are
generated and lint-checked; the six bundled themes and a freshly scaffolded
theme pass `quilltap themes validate`; a version 1 bundle is refused by every
CLI command that takes one; lint, types and unit tests pass.

## Report back

At the end of each stage, stop and report:

- what changed;
- the snapshot result and the probe result, for the default theme and for
  each bundled theme;
- the differences file's new rows (Stage 2: the whole file, with
  screenshots);
- anything in this spec that proved wrong or underspecified, and what was
  done instead;
- Stage 2 only: each theme's size before and after, and any selector left
  that the lint still reports, with the reason;
- Stage 4 only: the packages that were bumped and which of them wait on a
  manual `npm publish`.
