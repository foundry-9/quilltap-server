# Calliope Live — Spec I: loose ends

**Status:** implemented 4.14-dev, 2026-11-16 (Stage 1 in `236d0b2fd`, Stage 2 in
`5884f2d6f`, Stage 3 in `fb7f36687`, Stage 4.1 triage in `1389d312c`, Stage 4.2
in `cc5336495`, Stage 5 documentation; user docs
[help/theme-editor.md](../../../../help/theme-editor.md) and
[help/scriptorium.md](../../../../help/scriptorium.md); triage list
[calliope-live-spec-i-catalogue-triage.md](calliope-live-spec-i-catalogue-triage.md)).
A clean-up pass over what Specs E to H left behind, before LLM assistance
(the next spec) and Phase 3 of [calliope-live.md](../calliope-live.md). Read,
before starting, the implementation notes of:

- Spec E, [calliope-live-spec-e-typed-controls.md](calliope-live-spec-e-typed-controls.md);
- Spec F, [calliope-live-spec-f-assets-and-manifest.md](calliope-live-spec-f-assets-and-manifest.md);
- Spec G, [calliope-live-spec-g-custom-css.md](calliope-live-spec-g-custom-css.md);
- Spec H, [calliope-live-spec-h-specimens-and-inspect.md](calliope-live-spec-h-specimens-and-inspect.md);

and Spec B, [calliope-live-spec-b-hook-catalogue.md](calliope-live-spec-b-hook-catalogue.md),
for the rules a hook must meet.

**Scope:** `quilltap-server` only.

## Goal

Four small things, each independent of the others:

1. the code editor indents after an opening brace;
2. the theme editor lays out by the width of its pane, not of the window;
3. the theme probe measures the specimen gallery, so it sees every hook;
4. the app's `qt-*` classes that an author would want to target, and
   cannot, join the hook catalogue.

## Out of scope

LLM assistance; Phase 3 (Storybook, author documentation); `.css` as a
native text type in database stores, and with it the stylesheet save race
and a character's ability to write a draft's CSS (deferred by the human to
the LLM step); mixed line endings in the code editor; line numbers for
custom CSS rules in the inspector; turning markup specimens into real
components; the speed of `bundled-walk.test.tsx`; any change to a bundled
theme's look.

## Where things stand

- **Enter keeps the line's indent and nothing more.** The code editor's
  `KEY_ENTER_COMMAND` handler (`components/code-editor/CodeEditor.tsx`)
  inserts a newline plus `leadingIndentAt(...)`. The editor already detects
  the file's indent unit (`detectIndentUnit`) for Tab. Spec G's notes call
  the missing indent after `{` noticeable when writing CSS.
- **One grid still keys off the viewport.** The editor's navigation and
  body are `md:grid-cols-[13rem_minmax(0,1fr)]` (`DraftEditor.tsx`), so in
  a narrow split pane of a wide window the navigation takes 13rem out of
  very little. The Custom CSS section already lays out by container query
  (`@container`, `@3xl:`), and the details form uses auto-fill grids.
  `FontsSection.tsx` has one `sm:` grid of the same kind.
- **The probe misses most hooks.** `scripts/theme-probe/run.ts` measures
  seven live pages, where many hooks are absent (no dialog open, no error
  alert), and an absent element reads only as a count change. The gallery
  at `/calliope/specimens` shows every hook, variant value and state by
  construction, each on a stage addressable as
  `[data-specimen-for="<class>"] [data-specimen-stage="<mode>"]`. Spec H's
  notes give two cautions: a stage contains layout and paint and caps its
  height, so position and viewport measurements still need a live page; and
  the gallery's articles use `content-visibility: auto`, so each must be
  brought into view (or made visible) before it is measured.
- **About 180 `qt-*` classes on app surfaces are not hooks.** Spec H's
  Stage 1 found them and named the ones an author would reach for first:
  `qt-chat-message-content`, `qt-chat-layout`, `qt-chat-messages-list`, the
  roleplay text classes (`qt-chat-dialogue`, `qt-chat-narration`,
  `qt-chat-ooc`, `qt-chat-inner-monologue`) and `qt-chat-composer-actions`.
  Many of the rest are state classes already catalogued as states, or
  layout helpers. The inspector reports "no hook" on such an element, and
  the hook lint fails a bundled theme that targets one.
- **The catalogue is at version 1 with 174 hooks.** Spec C settled that
  adding a hook does not change the version; only a removal does. The
  gallery's coverage test fails for a hook with no specimen.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **Brace indentation applies everywhere the code editor is used.** Enter after `{` or `[` adds one indent unit; Enter between a brace pair puts the cursor on an indented line with the closing brace on its own line below; typing `}` or `]` on a line that holds only indentation removes one unit. It applies to JSON and CSS, in the theme editor and in Document Mode. Nothing is reformatted and no brace is inserted for the author. The alternative is to limit it to the theme editor's CSS section and leave Document Mode's typing as it is. | confirmed 2026-11-16 |
| 2 | **A class joins the catalogue when an author would target it and it names one kind of element.** Opus sorts the uncatalogued classes into: already a state of a hook; a layout or utility helper with no look of its own; internal plumbing; and candidates. Only candidates are proposed, each with a label, surface and reason, and the human approves the list at the stop before any is added. The alternative is to catalogue everything that is not a state or a helper, which would grow the contract by perhaps a hundred names that then cannot be renamed freely. | confirmed 2026-11-16 |
| 3 | The probe measures the gallery for everything about how a hook looks, and keeps a small number of live pages for layout: the shell, a Salon chat, and a page with a dialog open. | settled |
| 4 | The editor's layout responds to its container. No viewport breakpoint remains in `components/theme-editor/`. | settled |
| 5 | Each of the four parts is its own stage and can be accepted or dropped on its own. | settled |

## Constraints that apply throughout

- Commit nothing. Stop and report at the end of each stage.
- The dev server on port 3000 is the human's; do not kill it. Try things in
  the V4test instance on port 3005.
- The code editor's fidelity rule holds: a file opened and not edited is
  never saved, and the byte-for-byte tests keep passing.
- A hook added to the catalogue gets a specimen in the same change, and
  the hook lint, the coverage test and the generated `THEME_HOOKS.md` all
  pass. No hook is renamed or removed, and the catalogue version does not
  change.
- UI: `qt-*` classes for anything themed; WCAG 2.2 AA.
- User-facing copy is in the house voice; `docs/CHANGELOG.md` is plain.
- No stubs or `TODO` code.

## Stage 1 — brace indentation (decision 1)

- Pure functions beside the existing indent planners (`planIndent`,
  `planOutdent`), with unit tests: what Enter inserts given the text and
  the cursor, and whether a typed closing brace should outdent.
- Rules: a brace inside a string or a comment does not count (use the
  editor's own tokens to tell, not a second parser); the indent unit is the
  file's detected one; a selection is replaced first and then treated as a
  cursor.
- Undo takes back an Enter and its indentation in one step.
- Tests in both languages, with tabs and with spaces, including Enter
  between `{` and `}`, after `{` with text following, inside a string
  containing a brace, and `}` typed on an indented blank line.

**Stop.** Report.

## Stage 2 — layout by container (decision 4)

- Replace the viewport breakpoints in `components/theme-editor/`
  (`DraftEditor.tsx`'s navigation grid, `FontsSection.tsx`'s field grid,
  and any other found) with container queries, as `StylesSection.tsx`
  does. Below the width where navigation and body fit side by side, the
  navigation becomes a compact control above the body (a select or a
  disclosure) that still reaches every section.
- Check the specimen gallery and the inspector panel for the same fault
  and fix what is found.
- Screenshots of the editor at three pane widths — a narrow split, a half
  window and a full window — in the report.

**Stop.** Report.

## Stage 3 — the probe (decision 3)

- `scripts/theme-probe/run.ts`: add the gallery as a page. For each hook,
  variant value and state, measure its stage in light and in dark, making
  each article visible first. Keep the three live pages of decision 3 and
  drop the rest.
- `probe.js` gains a gallery mode that reads instances by their
  `data-specimen-*` attributes instead of taking the first visible match.
- `compare` reports an instance missing from one side as an error, since
  in the gallery nothing should ever be missing.
- Update `scripts/theme-probe/README.md`.
- Run it over the default theme and the six bundled themes and report how
  many instances were measured per theme, and how that compares with what
  the seven pages found before.

**Stop.** Report.

## Stage 4 — the catalogue (decision 2)

### 4.1 Triage

List every `qt-*` class in the app's markup that is not a hook, a
catalogued state or a variant, with where it is written, sorted into the
four groups of decision 2. For each candidate give the proposed label,
surface, description, and any variants or states. Write the list to a file
beside this spec.

**Stop.** The human approves, trims or extends the candidates.

### 4.2 Additions

For each approved class: the catalogue entry (`since` stays 1 unless the
version has moved), a specimen, and nothing else. Regenerate
`THEME_HOOKS.md`. Then run the hook lint over the bundled themes and
report any selector that was failing or excepted and now passes.

**Stop.** Report.

## Stage 5 — documentation

- `help/theme-editor.md` and the Document Mode help page: brace
  indentation, in a sentence each.
- `docs/developer/THEME_DEVELOPMENT.md`: the probe's new shape, if it is
  described there.
- `docs/CHANGELOG.md`.
- Mark this spec implemented, link it from the proposal, and move it and
  the triage list to `features/complete/`.

## Report back

At each stop: what was done, what differs from this spec and why, anything
found that the spec did not foresee, and the commands run with their
results. At the end, add an "Implementation notes" section to this file.

## Implementation notes

### Stage 1 — brace indentation (`236d0b2fd`)

- `planEnter` and `planCloseBracket` in `components/code-editor/text.ts` are
  the pure rules; the editor's `KEY_ENTER_COMMAND` handler and a `}` / `]`
  key handler call them. Braces in strings and comments are told apart by the
  editor's own highlight tokens (`$tokenTypeLookup`), not a second parser.
- Not foreseen: Prism's CSS selector pattern could start at a quote, so
  `content: "{";` read as a selector and a brace. The pattern may no longer
  start at a quote. A brace after a space inside a CSS string (`"a {"`) is
  still misread.
- The closing-brace step-out needs a key press; text that arrives without one
  (an on-screen keyboard, an input method, a paste) is left as typed.

### Stage 2 — layout by container (`5884f2d6f`)

- The editor's navigation and the gallery's switch at `@2xl` (42rem) rather
  than the `@3xl` the Custom CSS section uses: at half of a 1680px window the
  pane is about 750px, which `@3xl` put on the compact side.
- Below that width the list becomes a select above the body,
  `components/ui/SectionJump.tsx` ("Go to a section" / "Go to a surface"),
  which moves focus to the chosen section.
- The editor's field grids use container queries; the small control grids in
  `controls.tsx` are their own containers, so they answer to the width of the
  light or dark column they sit in. A grep-test
  (`container-layout.test.ts`) keeps viewport breakpoints out of
  `components/theme-editor/`.
- The inspector panel floats over the whole window and is sized to it, which
  is right for it; it was left alone.
- The compact select is not sticky; in a narrow pane it is reached by
  scrolling back up, as the stacked list was.

### Stage 3 — the probe (`fb7f36687`)

- Pages: the gallery, home, one Salon chat and the theme preview dialog.
  `--character` is gone; `--chat` takes one id.
- The gallery's instance items now carry `data-specimen-instance="<key>"`,
  and the coverage test checks each instance on its own stage.
- Not foreseen: the turn dot's opacity is animated, so two runs differed. In
  gallery mode the probe holds every animation at its start
  (`document.getAnimations()`). Live pages are left as before, so they still
  compare with older runs.
- Per theme and mode the gallery measured 415 of 415 instances with none
  missing, against 193 hook selectors the seven old pages reached between
  them (191 in Old School). The only selectors those pages measured that the
  gallery does not are two live values of the open `data-tool` variant.

### Stage 4 — the catalogue (`1389d312c`, `cc5336495`)

- The triage found 712 uncatalogued classes and 32 composed prefixes. A split
  the spec did not name — "inner parts, not proposed" (334 classes) — holds
  pieces of a component that have a look but are too small to promise.
- The human approved the 45 proposed candidates as proposed: Document Mode
  under `salon`, kinds written as classes (`qt-mention-chip-thing`,
  `qt-progress-fill-*`) as class states, and nothing from "worth
  considering", the roleplay palette included.
- The catalogue went from 174 to 219 hooks, still version 1, with 11 new
  state classes. The real `EmptyState` draws the empty-state family; the rest
  are markup. The probe now measures 471 instances per theme and mode, all
  present, and the 415 from before are unchanged.
- No bundled theme selector changed status: all five themes with custom CSS
  were already clean against the catalogue.
- Found along the way and fixed outside the spec (`1389d312c`): 13 `qt-*`
  classes the markup used and no CSS defined (`qt-input-sm`,
  `qt-button-danger` and others). `scripts/check-qt-classes.mjs` now fails on
  a bare class in app markup that is neither defined, catalogued, nor one of
  its listed markers, and runs under `tsx` to read the catalogue.

### Stage 5 — documentation

- The help pages took their brace-indentation sentences in Stage 1.
  `THEME_DEVELOPMENT.md` does not describe the probe, so it was not changed.

