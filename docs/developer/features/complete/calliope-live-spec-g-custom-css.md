# Calliope Live — Spec G: custom CSS, highlighted source and import

**Status:** implemented 4.14-dev, 2026-11-16 (Stages 0–1 in `eaa95272f`, Stage 2 in `c2ddd35ad`, Stage 3 in `cdd97d3b3`, Stage 4 documentation; user docs [help/theme-editor.md](../../../../help/theme-editor.md) and [help/scriptorium.md](../../../../help/scriptorium.md)).
Implements the fourth slice of Phase 2 of [calliope-live.md](calliope-live.md).
Read, before starting:

- Spec F, [calliope-live-spec-f-assets-and-manifest.md](calliope-live-spec-f-assets-and-manifest.md),
  especially "For Spec G" in its implementation notes;
- Spec E, [calliope-live-spec-e-typed-controls.md](calliope-live-spec-e-typed-controls.md),
  "For Specs F and G";
- Spec B, [calliope-live-spec-b-hook-catalogue.md](calliope-live-spec-b-hook-catalogue.md),
  and the generated [THEME_HOOKS.md](../../THEME_HOOKS.md);
- [THEME_DEVELOPMENT.md](../../THEME_DEVELOPMENT.md), the custom CSS rules;
- `lib/themes/engine/scope.ts` and `app/salon/[id]/components/DocumentPane.tsx`.

**Scope:** `quilltap-server` only.

## Goal

Tokens cover most of a theme. The rest — a textured panel, a letter-spaced
heading, an animation — is custom CSS, and today the editor cannot touch
it: an author has to open `styles.css` in Document Mode, where it is plain
text in a `<textarea>`, and reload the draft to see the result. At the end
of this spec:

- the editor has a custom CSS section: the stylesheet edited as highlighted
  text, applied to the live preview as it is saved, with the engine's
  errors and warnings shown against their lines;
- while writing it, the author can look up and insert the app's catalogued
  hooks, the theme's tokens and primitives, and the draft's images;
- one code editor component gives JSON and CSS syntax highlighting, used by
  the theme editor and by Document Mode;
- a `.qtap-theme` file can be opened as a new draft.

With this, a theme of any of the six bundled themes' complexity can be made
start to finish in the editor.

## Out of scope

The specimen gallery and inspect mode (Spec H); LLM assistance; layout
variants; completion, bracket matching, folding or any other code-editor
feature beyond highlighting and line markers; highlighting for languages
other than JSON and CSS; changing what custom CSS may contain (the scoping
rules of Spec A stand); a visual editor for CSS rules; exporting a draft
without installing it.

## Where things stand

- **Custom CSS is compiled on the server.** `scopeThemeCss` parses the
  stylesheet with PostCSS, scopes every rule to the theme, renames
  keyframes, refuses `@import`, `@font-face` and remote `url()`, and
  returns either CSS or errors. PostCSS is kept out of the browser bundle,
  and a test holds that for `lib/themes/engine/client.ts`.
- **The editor already previews it.** `GET /api/v1/theme-drafts/[id]`
  returns the scoped custom CSS as `compiled.custom` (empty when the draft
  is invalid), and the editor joins it to the token CSS it emits itself.
- **Errors name their line, as text.** A scope error reads
  `"@import is not allowed (line 12)"`, and a hook finding
  `"styles.css:12: .foo — …"`. `DraftIssue` is `{ severity, message }`,
  with no file or line of its own.
- **The stylesheet is a manifest field.** `stylesPath` names it; a blank
  draft has none.
- **It is small.** The five bundled stylesheets are 39 to 75 lines, 1.2 to
  2.4 KB.
- **Spec F's notes settle the save pattern**: like `tokens.json` — its own
  content-hash revision, whole-file saves, the same recovery from a stale
  revision — plus one named manifest operation to attach or detach the
  file. They also note that `bundleFileUsage` already counts a `url()` in
  custom CSS as a use of an image.
- **Document Mode edits anything that is not Markdown in a `<textarea>`**
  (`DocumentPane.tsx`, `isMarkdownFile`), so that its bytes are not passed
  through the Markdown serialiser. That path carries the "AI editing"
  lock; the Markdown path carries much more (frontmatter, focus requests,
  a source toggle with its own flush) and is not touched here.
- **Lexical's highlighter is not installed.** The project is on Lexical
  0.53. `@lexical/code` supplies the code nodes, which Document Mode and
  the Markdown editor already register, but in this version the Prism
  highlighter lives in a separate package, `@lexical/code-prism` (0.53.0,
  MIT), which the project does not have. `prismjs` itself is already in the
  tree as a dependency of `react-syntax-highlighter`. So the earlier
  statement in the proposal that highlighting needs no new dependency is
  wrong by one package from the same family.
- **Creating a draft has two sources**, blank and a copy of a registered
  theme, both through `createDraftNow` and `writeNewDraft`
  (`lib/themes/drafts/service.ts`). `lib/themes/bundle-archive.ts`
  validates and extracts an archive, and refuses a version 1 bundle with
  the message from `lib/themes/refused.ts`.
- **The hook catalogue is importable by the client** (`lib/themes/hooks/`:
  156 hooks with label, surface, variants and states).

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **Custom CSS reaches the preview through the server.** Edits are saved after a short pause in typing; the save returns the scoped CSS and the issues, and the preview takes them. While the stylesheet has errors the preview keeps the last good custom CSS, and the errors are shown. PostCSS stays out of the browser. The alternative is to scope in the browser for a preview on every keystroke, which means shipping PostCSS to the client and keeping two callers of the scoper honest. | confirmed 2026-11-15 |
| 2 | **Custom CSS has the text editor's own undo.** Undo inside the CSS section undoes typing there; the token undo of Spec E stays as it is and does not cover CSS. The alternative is one history across tokens and CSS, which needs a second document in the editor's snapshot and a rule for interleaving the two. | confirmed 2026-11-15 |
| 3 | **A reference panel stands in for completion.** Beside the CSS, three searchable lists: the hook catalogue (by surface, with each hook's variants and states), the tokens and primitives, and the draft's images. Choosing an entry inserts the selector, `var(--name)` or `url(path)` at the cursor. The alternative is nothing, leaving the author to read `THEME_HOOKS.md` beside the app. | confirmed 2026-11-15 |
| 4 | **One code editor component, on Lexical, with one new package.** `components/code-editor/` is a plain-text Lexical editor with a single code block and Prism highlighting for JSON and CSS, added by taking `@lexical/code-prism` at the version of the other Lexical packages. The theme editor's CSS section and Document Mode both use it. In Document Mode it replaces the `<textarea>` for `.json` and `.css` files only; every other non-Markdown file keeps the `<textarea>`. The alternative is to highlight with the already-present `react-syntax-highlighter` in a layer under a transparent `<textarea>`, which adds no package but is a second editing technique to maintain. | confirmed 2026-11-15 |
| 5 | The code editor must hand back exactly the text it was given: tabs, line endings and the final newline are preserved, and a file that was opened and not edited is never saved. This is the condition for using it in Document Mode at all. | settled |
| 6 | Issues gain structure: `DraftIssue` carries an optional `file` and `line` as well as its message, filled where the engine knows them. The messages do not change. | settled |
| 7 | An imported bundle always becomes a new draft, under a free id; it never replaces a draft or an installed theme. It passes the checks an install runs before anything is written. | settled |
| 8 | The Document Mode change is the last stage, with its own stop, and can be left out without affecting the rest. | settled |

## Constraints that apply throughout

- Commit nothing. Stop and report at the end of each stage.
- The dev server on port 3000 is the human's; do not kill it. Try things in
  the V4test instance on port 3005.
- The import-graph test on `lib/themes/engine/client.ts` keeps passing
  (decision 1).
- Draft files are written only through `lib/themes/drafts/`. Manifest
  changes are named operations taking `manifestRevision`.
- The preview still reaches the DOM only through `setPreview`.
- Do not reintroduce a per-keystroke React state update of the whole
  document text around a Lexical editor; the Salon composer was decoupled
  from that for a reason. The code editor owns its text and emits debounced
  changes.
- Document Mode: change only the non-Markdown branch. The Markdown branch,
  its source toggle and its flush logic are not touched. `doc_focus` and
  the "AI editing" lock must work as before.
- UI: `qt-*` classes only for anything themed, `BaseModal` for dialogs, an
  accessible name on every control, WCAG 2.2 AA. The code editor's colours
  come from theme tokens, hold 4.5:1 in light and dark, and it must be
  usable by keyboard alone, including leaving it (Tab must not be trapped
  without a stated way out).
- User-facing copy is in the house voice; `docs/CHANGELOG.md` is plain.
- No stubs or `TODO` code. Debug logging on every new backend path.
- After any engine change: `npm run build:cli-theme-engine`.
- Security: an imported archive is untrusted input. If anything here turns
  up a way for it, or for custom CSS, to do harm, put it in
  `.claude/plans/calliope-live-css-safety.md` and tell the human; do not
  write it into a tracked file.

## Stage 0 — the code editor

`components/code-editor/CodeEditor.tsx` (decision 4).

- Props: `value`, `language` (`'json' | 'css'`), `onChange` (debounced,
  with a `flush` the parent can call), `readOnly`, `markers` (line,
  severity, message), an accessible name, and an imperative handle for
  `insertAtCursor(text)` and `revealLine(n)`.
- A single code block; plain-text behaviour (no rich-text shortcuts);
  Lexical's history for undo (decision 2); Tab indents and Shift+Tab
  outdents, with Escape then Tab leaving the editor, stated in its
  accessible description.
- Line numbers, and a mark in the gutter on each marked line with the
  message available to pointer and keyboard users; the same messages in a
  list below, each moving the cursor to its line.
- Highlight colours as `qt-*` classes backed by registry tokens. Use the
  existing code-block tokens if they fit; if new tokens are needed, add
  them to the registry in the normal way and say so in the report.
- A new `value` from outside replaces the text only when it differs from
  what the editor last emitted, so a refetch does not move the cursor or
  discard typing.
- **Fidelity (decision 5).** Tests: every bundled `styles.css`,
  `tokens.json` and `theme.json`, a file with tabs, one with CRLF line
  endings, one with no final newline and one that is empty each come back
  byte for byte, and mounting alone fires no `onChange`.
- Measure typing in a 2,000-line JSON file and report it. If it is not
  comfortable, say what size is, and Stage 3 will keep the `<textarea>`
  above that.

**Stop.** Report, with the measurement and a screenshot in light and dark.

## Stage 1 — server

### 1.1 Structured issues (decision 6)

`scopeThemeCss`, the hook lint and the validator return file and line
beside each message where they have them; `DraftIssue` passes them on.
`quilltap themes validate` output is unchanged.

### 1.2 The stylesheet

- `readDraft` returns `styles`: null, or the path, the text and its
  revision (content hash).
- `set-styles-file` (a named operation, `manifestRevision`): creates
  `styles.css` when the draft has none and names it in `stylesPath`.
  `clear-styles-file`: unnames it, and deletes the file when the caller
  asks for that. File before manifest on the way in, manifest before file
  on the way out, as in Spec F.
- `writeDraftStyles(id, { revision, css })`: the `writeDraftTokens`
  pattern. It saves whatever text it is given — a stylesheet with errors is
  still saved, as an invalid `tokens.json` is — and returns the fresh
  detail, so `compiled.custom` and the issues come back with the save.
- API: `PUT` takes `{ revision, tokens }` or `{ stylesRevision, css }`;
  `POST ?action=set-styles-file` and `?action=clear-styles-file`.

### 1.3 Import (decision 7)

- `createDraft` takes a third source, an uploaded archive. Validate and
  extract it into a temporary directory with `lib/themes/bundle-archive.ts`
  — the checks an install runs — then hand that directory to
  `writeNewDraft`. The temporary directory is removed whatever happens.
- A version 1 bundle is refused with the message `lib/themes/refused.ts`
  gives. An archive over the bundle limits is refused before it is read
  whole.
- The draft takes the bundle's name and a free id derived from it; the
  result says so when the id differs from the bundle's own.
- API: `POST /api/v1/theme-drafts?action=import`, multipart.

### 1.4 Tests

Structured issues for a parse error, a refused at-rule and a hook finding;
set and clear the stylesheet; save valid and invalid CSS; stale styles
revision; import of each bundled theme packed to an archive, comparing the
draft's files with the source; import of a version 1 bundle, an archive
with a symbolic link, one with a path that climbs out, and one over the
limits; an id collision on import.

**Stop.** Report.

## Stage 2 — the editor

### 2.1 Custom CSS section

A new section in the editor's navigation, with the asset sections.

- **No stylesheet yet:** a short explanation of what custom CSS is for and
  a button that creates one.
- **The editor:** the Stage 0 component on the draft's stylesheet. Saves
  are debounced and carry the revision; the status reads saved, saving, or
  changed elsewhere. On a save's return, `compiled.custom` goes into the
  preview when the stylesheet has no errors, and the last good one stays
  when it has (decision 1). Markers come from the issues whose `file` is
  the stylesheet.
- **Flushing:** pending CSS is saved before any other operation on the
  draft, before install, and when the section or the editor closes, the
  way pending token edits are.
- **The rules, stated once** above the editor in plain words: rules are
  scoped to this theme automatically; keyframe names are made unique;
  `@import` and `@font-face` are not allowed (fonts go in the Fonts
  section); a `url()` must be one of the draft's images.
- **Reference panel (decision 3):**
  - *Hooks* — the catalogue grouped by surface, searchable by label and
    class. An entry shows its description, variants and states, and inserts
    `.qt-…`, or the selector with a chosen variant or state.
  - *Tokens* — registry tokens and the draft's primitives, searchable,
    showing the value in force; inserts `var(--name)`.
  - *Images* — the draft's images; inserts `url(images/…)`.
- **Remove the stylesheet**, behind an `alertdialog`.
- The Files panel of Spec F already shows the stylesheet and what it uses;
  check that an image used only from CSS shows as used after a save.

### 2.2 Import

On the draft list, "Open a theme file" beside "New theme": choose a
`.qtap-theme`, see the refusal message or open the new draft. Say plainly
when the draft's id differs from the file's.

### 2.3 Tests and proof

- Component tests: create the stylesheet; type and save; errors keep the
  last good preview and show markers; each reference list inserts at the
  cursor; conflict handling; import success and each refusal.
- In V4test: start blank, add a stylesheet, write a rule against a hook
  inserted from the panel, a keyframe animation, and a background using an
  uploaded image; confirm each in the running app; introduce an error and
  confirm the preview holds; install and wear it. Then export one bundled
  theme, import the file, and confirm with the computed-style probe that
  the imported draft renders as the source does.
- `npm run lint`, `npx tsc`, the theme snapshot check and the unit suite
  pass.

**Stop.** This stop is the human's hands-on review.

## Stage 3 — Document Mode (decision 8)

- In `DocumentPane.tsx`, the non-Markdown branch uses the code editor for
  `.json` and `.css` files and the `<textarea>` for everything else (and
  for a file over the size found in Stage 0, if there was one).
- It keeps the pane's contract exactly: `onContentChange` receives the
  text; the "AI editing" lock makes it read-only; a change arriving from
  outside (a character's `doc_*` write, a save elsewhere) replaces the text
  without losing the place where it can; `doc_focus` on a line scrolls to
  it; the status bar says "JSON" or "CSS" where it said "Plain text".
- A draft's `tokens.json`, `theme.json` and `styles.css` opened from the
  Scriptorium are the cases to check, alongside an ordinary JSON file in a
  project.
- Tests for the branch choice and the contract above. In V4test: open and
  edit each kind, let a character edit one while it is open, and confirm a
  file opened and closed without edits is not rewritten.

**Stop.** The human tries Document Mode before this stage is accepted.

## Stage 4 — documentation

- `help/theme-editor.md`: the custom CSS section, the reference panel, the
  rules, opening a theme file.
- The Document Mode help page: JSON and CSS are highlighted.
- `docs/developer/THEME_DEVELOPMENT.md`: writing custom CSS in the editor;
  import.
- `docs/developer/API.md`: the new actions and the `PUT` shape.
- `CLAUDE.md`: `components/code-editor/` as the one highlighted source
  editor and its fidelity rule; the stylesheet's save pattern; import as a
  source of `createDraft`.
- The proposal's "Decisions made" row on text editing: note the one
  package it needed.
- `docs/CHANGELOG.md`.
- Mark this spec implemented, link it from the proposal, and move it to
  `features/complete/`.

## Report back

At each stop: what was done, what differs from this spec and why, anything
found that the spec did not foresee, and the commands run with their
results. At the end, add an "Implementation notes" section to this file,
with what Spec H should know — in particular how inspect mode could hand a
hook or a token to the CSS section and the token rows.

## Implementation notes

Done in four commits: Stages 0–1 (`eaa95272f`), Stage 2 (`c2ddd35ad`),
Stage 3 (`cdd97d3b3`) and Stage 4 (documentation).

### What differs from this spec

- **A reusing tokenizer replaces Lexical's highlighter pass.**
  `@lexical/code-prism` rebuilt every highlighted node on each keystroke
  (about 62,000 nodes in a dense 2,000-line file, 159 ms a key).
  `components/code-editor/tokenizer.ts` colours the same way but rebuilds
  only the changed stretch: a realistic 2,000-line `tokens.json` types at
  about 16 ms a key in Lexical's development build, 10 ms in production. The
  package is still the dependency the proposal names; only its tokenizer
  output is used.
- **Prism loads in manual mode** (`prism-manual.ts`, imported first).
  Otherwise Prism rewrites every `code[class*="language-"]` on the page on
  load, including the Salon's Markdown code blocks, which React owns.
- **Eight `--qt-code-token-*` theme tokens** carry the highlight colours,
  each the theme's code text colour mixed with a hue, with contrast pairs.
  Every bundled theme passes in light and dark (lowest: Art Deco's comment
  colour in light, 5.30:1). The token count pinned in `model.test.ts` went
  from 288 to 296.
- **Mixed line endings.** Lexical drops the carriage return, so a file
  mixing CRLF and LF cannot be kept exactly once edited: an edited mixed
  file is saved with whichever ending it had more of. A file opened and not
  edited is never sent back, so it is untouched (decision 5 holds for every
  file that is not edited, and for every file with consistent endings).
- **The stylesheet write lives in `operations.ts`, not the text-document
  write.** Quilltap General stores a `.css` file as a binary upload, not a
  native text document, so `writeDocument`'s own conflict check cannot save
  it. `writeDraftStyles` runs on the per-draft queue the other operations
  use, compares the revision, then writes the bytes. A write from outside
  `lib/themes/drafts/` landing between the check and the write would not be
  caught; nothing does that today.
- **An import keeps the bundle's version**; a copy still starts at `0.1.0`.
- **The whole last good compile is held, not only the custom part.** While a
  draft has any error the server compiles nothing, font faces and icons
  included, so holding only the custom CSS would have dropped fonts and
  icons from the preview while the CSS was broken. A font removed while the
  CSS is broken stays in the preview until the CSS is mended.
- **Document Mode emits after 150 ms, the theme editor after 400 ms.** The
  pane flushes on blur and on close; `doc_focus` scrolls to the line
  (`revealLine(line, { focus: false })`) with no highlight overlay or gutter
  eye, which belong to the Markdown editor.

### Found along the way

- **CSS in a database store is view-only in Document Mode.** Database stores
  (Quilltap General among them) edit only native text — Markdown, text,
  JSON, JSONL (`detectNativeText`) — and `viewTargetFor` shows every other
  file in the viewer. So a draft's `styles.css` opens read-only there, while
  CSS in a filesystem store is editable. The database store's write path
  refuses it too (`writeDatabaseDocument`, "only accept text documents"), so
  a character's `doc_write_file` / `doc_str_replace` cannot write a draft's
  stylesheet either. The Custom CSS section is the one way to edit it. The
  fix — `'css'` as a native text type (the `fileType` lists, the export
  schema enum, `DDL.md`, a migration turning stored `.css` files into text
  documents, and `writeDraftStyles` moving onto `writeDocument` with its
  conflict check) — is deferred by the human's decision (2026-11-16) to the
  LLM co-development of themes, which needs characters to write CSS.
- **The Atelier usually sits in a narrow split pane**, so the CSS section
  lays out side by side by container query (`@container` / `@3xl:`), not by
  viewport. Spec E's navigation grid still keys off the viewport.
- **Enter keeps the line's indent but does not add one after `{`.** That is
  decision 4's "no feature beyond highlighting and line markers", and it is
  noticeable when writing CSS.
- No security finding: an archive's climbing paths, symlinks, oversized
  contents and refused at-rules are turned away before anything is written.

### For Spec H (specimen gallery, inspect mode)

- **Handing a hook to the CSS section.** The reference panel's insert path is
  the one to reuse: `StylesSection` holds a `CodeEditorHandle` and calls
  `insertAtCursor(text)`. Inspect mode should not build selectors itself —
  `hookSelectors(hook)` (`components/theme-editor/assets/styles-model.ts`)
  lists every way a catalogued hook can be written (the class, each variant
  value, each state), and `HOOKS` / `lib/themes/hooks/` maps an element's
  `qt-*` class to its `HookDef`. A natural shape: inspect resolves the
  element to a `HookDef` and the variant and state values present on it,
  picks the matching selector from `hookSelectors`, opens the Custom CSS
  section (`goToSection` in `DraftEditor.tsx`), and inserts through a small
  imperative handle on `StylesSection` (an `insertRef` beside the existing
  `flushRef`). With no stylesheet yet, it should offer **Begin a
  stylesheet** (`set-styles-file`) first rather than create one silently.
- **Handing a token to the token rows.** Token rows have no stable DOM id
  today; the editor narrows by its search (`query` in `DraftEditor.tsx`) and
  opens sections by id. Inspect mode can set the search to the token name
  and open its section, or Spec H can give `TokenRow` an id from the token
  name and scroll to it. The computed value in force for the current mode is
  already in `ResolvedTheme` (`tokenEntries` in `styles-model.ts` reads it),
  so an inspector panel can show "this colour is `--theme-card`, value …"
  without measuring.
- **Issues are located.** `DraftIssue` carries `file` and `line`; an
  inspector that finds a rule from `styles.css` affecting an element can
  jump to it with `revealLine`, as the issue list's **Line N** does.
- **The preview boundary holds.** Everything the editor shows (and any
  inspector overlay) should sit inside a nested element wearing another
  theme, so the `@scope` boundary keeps custom CSS off it, as the Atelier
  panel already does.
