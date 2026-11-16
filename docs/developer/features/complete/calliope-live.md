# Calliope Live — a graphic theme editor

**Status:** complete (2026-11-16), but for the theme author's guide, which is
necessary and outstanding ([ROADMAP](../ROADMAP.md); outline in
[Spec K's appendix](calliope-live-spec-k-convergence.md#appendix--outline-for-the-authors-guide-not-built-here)).
Phases 0 to 3 were carried out by Specs A to K below. This document began as
the record of a planning conversation (2026-11-14); "Proposed shape" and
"Next steps" are kept as written then, with notes where the work decided
otherwise, and every open question now has its answer.

**Follow-on documents:**

- [calliope-live-audit.md](calliope-live-audit.md) — the Phase 0a audit
  (done), with [calliope-live-audit-matrix.csv](calliope-live-audit-matrix.csv).
  Where its measurements differ from the survey figures below, the audit is
  right.
- [calliope-live-spec-a-token-registry.md](calliope-live-spec-a-token-registry.md)
  — Phase 0b: token registry and bundle format v2 (implemented 4.14-dev).
  Its fit report is
  [calliope-live-spec-a-fit.md](calliope-live-spec-a-fit.md).
- [calliope-live-spec-b-hook-catalogue.md](calliope-live-spec-b-hook-catalogue.md)
  — Phase 0b′: structural hook catalogue (implemented 4.14-dev; reference
  [THEME_HOOKS.md](../../THEME_HOOKS.md), generated from `lib/themes/hooks/`).
- [calliope-live-spec-c-migration.md](calliope-live-spec-c-migration.md)
  — Phase 0c: migrate the six bundled themes to version 2 and retire
  version 1 (implemented 4.14-dev; authoring guide
  [THEME_DEVELOPMENT.md](../../THEME_DEVELOPMENT.md), token reference
  [THEME_TOKENS.md](../../THEME_TOKENS.md)). Its rendered differences are in
  [calliope-live-spec-c-differences.md](calliope-live-spec-c-differences.md).
- [calliope-live-spec-d-live-preview.md](calliope-live-spec-d-live-preview.md)
  — rest of Phase 1 and first slice of Phase 2: contrast checks, drafts and
  a live preview of colour tokens (implemented 4.14-dev; user docs
  [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-e-typed-controls.md](calliope-live-spec-e-typed-controls.md)
  — second slice of Phase 2: a control for every token type, primitives,
  density, search and undo (implemented 4.14-dev; user docs
  [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-f-assets-and-manifest.md](calliope-live-spec-f-assets-and-manifest.md)
  — third slice of Phase 2: font and image upload, icon overrides,
  subsystems and the rest of the manifest (implemented 4.14-dev; user docs
  [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-g-custom-css.md](calliope-live-spec-g-custom-css.md)
  — fourth slice of Phase 2: the custom CSS section, JSON and CSS
  highlighting, and opening a theme file as a draft (implemented 4.14-dev;
  user docs [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-h-specimens-and-inspect.md](calliope-live-spec-h-specimens-and-inspect.md)
  — last slice of Phase 2: the specimen gallery and inspect mode
  (implemented 4.14-dev; user docs
  [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-i-loose-ends.md](calliope-live-spec-i-loose-ends.md)
  — clean-up after Specs E to H: brace indentation in the code editor,
  editor layout by pane width, the theme probe on the gallery, and 45 new
  catalogue hooks (implemented 4.14-dev; user docs
  [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-j-calliope.md](calliope-live-spec-j-calliope.md)
  — the LLM-assistance step of Phase 2: Calliope, a Brahma-like assistant
  in the theme editor who proposes changes the author tries, keeps or
  discards (implemented 4.14-dev; user docs
  [help/theme-editor.md](../../../../help/theme-editor.md)).
- [calliope-live-spec-k-convergence.md](calliope-live-spec-k-convergence.md)
  — Phase 3 (done): `@quilltap/theme-storybook` and `create-quilltap-theme`
  retired, `quilltap themes create` writing the Atelier's blank bundle,
  Calliope asking for a screenshot when she cannot tell what the author
  sees, and this proposal closed; the author's guide is recorded as
  necessary and left for later.

**Scope:** `quilltap-server` (v4) only. Porting to v5 is a separate concern and
does not shape decisions here.

## The goal

A theme editor inside Quilltap that:

- shows every major design element of a theme — colours, fonts, borders, radii,
  shadows, animation, backgrounds, textures, icons;
- edits them live, against the running UI;
- starts from scratch, from the default theme, or from any theme already
  installed (bundled or user-installed);
- imports and exports complete, installable `.qtap-theme` bundles.

A second, expected outcome: building the editor will expose where the theme
system should be more hierarchical, and the theme system will change as a
result. That is part of the project, not a side effect.

## Decisions made

| Question | Decision | Why |
|---|---|---|
| In the main app, or a separate npm-installable utility? | **In the main app**, as a Calliope feature. | The only faithful preview is the real UI with real content. Electron and Docker users have no Node toolchain. The registry, bundle loader, installed-theme storage and font/asset routes already exist in-app. |
| Use Storybook as the basis? | **No.** | Storybook is a developer tool needing a dev server; its controls are built for component props, not for authoring a theme document. Its stories are hand-written markup covering a fraction of the UI. |
| What edits a theme's JSON and CSS as text? | **Lexical, with its own code highlighting switched on for JSON and CSS** (2026-11-14). Revisit if theme editing becomes common. | Needed one package after all: `@lexical/code-prism` (0.53, MIT), where Lexical 0.53 keeps the Prism highlighter; `@lexical/code` alone has none. Built in Spec G as `components/code-editor/`, used by the theme editor's CSS section and by Document Mode for `.json` and `.css`. A dedicated code editor would add completion and lint markers, which can wait. |
| Where does a theme being worked on live? | **In Quilltap General, under `Themes/<id>/`** (2026-11-14). Its images are kept as the author supplied them; an installed theme carries WebP. | A draft is the user's work, so it belongs with the user's files: visible in the Scriptorium, editable in Document Mode, reachable by characters, backed up with the store. |
| What to keep from Storybook? | The **specimen-sheet idea**. | Build specimens as in-app components; Storybook may consume the same components so there is one copy of the markup. (In the event Storybook consumed nothing: it was retired in Spec K, and the in-app gallery is the one copy.) |
| What becomes of `@quilltap/theme-storybook` and `create-quilltap-theme`? | **Both are retired** (2026-11-16), in [Spec K](calliope-live-spec-k-convergence.md). | The specimen gallery draws every catalogued hook from the app's own components, and the Atelier starts, installs and exports a theme. Neither package has anything left to do that the app does not do better. |
| How does the assistant see its work? | **It does not, by itself** (2026-11-16). The author screenshots what looks wrong and attaches it to Calliope. | A screenshot the author chose shows exactly the fault they mean, costs nothing to build, and sends a model only what the author decided to send. |
| Is the theme author's guide part of this feature's release? | **No; it is necessary and comes after** (2026-11-16). | The Atelier's help page already documents every section. The start-to-finish guide is worth doing properly, as its own work, once the feature has been used. |
| Where does the logic live? | A **framework-free engine** in `lib/themes/`, with the editor UI as a thin layer. | The `quilltap themes` CLI, the bundle loader and the editor then share one source of truth for model, validation, CSS emission and packing. |

## What the theme system looked like before Calliope Live

Measured by a quick survey, not a full read, before Spec A. Spec C Stage 3
retired the version 1 format described here; the names below are historical. Counts are approximate (line and
pattern counts via `grep`/`wc`).

**Declared tokens** — the version 1 token schema in `lib/themes/types.ts`:

- `colors.light` / `colors.dark`: 27 colours each (19 required, 8 optional).
- `typography`: three font stacks, sizes, line heights, weights, letter spacing.
- `spacing`: five radii and a spacing scale.
- `effects`: four shadows, three transition durations, one easing, focus ring.

Each bundled theme's `tokens.json` is about 114 lines.

**Undeclared surface** — `app/styles/qt-components/_variables.css` defines
roughly 618 `--qt-*` custom properties, largely flat and grouped by component
(badges ~130, chat ~75, terminal ~36, buttons ~26, alerts ~24, …). None of
these are in the token schema.

**What themes actually ship** — each bundled theme's `styles.css`:

| Theme | Lines | Custom-property declarations | Rule blocks | `@keyframes` |
|---|---|---|---|---|
| art-deco | 771 | ~326 | ~34 | 0 |
| earl-grey | 1,406 | ~701 | ~59 | 1 |
| great-estate | 831 | ~325 | ~43 | 0 |
| madmans-box | 740 | ~260 | ~45 | 2 |
| old-school | 556 | ~257 | ~15 | 0 |
| rains | 1,412 | ~701 | ~64 | 2 |

**The key finding:** most of a theme's `styles.css` is custom-property
assignments under `[data-theme="<id>"]` (and `.light` / `.dark`), not free-form
rules. A theme is, in practice, a few hundred variable values plus 15–65 real
CSS rules (scrollbars, `::selection`, textured backgrounds, heading treatments,
`body:has(...)` story-background handling). The variable part is already
structured data; the schema simply does not know about it. That is what makes a
graphic editor tractable, and it is where the hierarchy work lies.

**Existing pieces to build on**

- `lib/themes/types.ts` — the version 1 token schema, `QtapThemeManifestSchema`
  (already has `extendsTheme` and a `subsystems` record), `FontDefinitionSchema`.
- `lib/themes/theme-registry.ts`, `bundle-loader.ts`, `default-tokens.ts`,
  `utils.ts`.
- `components/providers/theme-style-injector.tsx` and
  `components/providers/theme/theme-utils.ts` — how a theme reaches the page.
- `components/settings/appearance/` — the Appearance card, including
  `ThemePreviewPanel.tsx`.
- `app/api/themes/` (assets, fonts) and `app/api/v1/themes`.
- `app/styles/theme-tokens.css` — the Tailwind `@theme inline` map
  (`--color-*` → `--theme-*`).
- `packages/quilltap` — `quilltap themes validate | export | create | install`.
- `packages/theme-storybook` — 20 story files; its `qt-components.css` is
  generated from the app (`npm run generate:storybook-css`).
- `packages/create-quilltap-theme` — the scaffolder.
- `themes/bundled/*` — six reference themes.

## The ambition: anything CSS can do

The target is not "this background, this font, this colour". A theme should be
able to do anything achievable in CSS. Examples of the intended reach:

- the three home-page cards become a triptych of mirrors or screens, with 3D
  transforms so the outer panels appear angled;
- a complete tabletop-RPG look: a GM's screen, character sheets that read as
  scrawled notes on paper;
- the left sidebar relocated into a menu bar.

Basic properties are edited graphically. Advanced work is custom CSS the author
writes — with an LLM available to help write it.

This changes what the theme spec is. It has **three layers of power**, and the
refactor must design all three:

1. **Tokens** — values (colour, type, radius, shadow, motion, images). Edited
   graphically. Covers most themes most of the time.
2. **Custom CSS over a stable hook contract** — arbitrary rules, scoped to the
   theme. This is a first-class layer, not an escape hatch. Its power is
   bounded by the markup, not by CSS: a rule can only reach what has a stable
   name. So the app must publish a **hook catalogue** — the `qt-*` classes and
   data attributes on every structural element (home cards and their
   container, sidebar and its items, navbar, chat bubbles, character sheet
   regions, dialogs…) — and treat it as an API: documented, versioned, not
   renamed casually. Bundled themes today reach for selectors such as
   `[class*="Card"]`, bare `button` and `h3`, which is the symptom of hooks
   that are missing.
3. **Declared layout variants** — for what CSS alone cannot do well. CSS can
   move and reshape, but it cannot add elements (beyond `::before` /
   `::after`), change behaviour, or change the DOM and focus order. "Sidebar
   becomes a menu bar" is the test case: CSS can relocate the strip, but
   dropdown behaviour, keyboard handling and ARIA roles belong to the app. A
   theme should be able to *declare* such a variant (for example
   `navigation: sidebar | menubar`) and the app implements it accessibly.
   Variants are added as real cases demand them, not speculatively.

Themes stay declarative: tokens, CSS and assets, never script. That is what
keeps an installed theme safe.

## Proposed shape

### 1. A tiered token model

Three tiers, each defaulting to the one above:

1. **Primitive** — the theme's raw palette, type families, scales.
2. **Semantic** — the version 1 token schema's roles (background, primary,
   border, radius, shadow, transition…).
3. **Component** — today's `--qt-*` variables (badge, chat, terminal, button…),
   each with a declared default expressed in terms of tier 2.

A theme stores only what it overrides. The editor shows the inherited value and
where it comes from, and lets the author override at any tier. Changing a
semantic colour repaints every component that has not overridden it.

The component tier needs a **registry of tokens**: name, type (colour, length,
font, shadow, duration, easing, image…), group, default expression, description.
It must be the single source of truth from which `_variables.css` defaults, the
schema, and the editor's controls are all derived — not a second hand-kept list
beside the CSS. How that derivation runs (generate the CSS from the registry, or
parse the registry out of annotated CSS) is an open question below.

### 2. The engine (`lib/themes/`, no React)

- the theme document model and its Zod schema;
- resolve: document + base theme → full variable set for light and dark;
- emit: variable set → CSS;
- validate, including contrast (4.5:1 text, 3:1 focus ring, both modes — the
  existing WCAG 2.2 AA convention);
- pack / unpack `.qtap-theme` bundles (manifest, tokens, styles, fonts,
  textures, icons).

### 3. The editor UI (Calliope)

- **Live preview:** apply the working document as overrides on the root element
  through the existing style-injection path, so the whole running app repaints.
- **Specimen gallery:** one view showing every component in every state, for
  the things the live app does not happen to be showing.
- **Controls by type:** colour pickers with contrast readout, font pickers with
  upload, length/radius/shadow/duration editors, light/dark side by side.
- **Start from:** blank, default, or any installed theme (copy, or `extendsTheme`).
- **Custom CSS editor:** a first-class part of the editor — syntax-aware,
  applied live, automatically scoped to the theme, round-tripped verbatim.
- **Inspect mode:** point at any element of the running app and see its hooks
  and the tokens that style it, so an author (or an LLM) knows what to target.
- **LLM assistance:** describe the look wanted; the model proposes tokens and
  custom CSS against the working draft. It is given the token registry and the
  hook catalogue as context, and its output is linted against them (unknown
  hooks, undefined variables, contrast) before it is applied. The author
  reviews and keeps or discards each proposal.
- **Import / export:** `.qtap-theme` in and out; "install this" in one step.
- Working drafts persist somewhere durable so an editing session survives a
  reload.

### 4. Storybook

Decided (Spec K, 2026-11-16): **retired**. The specimen gallery
(`components/theme-specimens/`, one specimen per catalogued hook, held by a
coverage test) and the Atelier's Icons section show everything the 20
stories did that the app still has; the rest was dead CSS. The compiled
component CSS is no longer a file: `scripts/lib/qt-components-css.mjs`
compiles it in memory for Calliope's styled-by table. `create-quilltap-theme`
went with it; `quilltap themes create` writes the Atelier's blank bundle
(`lib/themes/blank-bundle.ts`). Both packages are deprecated on npm.

## Next steps

### Phase 0 — refactor the theme spec

The theme system is unified first, before any editor work, so the editor is
built on a spec designed to be edited. **Backward compatibility is not a
constraint:** as far as is known, the only themes in existence are the six
bundled ones, all written in-house. The format may change freely, and the six
are migrated as part of this phase.

**0a. Audit** (decides the rest)

1. For each of the six bundled `styles.css` files, extract every custom
   property set and every non-variable rule.
2. Produce a matrix: variable × theme. Classify each variable as
   *overridden by most themes* (a real token), *overridden by one or two*
   (still a token, lower priority), or *never overridden* (candidate to be
   derived, or dropped from the editable surface).
3. Look for variables that every theme sets to the same expression of another
   variable — those are missing inheritance, and they are the hierarchy.
4. Catalogue the non-variable rules by kind (scrollbar, selection, texture
   background, typography treatment, story-background handling, focus, …).
   Any kind that several themes hand-write the same way is a missing token or
   a missing toggle.
5. Note every asset type in use: fonts, textures, icons, preview images.
6. Inventory the structural hooks: which elements carry a stable `qt-*` class
   or data attribute, which do not, and which selectors in the bundled themes
   are brittle stand-ins for a missing hook. Use the three example themes
   under "The ambition" as test cases — list what each would need to target.
7. Write the findings up beside this document.

**0b. Token model**

Design the registry and the three tiers from the audit. Decide the source of
truth and the derivation direction. Define the new bundle format.

**0b′. Hook catalogue**

Define the structural hook contract from the audit: naming rules, the
catalogue itself, how it is documented and versioned, and a lint that keeps
the app's markup and the catalogue in step. Add the hooks that are missing.

**0c. Migration**

Move all six bundled themes onto the new spec. The test is visual: each theme
must render as it did before, in light and dark. Update the loader, the
registry, `quilltap themes`, `create-quilltap-theme` and the published JSON
Schema (`public/schemas/qtap-theme.schema.json`) to the new format.

Phase 0 ships on its own. It is worth having even if the editor slipped.

### Phase 1 — engine

Model, resolve, emit, validate, pack — with tests, and with the CLI's
`validate` / `export` moved onto it. Much of this falls out of Phase 0; what
remains is making it a clean, UI-independent module.

### Phase 2 — editor

Live preview first (smallest useful thing: edit semantic colours and see the
app repaint), then typed controls, then the specimen gallery, then
import/export and drafts.

### Phase 3 — convergence

Settle Storybook's role; write the help documentation for theme authors.

**Done** (Spec K), but for the author's guide: Storybook and the scaffolder
are retired and the existing help pages are true without them. The guide
itself is necessary and was left out of this release by decision; it is on
the ROADMAP with an outline.

## Open questions

Each is answered; the spec that settled it is named.

- **Old-format bundles.** `formatVersion` went to 2, and a version 1 bundle
  or a plugin theme is refused, never registered (`lib/themes/refused.ts`):
  listed on the Appearance card with an uninstall button, refused at
  install and by the CLI, and the active theme falls back to the default
  with one notice. — [Spec A](calliope-live-spec-a-token-registry.md),
  [Spec C](calliope-live-spec-c-migration.md).
- **Source of truth for component tokens.** The registry
  (`lib/themes/registry/`) generates `_theme-defaults.css` and
  `_variables.css`; lint fails while they disagree. The lint gates hold;
  `check-storybook-css.mjs` itself went in Spec K. —
  [Spec A](calliope-live-spec-a-token-registry.md).
- **Where the editor lives.** Its own workspace tab, `theme-editor`, with
  the route `/calliope`, opened from **Design a theme** on the Appearance
  card, so it sits beside any other tab. —
  [Spec D](calliope-live-spec-d-live-preview.md).
- **Draft storage.** A folder `Themes/<id>/` in Quilltap General (see
  "Decisions made"), with `lib/themes/drafts/` as its one door. —
  [Spec D](calliope-live-spec-d-live-preview.md),
  [Spec F](calliope-live-spec-f-assets-and-manifest.md).
- **`extendsTheme`.** Dropped from version 2; every theme inherits from the
  registry defaults, and "start from an installed theme" is a copy. —
  [Spec A](calliope-live-spec-a-token-registry.md) decision 5.
- **Fonts and licensing.** The licence is asked for, not judged: every font
  needs a licence choice (read from the font's own tables where it has
  one) and may carry a licence file; a `proprietary` font installs and
  exports with a standing note that the author answers for it. —
  [Spec F](calliope-live-spec-f-assets-and-manifest.md).
- **Animation.** Durations and easings are token types; keyframes stay in
  custom CSS, where the engine prefixes their names with the theme id. —
  [Spec A](calliope-live-spec-a-token-registry.md),
  [Spec G](calliope-live-spec-g-custom-css.md).
- **Scale of the editable surface.** Three levels with one search:
  Essentials (139 semantic tokens) by default, Components (239), and
  Advanced (288) behind a disclosure; internal tokens are never shown. —
  [Spec E](calliope-live-spec-e-typed-controls.md).
- **Hook stability.** The catalogue carries `HOOK_CATALOGUE_VERSION`, a
  theme declares `hooksVersion`, and a theme behind the app is warned at
  load about any removed hook its CSS still uses. —
  [Spec B](calliope-live-spec-b-hook-catalogue.md),
  [Spec C](calliope-live-spec-c-migration.md).
- **CSS safety.** Custom CSS may not `@import`, declare `@font-face` or
  reach a remote `url()`; every descendant rule is scoped to the theme with
  `@scope`; selecting anything outside the hook catalogue is a warning with
  file and line. Nothing stops a theme from covering UI it can select;
  registry themes are signed (Ed25519), and that is the line drawn. —
  [Spec G](calliope-live-spec-g-custom-css.md),
  [Spec B](calliope-live-spec-b-hook-catalogue.md).
- **Accessibility under heavy restyling.** The engine measures every
  contrast pair the app checks (4.5:1 text, 3:1 non-text, light and dark),
  the editor shows each as it changes, a failure is a warning, and lint
  holds the bundled themes to every pair. Visual reordering against focus
  order is not checked; it is left to the author. —
  [Spec D](calliope-live-spec-d-live-preview.md).
- **How the LLM sees its work.** It does not, by itself: no screenshot
  loop, inspect tool or headless render. The author screenshots what looks
  wrong and attaches it; Calliope asks for one when the draft does not show
  her what the author means, and only when her model reads images. —
  [Spec K](calliope-live-spec-k-convergence.md) decision 2.
- **First layout variants.** None shipped. Left open, on the
  [ROADMAP](../ROADMAP.md).

## Standing rules that will bite

From `CLAUDE.md`; listed here because this feature touches all of them.

- User-visible changes are documented in `help/*.md` (with `url` frontmatter
  and an In-Chat Navigation section) and recorded in `docs/CHANGELOG.md`.
- A settings card is registered in `lib/settings/registry.ts` and nowhere else.
- Modals use `BaseModal`; every control has an accessible name.
- New Tailwind classes go into a `qt-*` utility; variant forms are written out
  by hand in `_utilities.css`.
- After any change under `app/styles/qt-components/` or to
  `theme-tokens.css`, run `npm run generate:theme-styled-by` (until Spec K:
  `generate:storybook-css` and a `packages/theme-storybook` bump).
- `packages/` changes: bump the version, then stop for a manual `npm publish`
  (except `packages/quilltap`).
- New API routes go under `/api/v1/` with action dispatch; untrusted bundle
  paths resolve through `resolveInside`, uploaded bytes are served by
  `serveStoredBytes`.
- User-facing copy is in the house voice; this document and the changelog are
  not.
