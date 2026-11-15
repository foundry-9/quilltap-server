# Calliope Live — Spec D: contrast checks, drafts and the first live preview

**Status:** implemented 4.14-dev, 2026-11-14 (design decisions confirmed by the human). User docs [help/theme-editor.md](../../../../help/theme-editor.md); authoring guide [THEME_DEVELOPMENT.md, Drafts and the Atelier](../../THEME_DEVELOPMENT.md#drafts-and-the-atelier); routes [API.md, Theme Drafts](../../API.md#theme-drafts).
Implements the rest of Phase 1 and the first slice of Phase 2 of
[calliope-live.md](../calliope-live.md). Read, before starting:

- Spec A, [calliope-live-spec-a-token-registry.md](calliope-live-spec-a-token-registry.md)
  (the registry and the version 2 theme document);
- Spec C, [calliope-live-spec-c-migration.md](calliope-live-spec-c-migration.md)
  (what the engine and loader look like now);
- [THEME_DEVELOPMENT.md](../../THEME_DEVELOPMENT.md) and the generated
  [THEME_TOKENS.md](../../THEME_TOKENS.md).

**Scope:** `quilltap-server` only.

## Goal

The smallest editor that is worth using: start a theme, change its colours,
watch the running app repaint, come back to it after a reload, and install it.
At the end of this spec:

- the engine can say whether a theme's colours meet the app's contrast rule
  (4.5:1 for text, 3:1 for the focus ring and other non-text parts, in light
  and dark);
- a **draft** is a version 2 theme being worked on, kept as files in Quilltap General, started
  blank or as a copy of any installed theme;
- an editor tab lists drafts, edits a draft's standard colour tokens (light
  and dark), and shows the contrast of each pair as it changes;
- every edit repaints the whole app in that browser tab at once, without a
  server round trip, and changes nothing for the stored theme preference;
- a draft installs in one step through the existing install path.

## Out of scope

Controls for anything but colour (fonts, lengths, radii, shadows, density,
type scale — Spec E); editing primitives (Spec E); the specimen gallery and
inspect mode (Spec F); the custom CSS editor, importing a `.qtap-theme` file
straight into a draft, and font or image upload (Spec G); syntax highlighting
for JSON and CSS in Document Mode (decided for Spec G: Lexical's own code
highlighting, not a new editor dependency — until then a draft's files open
there as plain text); LLM assistance;
layout variants; Storybook's role; changing how any bundled theme looks.

## Where things stand

- `lib/themes/engine/` validates, resolves, emits, scopes and compiles a
  version 2 theme, with no React and no file access. `resolveTheme` already
  returns each token's value and where it came from (`default`, `choice`,
  `theme`, …), which is what an editor shows.
- `emitThemeCss` and `resolveTheme` are pure and small, but `compile.ts`
  imports `substituteVars` from `lib/themes/snapshot/cascade.ts`, which
  imports PostCSS. Nothing in the engine is imported by client code today.
- The client applies a theme in two places:
  `components/providers/theme/ThemeProvider.tsx` holds the compiled CSS,
  features and choices from `GET /api/v1/themes/[id]?action=tokens`, and
  `applyThemeToDom` writes `data-theme`, the mode class and the `data-qt-*`
  attributes on `<html>`; `ThemeStyleInjector` writes the CSS into one
  `<style>` element.
- Assets and fonts are served by `app/api/themes/assets/` and
  `app/api/themes/fonts/`, from the registry's served set, with
  `Cache-Control: immutable` and a `?v=<version>` query.
- Nothing checks contrast. `lib/themes/color/` parses `rgb()`, `hsl()`, hex,
  named colours and `color-mix(in srgb, …)` to RGBA and has OKLab distance,
  but no luminance or contrast ratio.
- The registry has 177 semantic tokens; the `colors` group (27 tokens) is
  where a theme's look starts.
- **Quilltap General already holds this kind of thing.** `Brahma/`,
  `Wardrobe/`, `Inventory/` and `Atlas/` are folders in it, each behind one
  module; `lib/brahma-console/attachments.ts` is the closest pattern (bytes
  in through `storeMountFile`, the store found with `getGeneralMountPointId`).
- **Every image written to a store is re-encoded.** `linkBlobContent` passes
  each blob through `normalizeLinkBlobImage`
  (`lib/mount-index/normalize-blob-image.ts`), which turns a PNG or a large
  lossless WebP into WebP at quality 85 and renames the file. The one way
  out today is `normalizeImages: false`, documented as for byte-fidelity
  restores only.
- The theme engine reads a bundle from a directory
  (`loadThemeFromDir`, `listBundleFiles` in `lib/themes/theme-bundle.ts`).
- The bundled themes hold 16 WebP and 1 PNG raster images, 88 SVG and 51
  WOFF2 files.
- `extendsTheme` is not part of version 2, so "start from an existing theme"
  can only mean a copy.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **The editor is a workspace tab.** A new tab kind, `theme-editor`, with its own route `/calliope` for the non-workspace shell, opened from a "Design a theme" control on the Appearance card. In the workspace it sits beside a Salon chat or any other tab, which is what makes the preview live. The alternative is a section inside the Appearance card, where the only thing to look at while editing is the Settings page. | confirmed 2026-11-14 |
| 2 | **A draft is a folder in Quilltap General.** `Themes/<id>/` holds the draft as an unpacked version 2 bundle: `theme.json`, `tokens.json`, custom CSS, fonts, images. It is the user's work, so it lives with the user's files: it shows in the Scriptorium, opens in Document Mode, can be read and written by a character's `doc_*` tools, and is backed up with the store. The theme registry, the picker, the stored preference, export and update checks never see it. A draft may be invalid while it is being worked on; an installed theme never is. | decided by the human 2026-11-14 |
| 3 | **"Start from" is blank or a copy.** Blank is an empty tokens document (the default theme). A copy takes the whole bundle directory of any registered theme — tokens, custom CSS, fonts with their `license` and `licenseFile` entries, icons, images — under a new id and name, version `0.1.0`. The copy carries no link back to its source. | confirmed 2026-11-14 |
| 4 | **The preview's token CSS is built in the browser.** On each edit the client runs the engine's own `resolveTheme` and `emitThemeCss` and swaps the result in; the server compiles the parts the editor cannot change yet (font faces, icon rules, scoped custom CSS) once, when the draft opens, and validates on each save. A colour drag therefore repaints with no request. The alternative is a server compile per edit, which is simpler but lags behind a drag and needs a cancel-and-debounce layer. | confirmed 2026-11-14 |
| 5 | **Contrast findings are warnings.** A theme that fails a contrast pair still loads, saves and installs; the editor shows the finding and `quilltap themes validate` prints it. For the six bundled themes the findings go to the human at the Stage 0 stop, and after that `npm run lint` fails on a bundled theme's finding unless it is on a tracked exception list with a reason. No bundled theme's colours change in this spec. The alternative is to make a failed pair an install error. | confirmed 2026-11-14 |
| 6 | The contrast pairs are data in the registry (`lib/themes/registry/contrast.ts`), not a list in the engine: each names a foreground token, a background token and a kind (`text` 4.5:1, `non-text` 3:1). | settled |
| 7 | This spec's editable surface is every registry token with `type: 'color'`, `tier: 'semantic'` and `visibility: 'standard'`, grouped by registry group, with a light and a dark value each. | settled |
| 8 | A preview belongs to one browser tab. It is not stored, does not change the active theme preference, and ends when the editor closes or the page reloads without it. | settled |
| 9 | A draft's id is unique among drafts and among registered themes, so one id never names two things in an asset URL or a `data-theme` attribute. | settled |
| 10 | "Install" is in this spec, not Spec G: a draft nobody can wear is not useful. It packs the draft and runs the existing install routine, so an installed draft passes exactly the checks any bundle passes. | settled |
| 11 | **A draft keeps its original images; an installed theme carries WebP.** Files under `Themes/` in Quilltap General are stored byte for byte, so the author never loses an original. When a draft is installed (and so whenever it is packed), every raster image that is not already WebP is converted to WebP in the packed copy, and each reference to it — in the manifest, in token values and in custom CSS — is rewritten to the new name. SVG is left alone. The draft itself is not changed by installing. | decided by the human 2026-11-14 |

## Constraints that apply throughout

- Commit nothing. Stop and report at the end of each stage.
- The dev server on port 3000 is the human's; do not kill it. Try things in
  the V4test instance on port 3005.
- `lib/themes/engine/` stays free of React and file access. Whatever the
  browser imports from it must not pull PostCSS, `fs` or the logger into the
  client bundle; a test holds that (see 0.1).
- Draft files are read and written through the document core
  (`lib/documents/core/`) and `storeMountFile`, never by raw `fs` and never
  by a repository call beside them. Draft ids match the manifest's `id` rule
  before they are used in a path.
- API routes follow the `/api/v1/` action-dispatch pattern, with strict Zod
  bodies. Query keys come from `lib/query/keys.ts`. The form holds its state
  in `useDraft`.
- UI: `qt-*` classes only, `BaseModal` for any dialog, an accessible name on
  every control, WCAG 2.2 AA for the editor itself.
- User-facing copy is in the house voice; `docs/CHANGELOG.md` is plain.
- No stubs or `TODO` code. Debug logging on every new backend path.
- `packages/` changes: the CLI's generated engine bundle must be rebuilt
  (`npm run build:cli-theme-engine`) after any engine change; it publishes at
  release, so no manual publish stop.

## Stage 0 — engine

### 0.1 A browser-safe entry

- Move `substituteVars` (and what it needs) out of
  `lib/themes/snapshot/cascade.ts` into a module that does not import
  PostCSS; `cascade.ts` and `compile.ts` import it from there.
- Take the feature derivation out of `compileTheme` into its own exported
  function (resolved values and tokens in, `CompiledThemeFeatures` out), so
  the browser and the server derive features with the same code.
- Add `lib/themes/engine/client.ts`, exporting only what the editor needs:
  the document types and schemas, `resolveTheme`, `emitThemeCss`,
  `choicesInForce`, the feature derivation, the literal resolver the preview
  swatches use, and the contrast functions of 0.2.
- A test walks the import graph from `client.ts` and fails if it reaches
  `postcss`, `node:*`, `fs` or `lib/logger`.

### 0.2 Contrast

- `lib/themes/color/`: add WCAG relative luminance and contrast ratio. A
  foreground with alpha is composited over its background first; a
  background with alpha is composited over the page background of that mode.
- `lib/themes/registry/contrast.ts`: the pairs (decision 6). Start from the
  semantic `colors` group — each `*-foreground` on its surface, muted text on
  page, card and muted surfaces, the focus ring on page and card — then
  status, category and chat-surface foregrounds on their own backgrounds,
  and link colour on page and card. A test fails if a pair names a token the
  registry does not have.
- `lib/themes/engine/contrast.ts`: `checkContrast(resolved, registry)` gives,
  per pair and mode, the ratio, the threshold and pass or fail. A value that
  cannot be resolved to one colour (a gradient, an unsupported colour
  function) is reported as *not checked*, never as a pass.
- `validateThemeDocument` returns the findings as warnings.
- `quilltap themes validate` prints them (rebuild the CLI engine bundle).
- `scripts/check-theme-contrast.ts` runs it over the default theme and the
  six bundled themes and prints a table.

**Stop.** Report the table. The human decides which failures are exceptions
and which are defects to fix outside this spec; then add the exception file
(`themes/bundled/contrast-exceptions.json`: theme, pair, mode, reason) and
make the script a lint gate (decision 5).

## Stage 1 — drafts on the server

### 1.1 Storage

`lib/themes/drafts/`: the only module that knows a draft is a folder under
`Themes/` in Quilltap General. It is a caller of the document core and
`storeMountFile`, the way `lib/brahma-console/attachments.ts` is.

- `listDrafts`, `readDraft`, `createDraft({ name, from? })`,
  `writeDraftTokens`, `writeDraftManifestFields` (name and description
  only), `deleteDraft`, `installDraft`.
- **A draft is its folder and nothing else.** There is no side file and no
  database row. A folder under `Themes/` with a `theme.json` is a draft; its
  dates come from the store. Where it was copied from is not recorded
  (decision 3 says the copy carries no link back).
- **Anything may edit a draft.** Document Mode, a character's `doc_*` call
  and the editor all write the same files, so `readDraft` never assumes the
  files are valid: a `theme.json` or `tokens.json` that does not parse is
  reported as an issue on the draft, and the draft still lists and opens
  (with the editor's controls disabled and the reason shown).
- **Revision.** `writeDraftTokens` takes the revision the caller read and
  writes nothing on a mismatch. Use what the store already keeps for
  `tokens.json` (its content hash) as the revision; do not add a counter.
- **Byte-for-byte images (decision 11).** Give `normalizeLinkBlobImage` one
  more sanctioned exemption beside the restore flag: a path under `Themes/`
  in Quilltap General is never re-encoded, whoever writes it — the editor, a
  copy, an upload in the Scriptorium, a move into the folder. The rule
  belongs in the chokepoint, keyed on store and path, not in each caller as
  a `normalizeImages: false`. Update that module's header comment and the
  blob-normalisation note in `CLAUDE.md` if one exists.
- **Fonts.** Confirm a `.woff2` (and `.ttf`, `.otf`) goes into the store and
  comes back unchanged, is not sent for text extraction or embedding, and is
  served with the right type. If the store cannot hold one cleanly, stop
  and report.
- **Not for the Commonplace Book or the scanner.** Draft files should not be
  chunked and embedded as knowledge. Find the existing way a folder opts out
  (the per-document policy, or how `Brahma/` and `Wardrobe/` are treated)
  and use it; report what you used.
- **Reading a draft for the engine.** The engine wants a file list and file
  contents. Give `lib/themes/theme-bundle.ts` a second reader over the store
  folder that feeds the same validation and compile as `loadThemeFromDir`,
  so a draft and an installed bundle cannot be judged by different rules.
  Do not materialise a draft to a scratch directory just to read it.
- `createDraft` derives the id from the name, and refuses or suffixes one
  that a draft or a registered theme already holds (decision 9). A copy
  (decision 3) takes every file the source's `listBundleFiles` returns.
- A write accepts any document that parses under
  `ThemeTokensDocumentSchema`. Registry-level problems (an unknown token, a
  bad `var()`) are returned as issues and do not block the save.
- **`installDraft`** refuses a draft with validation errors. Otherwise it
  writes the draft's files to a temporary directory, converts images
  (decision 11), packs with `packThemeDirectory`, and calls
  `installThemeBundle`, so the result passes every check a bundle passes.
  Installing again replaces the earlier install of the same id. Each
  install bumps the patch part of the draft's manifest `version` so asset
  URLs change.
- **Image conversion at install** is its own function in `lib/themes/`,
  pure over a directory: each `.png`, `.jpg`, `.jpeg`, `.gif` and lossless
  `.webp` raster becomes a WebP beside it (use the settings
  `transcodeToWebP` uses) and the original is dropped from the packed copy;
  references are rewritten in `theme.json` (`previewImage`, `icons`,
  `subsystems`), in token and primitive values, and in the custom CSS, using
  the engine's own `url()` parser, not a string replace. A name that would
  collide with an existing file is an error. Animated images are left
  alone and reported. The one PNG in the bundled themes is a separate
  matter; mention it in the report and leave it.
- Export and backup: `.qtap` export has an exclusion predicate
  (`lib/export/excluded-files.ts`). Decide with the human at the stop
  whether drafts ride in an export; until then do not add an exclusion.

### 1.2 API

`/api/v1/theme-drafts` (collection) and `/api/v1/theme-drafts/[id]` (item):

| Call | Does |
|---|---|
| `GET` collection | list: id, name, last change, error and warning counts |
| `POST` collection | create `{ name, from? }` |
| `GET` item | manifest, tokens document, `revision`, the draft's `qtap://` address, the server-compiled parts (font faces, icons, scoped custom CSS, as three strings), subsystems, validation issues |
| `PUT` item | `{ revision, tokens?, name?, description? }` → new revision and issues; 409 on a stale revision |
| `DELETE` item | delete the draft |
| `POST` item `?action=install` | install; publishes the realtime hint the theme list already uses, or adds a `themes` topic if there is none |

Add `queryKeys.themeDrafts`. Decide whether drafts need a realtime topic of
their own (two tabs editing one draft are already covered by the revision
check) and record the answer in the report.

### 1.3 Assets

A draft has fonts and images, and its compiled CSS points at them with the
same URL shape as an installed theme. The asset and font routes look the id
up in the registry first and then among drafts, read a draft's bytes from
the store, serve only the draft's compiled served set, and send drafts with
`Cache-Control: no-cache` instead of `immutable`. The preview shows the
draft's original images, not converted ones.

### 1.4 Tests

Unit tests for every storage function, including: id collision, a copy of
each bundled theme validates clean, stale revision, an invalid-but-parseable
save, a `tokens.json` broken from outside the editor, a PNG written under
`Themes/` comes back byte for byte while the same PNG elsewhere in General is
still re-encoded, install converts that PNG and rewrites all three kinds of
reference while the draft keeps the original, install of a valid draft, refusal of an invalid one, a draft id that
tries to leave the folder, and an asset request for a file outside the
served set.

**Stop.** Report.

## Stage 2 — preview and editor

### 2.1 The preview slot

`ThemeProvider` gains one thing: a preview that outranks the active theme.

- Context adds `preview` (null or `{ themeId }`) and
  `setPreview(value | null)`, where the value is `{ themeId, css, features,
  choices, subsystems }`.
- While a preview is set, `applyThemeToDom` and `ThemeStyleInjector` use it;
  `activeThemeId` and the stored preference are untouched, and the theme
  picker still shows the worn theme. `themeRevision` bumps on every preview
  change, as it does for any CSS change.
- Clearing the preview restores the active theme without a fetch.
- This is the only way a preview reaches the DOM. No second `<style>`
  element, no inline styles on `<html>`.

### 2.2 The editor

- Tab kind `theme-editor` (payload: optional draft id) and route `/calliope`
  (decision 1). Follow an existing kind end to end: `TAB_KINDS`, tab meta,
  persistence, toolbar bridge. Opening it from the Appearance card uses
  `openTab` in place, never a route change inside the workspace.
- **Draft list:** name, last change, issue counts;
  "New theme" (a `BaseModal` asking for a name and "start from": blank or
  any registered theme); delete, behind an `alertdialog` confirm.
- **Editing a draft:** name and description; a light / dark switch for the
  preview that sets the mode for this tab only; then the colour tokens of
  decision 7, one section per registry group, each row showing:
  - the token's `label` (and `description` as help text);
  - the value in force for light and for dark, as a swatch, and where it
    comes from: the default, this theme, or another token it follows (a
    `var()` reference is shown as "follows *label*", with the resolved
    swatch);
  - a colour control per mode: a picker plus a text field that takes any
    colour `parseColor` understands. Dark starts as "same as light" and can
    be given its own value;
  - "reset", which removes the override;
  - the contrast of each pair the token is in, for the mode shown: ratio,
    threshold, pass or fail, and what it is measured against.
  A token whose value in a copied theme is a primitive reference is editable
  the same way: an edit writes a literal override. Primitives themselves are
  listed read-only.
- **Applying:** every change recomputes the token CSS, features and choices
  with `lib/themes/engine/client.ts`, joins them to the server-compiled
  parts in injector order (font faces, tokens, icons, custom CSS) and calls
  `setPreview`. Saving is debounced `PUT`s carrying the revision; a 409
  (someone else changed the file — Document Mode, a character) reloads the
  draft and says so. The form state is `useDraft`, so a refetch
  never overwrites a value being typed.
- **Leaving:** closing the tab, or a "Stop preview" button, clears the
  preview. Unsaved changes are flushed first.
- **Install:** one button, disabled while the draft has errors, with the
  errors listed. On success it offers to wear the theme now.
- **The editor must stay readable under a bad draft.** The generated
  defaults are declared on `[data-theme]`, which suggests the editor's own
  panel can carry `data-theme="default"` and the mode class and so keep the
  default look while the rest of the app repaints. Verify that; if it does
  not hold, stop and report instead of working around it.

### 2.3 Tests and proof

- Component tests (with `renderWithQuery`): the list, create, edit a colour
  and see `setPreview` called with CSS containing the new value, reset,
  dark value, conflict handling, install disabled on errors.
- In V4test: create a blank draft and a copy of each of two bundled themes,
  change the primary colour of each, and confirm with the computed-style
  probe that a copy with no edits renders identically to its source.
  Screenshot the editor beside a Salon chat in light and dark.
- `npm run lint`, `npx tsc`, the theme snapshot check and the unit suite
  pass.

**Stop.** This stop is the human's hands-on review.

## Stage 3 — documentation

- `help/`: a new page for the theme editor (house voice, `url` frontmatter,
  an "In-Chat Navigation" section), and a pointer from
  `help/appearance-settings.md`.
- `docs/developer/THEME_DEVELOPMENT.md`: drafts, where they live, how
  install relates to them, and the contrast check.
- `CLAUDE.md`, Themes section: `lib/themes/drafts/` as the one door to
  `Themes/` in Quilltap General, the image rule of decision 11 (originals
  in a draft, WebP in an install), the preview slot as the one way a preview reaches the
  DOM, `engine/client.ts` and its import rule, the contrast pairs and gate.
- `docs/developer/API.md`: the new routes.
- `docs/CHANGELOG.md`.
- Mark this spec implemented, link it from the proposal, and move it to
  `features/complete/`.

## Implementation notes (4.14-dev)

What differs from the plan above, and what was found on the way:

- **Nested-theme boundary.** Tokens held in the nested default panel, but custom CSS and icon overrides (`[data-theme="id"] X`) reached into it. Every descendant rule a theme compiles is now wrapped in `@scope ([data-theme="id"]) to ([data-theme]:not([data-theme="id"]))` with `:scope` in place of the prefix (`lib/themes/engine/boundary.ts`); consecutive rules share one block, rules inside `@media` / `@supports` / `@container` / `@layer` get their own, `@keyframes` stay outside. Specificity is unchanged. The snapshot cascade (`lib/themes/snapshot/cascade.ts`) reads `@scope` whose root matches the root element, so the bundled snapshots did not move.
- **Realtime.** One `themes` topic, published by the hot-load after an install, invalidating both `queryKeys.themes` and `queryKeys.themeDrafts`. Draft saves publish nothing: two editors of one draft meet at the revision check.
- **Export.** The human chose to keep drafts out of `.qtap` exports: `docStoreExportExclusion` (`lib/export/excluded-files.ts`) drops the `Themes` folder of General and everything under it in the store streamer. Backups still carry drafts.

## Report back

At each stop: what was done, what differs from this spec and why, anything
found that the spec did not foresee, and the commands run with their
results. At the Stage 0 stop, the contrast table. At the Stage 2 stop, the
screenshots and whether the nested default-theme panel held. At the end, a
list of what Specs E–G should know: anything about the editor's structure
that fonts, lengths, the specimen gallery or the custom CSS editor will
build on.
