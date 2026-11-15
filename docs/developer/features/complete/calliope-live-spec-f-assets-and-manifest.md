# Calliope Live — Spec F: fonts, images and the manifest

**Status:** implemented 4.14-dev, 2026-11-15 (Stages 0–1 in `043bda42a`, Stage 2 documentation; user docs [help/theme-editor.md](../../../../help/theme-editor.md)).
Implements the third slice of Phase 2 of [calliope-live.md](../calliope-live.md).
Read, before starting:

- Spec E, [calliope-live-spec-e-typed-controls.md](calliope-live-spec-e-typed-controls.md),
  especially "For Specs F and G" in its implementation notes;
- Spec D, [calliope-live-spec-d-live-preview.md](calliope-live-spec-d-live-preview.md)
  (drafts, decision 11 on images, the asset routes);
- [THEME_DEVELOPMENT.md](../../THEME_DEVELOPMENT.md);
- `lib/themes/engine/document.ts` (the manifest schema) and
  `lib/themes/drafts/service.ts`.

**Scope:** `quilltap-server` only.

## Goal

After Spec E the editor sets every token, but it can only point at fonts
and images a draft already has, and of `theme.json` it edits the name and
description. A blank draft is therefore limited to system fonts and no
images. At the end of this spec, from the editor alone, an author can:

- add font files to a draft, each with its family, weight, style and
  licence, and remove them;
- add and remove images, and use them in image tokens, as the preview
  image and as subsystem pictures;
- replace any of the app's icons with an SVG or WebP of their own;
- rename a subsystem and give it its own description and pictures;
- set the rest of the manifest: author, licence, tags, whether the theme
  has a dark mode;
- see every file in the draft, what uses it, and remove what nothing uses.

## Out of scope

The custom CSS section, code highlighting in Document Mode, and importing
a `.qtap-theme` file into a draft (Spec G); the specimen gallery and
inspect mode (Spec H); LLM assistance; layout variants; changing a draft's
id; drawing or editing an image or an icon; any change to the manifest
schema, to a bundled theme, or to what an installed theme can contain.

## Where things stand

- **The manifest schema is settled** (`ThemeManifestSchema`): fonts need a
  `license` (an SPDX identifier or `proprietary`) and may name a
  `licenseFile`; font files are `.woff2`, `.woff`, `.ttf` or `.otf`; icon
  overrides are keyed by the app's icon names and must be `.svg` or
  `.webp`; subsystem images are bundle paths or `none`. Bundle paths use
  only letters, digits, `.`, `_`, `-` and `/`.
- **The bundled themes show the range.** Madman's Box declares 23 fonts,
  89 icon overrides and 12 subsystem overrides, and sets
  `supportsDarkMode: false`.
- **Drafts already hold binary files.** `writeDraftFile`
  (`lib/themes/drafts/store.ts`) writes text through the document core and
  everything else as a blob, and images under `Themes/` are kept byte for
  byte. A copy of a bundled theme brings its fonts and images with it.
- **The server compiles what the manifest drives.** Font faces and icon
  rules come back from `GET /api/v1/theme-drafts/[id]` as compiled CSS, and
  the editor's preview joins them to the tokens it emits itself. So a
  manifest change needs one round trip before it shows.
- **Only two manifest fields can be written.** `writeDraftManifestFields`
  takes name and description, through `rewriteManifest`, which guards on
  the file's modification time. The manifest has no revision the client
  sends, as `tokens.json` has.
- **The editor is ready for it.** `DraftResourcesContext` carries the
  draft's fonts and images to the font-family, font-weight and image
  controls; refreshing the draft detail is enough for them to offer a new
  file. A new section joins the navigation through `sectionViews`.
- **Undo covers `tokens.json` only.**
- **Theme assets are served safely already**: only the compiled served
  set, through `serveStoredBytes`, with SVG never inline.
- **Bundle limits** (`lib/themes/bundle-archive.ts`): 10 MB a file, 200
  files, 50 MB in all, and a list of allowed extensions.
- **Nothing in the app reads a font file.** There is no font-parsing
  dependency and no WOFF2 encoder, so a font's family, weight and style are
  known only from what the manifest says. On npm (checked 2026-11-15):
  `fontkit` 3.0.0, MIT, pure JavaScript, published 2026-11-11; `wawoff2`
  2.0.1, MIT, WebAssembly, last published 2022; `ttf2woff2` builds a native
  module and is not a candidate.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **The app reads what a font is from the font.** On upload the server parses the file and takes the family, weight (a range for a variable font), style and the font's own licence text from its tables; the author sees them prefilled and may correct them. This needs a font-parsing dependency: `fontkit` (MIT, pure JavaScript, reads all four formats). A file it cannot parse is still accepted when its leading bytes are a font's, with the fields guessed from the file name and a warning. | decided by the human 2026-11-15 |
| 2 | **An installed theme carries WOFF2.** A draft keeps the font files as uploaded. When it is installed, every `.ttf` and `.otf` is converted to WOFF2 in the packed copy and the manifest's `src` is rewritten, the same shape as the WebP rule for images. This needs a WOFF2 encoder: `wawoff2` (MIT, WebAssembly, no native build). A `.woff` is packed as it is: it is already compressed, and the encoder takes only uncompressed fonts. | decided by the human 2026-11-15 |
| 3 | **Install leaves out fonts and images nothing uses.** A font or image file that the manifest, the tokens and the custom CSS do not refer to stays in the draft but is not packed, and the install result says which were left out. Other files (a README, notes) are packed as they are today. The alternative is to pack everything in the folder. | confirmed 2026-11-15 |
| 4 | **Licence is asked for, not judged.** Every font needs a licence choice before it is added: a short list of common identifiers (`OFL-1.1`, `Apache-2.0`, `MIT`, `UFL-1.0`, `CC0-1.0`), free text for another SPDX identifier, or `proprietary`. A licence file can be attached. A draft with a `proprietary` font installs and exports like any other; the editor shows a standing note that the author is responsible for the right to share it. The alternative is to refuse export of a theme with a `proprietary` font. | confirmed 2026-11-15 |
| 5 | Manifest edits are server operations, not client-built documents: each is a named action that reads `theme.json`, changes it, validates the result against `ThemeManifestSchema` where the file already parses, and writes it. The client never sends a whole manifest. | settled |
| 6 | The manifest gets a revision (its content hash), returned with the draft and required on every manifest write, as `tokens.json` has. A stale one is a 409 and writes nothing. | settled |
| 7 | Manifest and file changes are outside undo. Each is confirmed where it destroys something (removing a font, an image, an icon override), and removing a file that something still uses is refused with the list of users. | settled |
| 8 | Uploads are checked against the bundle's own limits when they arrive, so a draft cannot grow into something that will not install. | settled |
| 9 | Uploaded files go to fixed folders — `fonts/`, `images/`, `icons/` — under a name made safe for a bundle path, with a suffix on collision. The editor never asks for a path. | settled |
| 10 | A draft's id cannot be changed. To get another id, start a new draft as a copy. | settled |

## Constraints that apply throughout

- Commit nothing. Stop and report at the end of each stage.
- The dev server on port 3000 is the human's; do not kill it. Try things in
  the V4test instance on port 3005.
- Draft files are written only through `lib/themes/drafts/`; that module
  stays a caller of the document core and `storeMountFile`.
- API routes follow the `/api/v1/` action-dispatch pattern with strict Zod
  bodies; a multipart body's fields are validated the same way as JSON.
- An uploaded file's name is never trusted: the stored name is built by
  the server, and the extension must agree with the file's leading bytes
  for fonts and raster images.
- The preview still reaches the DOM only through `setPreview`.
- UI: `qt-*` classes only, `BaseModal` for dialogs (`alertdialog` for a
  removal), an accessible name on every control, WCAG 2.2 AA.
- User-facing copy is in the house voice; `docs/CHANGELOG.md` is plain.
- No stubs or `TODO` code. Debug logging on every new backend path.
- After any engine change: `npm run build:cli-theme-engine`.
- If anything here turns up a way for an uploaded file to be served or
  interpreted unsafely, put it in `.claude/plans/calliope-live-css-safety.md`
  and tell the human; do not write it into a tracked file.

## Stage 0 — server

### 0.1 What uses what

A pure function in the engine: given a manifest, a tokens document and the
custom CSS, return for every bundle path the things that refer to it (a
font entry, a licence file, an icon override, a subsystem picture, the
preview image, a token or primitive value, a `url()` in the CSS), using the
engine's own `url()` parser. The served set, the "unused" list and the
refusal to remove a used file all come from it.

### 0.2 Draft operations

In `lib/themes/drafts/`, each taking the manifest revision (decision 6):

| Operation | Does |
|---|---|
| `addDraftFont` | store the file under `fonts/`, add the manifest entry (family, weight, style, display, licence, licence file) |
| `updateDraftFont` | change an entry's fields |
| `removeDraftFont` | remove the entry; delete the file when no other entry uses it |
| `addDraftLicenceFile` | store a `.txt` or `.md` under `fonts/` |
| `addDraftImage` | store the file under `images/` |
| `removeDraftFile` | delete an image, font or licence file; refused while anything uses it |
| `setDraftIcon` / `clearDraftIcon` | store under `icons/` and set, or remove, one icon override |
| `setDraftSubsystem` | name, description, thumbnail, background image for one subsystem; empty clears |
| `setDraftManifestFields` | replaces `writeDraftManifestFields`: name, description, author, licence, tags, `supportsDarkMode`, preview image |

- A file is written before the manifest names it, and a manifest entry is
  removed before its file is deleted, so a failure half way leaves an
  unused file and never a reference to nothing.
- Font uploads accept `.woff2`, `.woff`, `.ttf`, `.otf`; images accept the
  engine's image extensions; icons accept `.svg` and `.webp` only, and the
  icon name must be in the app's icon registry; a subsystem id must be one
  of the app's subsystems.
- **Reading a font (decision 1).** One module, `lib/themes/font-info.ts`,
  is the only importer of the parser. Given bytes it returns family (the
  typographic family where the font has one), weight (one value, or the
  `wght` axis range as `"100 900"`), style, whether it is variable, the
  licence text and licence URL from the name table, and the embedding
  permission bits; or a failure. It never throws on bad input and is given
  only files already under the size limit. The licence text is shown to the
  author as a hint; it does not choose the licence for them.
- The file-name guess is the fallback when parsing fails: a pure function
  with tests, covering the common weight words (Thin to Black), `Italic`,
  `Oblique`, `Variable` and a `wght` range in brackets.
- **Dependencies.** Add `fontkit` and `wawoff2` to the root package, each
  at an exact version. `fontkit` 3.0.0 was four days old when this was
  written: read its changelog, and prefer the newest release that is at
  least two weeks old if it reads all four formats. Both must work in the
  standalone build and under the Electron shell: `wawoff2` loads a `.wasm`
  file at run time, so check `next.config.js` (`serverExternalPackages`,
  `outputFileTracingIncludes`) and the standalone overlay build, build the
  tarball, and prove a conversion runs from it. If either package cannot be
  made to work there, stop and report before writing anything on top of it.
- `readDraft` also returns the manifest revision, every file in the draft
  with its size and its users (0.1), and the totals against the limits of
  decision 8.

### 0.3 Install (decision 3)

`installDraft` leaves unused font and image files out of the packed copy
and returns their paths. Decide from 0.1 after the conversions' rewrites,
so a converted file counts as used under its new name.

### 0.3a Fonts become WOFF2 at install (decision 2)

Beside the image conversion of Spec D, and in the same shape: a function
over the packed copy's directory that converts each `.ttf` and `.otf` a
font entry names to `.woff2`, drops the original from the packed copy,
and rewrites that entry's `src`. A name that would collide is an error; a
file the encoder rejects fails the install with the file named. The draft
is not changed. Confirm that a converted font parses again and reports the
same family and weight, and that a variable font keeps its axes. Leave out
the unused files (0.3) first, so nothing is converted that will not ship.

### 0.4 API

On `/api/v1/theme-drafts/[id]`, as `POST ?action=` handlers: `add-font`,
`update-font`, `remove-font`, `add-licence-file`, `add-image`,
`remove-file`, `set-icon`, `clear-icon`, `set-subsystem`, and
`set-manifest` in place of the name and description fields of `PUT` (which
keeps `tokens`). Uploads are multipart. Each returns the fresh draft
detail.

### 0.5 Tests

Each operation; stale manifest revision; a manifest broken from outside
(the operation is refused with the reason, the file untouched); a file over
a limit; an extension that does not match its bytes; a static font, a
variable font and a file that is not a font through `font-info`; a `.ttf`
converted at install with the draft unchanged; a `.woff` packed as it is; a name that needs
making safe; a collision; removing a used file; an unknown icon name or
subsystem id; install leaving out an unused font and image and keeping a
README.

**Stop.** Report.

## Stage 1 — editor

Four new sections in the navigation, as section kinds of their own (Spec
E's notes), below the token sections:

- **Fonts.** One card per family, listing its files with weight, style and
  licence, and a sample line rendered in each. "Add font" takes one or
  several files, shows what was read from each (decision 1) to correct,
  marks any that had to be guessed from the file name, and
  asks for the licence once for the batch (decision 4), with an optional
  licence file. Edit and remove per file. A font whose own tables forbid embedding is
  flagged. A `.ttf` or `.otf` is marked as becoming WOFF2 at install. The
  note of decision 4 shows
  while any font is `proprietary`. A family that no font-family token uses
  says so and offers to open the tokens that could.
- **Images.** A grid of thumbnails with size and what uses each. Add,
  remove. The preview image is chosen here. The note of Spec D's decision
  11 is stated once: originals are kept in the draft and become WebP when
  the theme is installed.
- **Icons.** Every app icon as the theme currently draws it, in registry
  order with search by name; overridden ones marked. Choosing one offers to
  upload a replacement or remove the override. An SVG is shown tinted as
  the app will tint it.
- **Subsystems and details.** Per subsystem: name, description, thumbnail
  and background picture (from the draft's images, or "none", or the
  default). Then the manifest: author, licence, tags, and whether the
  theme has a dark mode — with what the last one does stated in plain
  words, taken from how the app treats `supportsDarkMode` today.

And one panel beside them:

- **Files.** Every file in the draft, its size, what uses it, the totals
  against the limits, and "remove" for each unused one. A link opens the
  draft's folder in the Scriptorium.

Behaviour:

- After any of these operations the editor takes the returned draft
  detail: the compiled font faces and icon rules, the resources context
  and the preview update from it. Unsaved token edits are flushed first
  and are not lost.
- The token controls need no change, but check them: a newly added family
  appears in every font-family control, its weights are marked in the
  font-weight control, a new image appears in the image controls.
- A 409 reloads the draft and says who else may have changed it (Document
  Mode, a character).
- Name and description move from their current place to the details
  section, or stay with a link to it; keep whichever reads better and say
  which.

### Tests and proof

- Component tests for each section, with the operations mocked: add,
  edit, remove, refusal messages, the proprietary note, the unused marks.
- In V4test, from a blank draft: add a font family in two weights and set
  it as the sans stack; add a page background image; override two icons,
  one SVG and one WebP; rename a subsystem and give it a picture; set
  author, licence and tags. Confirm each shows in the running app, then
  install, wear the installed theme, and confirm it matches the preview.
  Check the installed bundle: a PNG that was uploaded is WebP there and
  still a PNG in the draft; a `.ttf` that was uploaded is WOFF2 there and
  still a `.ttf` in the draft, and the installed theme renders in it; an
  unused image is absent.
- `npm run lint`, `npx tsc`, the theme snapshot check and the unit suite
  pass.

**Stop.** This stop is the human's hands-on review.

## Stage 2 — documentation

- `help/theme-editor.md`: fonts and licences, images, icons, subsystems,
  details, the files panel.
- `docs/developer/THEME_DEVELOPMENT.md`: what install leaves out and
  converts; the folders the editor uses.
- `docs/developer/API.md`: the new actions.
- `CLAUDE.md`: the two new dependencies and their one importer each;
  Themes section: manifest edits as named draft operations,
  never a client-built manifest; the "what uses what" function as the one
  source for the served set, unused files and removal.
- `docs/CHANGELOG.md`.
- Mark this spec implemented, link it from the proposal, and move it to
  `features/complete/`.

## Report back

At each stop: what was done, what differs from this spec and why, anything
found that the spec did not foresee, and the commands run with their
results. At the end, add an "Implementation notes" section to this file,
with what Specs G and H should know — in particular whether the manifest
revision and the named-operation pattern suit the custom CSS file, and how
an imported `.qtap-theme` would best become a draft.

## Implementation notes

Done in two commits: Stages 0–1 (`043bda42a`) and Stage 2 (documentation).

### What differs from this spec

- **The asset sections are a second list, not new tiers.** Fonts, Images,
  Icons, Subsystems and details, and Files sit below the token sections in
  the same navigation (`components/theme-editor/assets/`), each changing the
  draft the moment it acts. They are not part of the token undo history.
- **Name and description stay in the top card.** They now save through
  `?action=set-manifest` like every other manifest field; the tokens `PUT`
  takes `{ revision, tokens }` only.
- **`LicencePicker` derives its option from `value`.** It held the chosen
  option in state set once, so a licence filled in from a font's own tables
  after mounting never showed. Fixed in Stage 1.
- **The details form uses auto-fill grids**
  (`grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]`), because the fixed
  columns crushed the fields in a narrow pane. The Spec E navigation grid
  (`md:grid-cols-[13rem_minmax(0,1fr)]`) has the same trouble in a narrow
  pane and was left alone.
- **A page background image is hidden behind subsystem and story
  backgrounds**, as Spec A designed. The proof could not see the page
  background token while a subsystem picture was set; that is precedence,
  not a fault.
- **Only TrueType and OpenType become WOFF2.** WOFF is packed as is, as the
  spec says; an early draft of the help page claimed otherwise and was
  corrected.

### For Spec G (custom CSS, Document Mode highlighting, importing a bundle)

- **The custom CSS file suits the tokens pattern, not the manifest one.**
  It is a whole text document the author edits continuously, like
  `tokens.json`: give it its own content-hash revision and a save that
  compares and writes the whole file (as `writeDraftTokens` does), with
  saves debounced and stale-revision recovery through the same
  `CHANGED_ELSEWHERE` path. The named-operation pattern fits discrete,
  checkable changes to `theme.json` — adding or removing a file, setting a
  field — and still applies to the one manifest change custom CSS needs:
  naming or clearing the `customCSS` path. Make that a named operation
  (`set-custom-css-file`, say) taking `manifestRevision`; then the CSS file
  is created before the manifest names it and unnamed before it is
  deleted, like every other file here.
- **A `url()` in custom CSS already counts as a use.** `bundleFileUsage`
  reports `{ kind: 'custom-css' }` for it, so an image named only from CSS
  is neither marked unused nor left out of the install, and `remove-file`
  refuses it. Spec G's editor should read `usedBy` from the detail rather
  than scanning the CSS itself.
- **Undo.** Spec E's notes ask whether custom CSS joins the undo history.
  Asset operations did not (they are immediate server writes); custom CSS
  edits are text, so they can join it if the snapshot gains a second
  document.
- **Importing a `.qtap-theme` into a draft** is best done as a third
  source for `createDraftNow` (`lib/themes/drafts/service.ts`): validate
  and extract the archive into a temporary directory with
  `lib/themes/bundle-archive.ts` (the same checks an install runs), then
  hand that directory to `writeNewDraft`, which already copies a bundle
  directory into `Themes/<id>/` through the drafts store, writes the
  manifest last, rewrites its id, name and version, and removes a partial
  folder on failure (#226). That keeps one copy path for "from an installed
  theme" and "from a file", and the draft never holds anything an install
  would refuse. An imported bundle's converted WOFF2 and WebP files arrive
  as they are; nothing converts them back. A version 1 bundle should be
  refused at import with the same message `lib/themes/refused.ts` gives.
  Uploads go through the route's multipart reader; the bundle size limit
  (`MAX_BUNDLE_SIZE`, 50 MB) bounds the body.

### For Spec H (specimen gallery, inspect mode)

- The draft detail now carries everything a gallery needs to show a theme's
  own assets without reading files: `files` (with `usedBy`), `images`
  (served URLs), the fonts' facts, `subsystems` with resolved image URLs and
  the compiled font faces and icon rules. A specimen should render from the
  preview slot and these, not fetch bundle files itself.
- Inspect mode, mapping an element back to its token, can use
  `bundleFileUsage` the other way round only for files; for tokens it needs
  its own map from the hook catalogue.
