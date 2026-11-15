# Calliope Live — Spec E: every token, by type

**Status:** ready to run, 2026-11-14 (design decisions confirmed by the human).
Implements the second slice of Phase 2 of [calliope-live.md](calliope-live.md).
Read, before starting:

- Spec D, [calliope-live-spec-d-live-preview.md](complete/calliope-live-spec-d-live-preview.md),
  with its implementation notes;
- Spec A, [calliope-live-spec-a-token-registry.md](complete/calliope-live-spec-a-token-registry.md);
- [THEME_DEVELOPMENT.md](../THEME_DEVELOPMENT.md) and the generated
  [THEME_TOKENS.md](../THEME_TOKENS.md);
- `components/theme-editor/model.ts`, which this spec extends.

**Scope:** `quilltap-server` only.

## Goal

The editor of Spec D edits 125 colours. This spec makes it edit the theme
document: every token an author is meant to set, each with a control that
suits its type, plus primitives and choices. At the end of this spec:

- every registry token with visibility `standard` or `advanced` can be set,
  reset and given a dark value in the editor;
- each token type has its own control, and every control can fall back to
  plain text for a value it cannot represent;
- a draft's primitives can be added, edited, renamed and removed, and any
  token can be pointed at one;
- the density choice can be set;
- the author can find a token by name, see only what the theme changes, and
  undo.

Nothing here changes what a theme can express. The theme document, the
engine's output and the drafts API stay as they are, apart from the small
additions listed in Stage 0.

## Out of scope

The specimen gallery and inspect mode (Spec F); the custom CSS editor,
importing a `.qtap-theme` file into a draft, font and image upload, the
manifest's fonts, icons and subsystems, and code highlighting in Document
Mode (Spec G); LLM assistance; layout variants; new tokens, new semantic
families or new contrast pairs; any change to a bundled theme.

## Where things stand

- **The registry has 704 tokens.**

  | Tier and visibility | Colour | Other | Total |
  |---|---|---|---|
  | semantic, standard | 125 | 14 | 139 |
  | component, standard | 162 | 77 | 239 |
  | component, advanced | 222 | 66 | 288 |
  | semantic, internal (not for authors) | 0 | 38 | 38 |

  The non-colour types among the 666 an author may set: length 61, radius
  29, shadow 12, font-family 12, font-weight 9, keyword 8, opacity 7,
  transition 6, image 3, raw 3, blur 2, font-style 2, z-index 2, duration 1.
- **10 tokens are optional** (unset means "what each place did before") and
  **25 vary with a choice** (`byChoice`). The only choice is `density`.
- **The editor's model is pure.** `components/theme-editor/model.ts` takes a
  tokens document and returns a tokens document; `DraftEditor.tsx` holds it
  in `useDraft`, previews through `setPreview`, and saves with debounced
  `PUT`s carrying the revision. `isEditableToken` is the one place that
  says what is shown: `color`, `semantic`, `standard`.
- **Rows know two sources**, default and theme. A value that comes from a
  choice is shown as a default.
- **Primitives are listed read-only.** The six bundled themes use them
  heavily (earl-grey has dozens of colour primitives), so a copy of one is
  mostly references the author cannot yet follow or change.
- **The type check is server-only.** `typeProblem` in
  `lib/themes/engine/validate.ts` decides whether a value fits a type, but
  that file imports the CSS scoper and so PostCSS; the editor's only
  client-side check is `parseColor`.
- **Keyword tokens have no list of allowed values.** The registry's
  `TokenDef` has no field for them, so a keyword token can only be a text
  field.
- `GET /api/v1/theme-drafts/[id]` returns the manifest as parsed JSON, so
  the fonts a draft declares are already available to the client. It does
  not return the draft's file list.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **Three levels, one search.** The editor shows *Essentials* (semantic, standard: 139 tokens) by default, *Components* (component, standard: 239) as a second level, and *Advanced* (288) behind a disclosure inside each component section. A search box finds a token at any level by label or name, and a "changed only" filter shows what the theme sets. Internal tokens are never shown. The alternative is one flat list of 666 with filters. | confirmed 2026-11-14 |
| 2 | **Fonts come from what the draft already has.** A font-family control offers the families the draft's manifest declares and a fixed list of system stacks, as an ordered fallback list. Adding a font file stays in Spec G, with image upload and the rest of the manifest. So a blank draft can use system fonts only until then; a copy of a bundled theme can use that theme's fonts. The alternative is to bring font upload (file, family, weight, style, licence) into this spec. | confirmed 2026-11-14 |
| 3 | **Removing a primitive in use writes its value into the tokens that used it.** The confirm dialog lists those tokens first. Renaming a primitive rewrites every reference to it. The alternative is to refuse removal while anything refers to the primitive, which leaves the author to repoint each token by hand. | confirmed 2026-11-14 |
| 4 | Every typed control has an "edit as text" form, and opens in it when the value is one the control cannot represent (`calc()`, `clamp()`, a reference with a fallback, several shadows it cannot parse). A control never rewrites a value it did not parse. | settled |
| 5 | The parsers and formatters behind the controls are pure functions in the engine (`lib/themes/engine/values/`), not in the components, so the same code can serve the CLI and the LLM step later. | settled |
| 6 | The type check moves to a browser-safe module and the editor shows, per control, the same message the server would return. The server remains the judge on save. | settled |
| 7 | Keyword tokens gain `options` in the registry, and validation refuses a value outside them. If any bundled theme then fails, stop and report; do not widen the list to fit. | settled |
| 8 | A dark value apart from light is offered for every type, behind a per-row action, as it is for colour. Most non-colour tokens will never use it. | settled |
| 9 | Undo and redo cover the tokens document for the editing session (in memory, per open draft, lost on reload). Saves are not undone on the server; an undo is a new save. | settled |
| 10 | Image tokens (3) offer `none` or an image file already in the draft. Upload is Spec G. | settled |

## Constraints that apply throughout

- Commit nothing. Stop and report at the end of each stage.
- The dev server on port 3000 is the human's; do not kill it. Try things in
  the V4test instance on port 3005.
- Whatever the browser imports from the engine goes through
  `lib/themes/engine/client.ts`; the import-graph test must keep passing.
- The model stays pure: every edit is a function from a tokens document to
  a tokens document in `components/theme-editor/model.ts` or the engine,
  with unit tests. Components call them; they do not build documents.
- The preview still reaches the DOM only through `setPreview`.
- UI: `qt-*` classes only, `BaseModal` for dialogs, an accessible name on
  every control, keyboard operation for every control (a slider or stepper
  is never the only way to set a value), WCAG 2.2 AA for the editor itself.
- User-facing copy is in the house voice; `docs/CHANGELOG.md` is plain.
- No stubs or `TODO` code. Debug logging on any new backend path.
- After any engine change: `npm run build:cli-theme-engine`.

## Stage 0 — engine and registry

### 0.1 Type check in the browser

Move `typeProblem` and what it needs out of `validate.ts` into a module
that does not reach PostCSS, export it from `client.ts`, and have
`validate.ts` import it. No behaviour change.

### 0.2 Value parsers

`lib/themes/engine/values/`, one small module per shape, each with
`parse(value) → structure | null` and `format(structure) → value`:

| Shape | Structure | Used by types |
|---|---|---|
| length | number and unit, or a keyword | length, radius (one to four parts), blur (the argument of `blur()`) |
| shadow | a list of layers: inset, x, y, blur, spread, colour | shadow |
| font stack | an ordered list of family names | font-family |
| transition | a list of property, duration, easing, delay | transition |
| duration, opacity, number | a number and its unit | duration, opacity, z-index, font-weight |

Rules for all of them: `parse` returns null for anything it does not fully
understand (decision 4); `format(parse(v))` renders the same as `v` for
every value it accepts; a `var()` reference in a part is kept as written.
Test each against every default and every bundled theme's value of the
types it serves, and report how many values of each type parse.

### 0.3 Keyword options (decision 7)

Add `options?: readonly string[]` to `TokenDef`, fill it for the eight
keyword tokens, write it into the generated `THEME_TOKENS.md`, and have the
type check refuse anything else. Regenerate what the registry generates.

### 0.4 Primitive edits

Pure functions over a tokens document, in the engine:

- add, set value, set or clear dark value, change type;
- rename: rewrites `var(--p-<old>)` in every token and primitive value,
  including inside a longer value; refuses a name that is taken or is not
  kebab-case;
- remove (decision 3): substitutes the primitive's value — light into light,
  dark into dark, creating a token's dark value where the primitive had one
  and the token did not;
- `primitiveUsers(document, name)`: the tokens and primitives that refer to
  it.

### 0.5 What the client needs from a draft

`GET /api/v1/theme-drafts/[id]` also returns the draft's image files (path
and type), for decision 10.

**Stop.** Report, with the parse counts of 0.2.

## Stage 1 — the editor's structure

No new controls yet: every non-colour token gets the plain text control,
checked by the type check of 0.1. This stage is about holding 666 rows.

- **Levels (decision 1).** Replace `isEditableToken` and `EDITOR_SECTIONS`
  with a model that gives, per registry group, its essential, component and
  advanced tokens. Groups keep registry order and labels.
- **Navigation.** A list of sections beside the rows; choosing one scrolls
  to it. The section list shows how many tokens in each the theme changes.
- **Search.** Matches label, name and description, across all levels,
  ignoring case; a match in a closed section or behind the advanced
  disclosure is shown.
- **Changed only.** Shows the tokens and primitives the theme sets.
- **One row component.** `ColorTokenRow` becomes a `TokenRow` that owns
  what every row shares — label, help, source, "follows", reset, the dark
  value action, the type-check message, the contrast readout for colours —
  and takes its control from a map keyed by token type. A type with no
  control in the map gets the text control.
- **Sources.** A row says where its value comes from: the default, a
  choice (naming the choice and option), this theme, or another token or
  primitive it follows. An optional token that is unset says so.
- **Following.** Any row can be pointed at a primitive of its own type, or
  set back to a literal.
- **Choices.** A section at the top for the registry's choices; setting
  density repaints at once and the rows it governs show the new source.
- **Undo and redo (decision 9)**, as buttons and the usual keys while focus
  is in the editor and not in a text field that has its own undo.
- **Cost.** The editor must stay responsive with every section open: do
  not mount rows that are off screen or in a closed section, and keep a
  keystroke in one row from re-rendering the others. Measure a colour drag
  with all levels open and report the frame time.

**Stop.** Report. The human may look at the structure here.

## Stage 2 — controls

One control per type, each built on its Stage 0 parser, each with the text
form of decision 4:

| Type | Control |
|---|---|
| length, radius | number field with a unit select; keywords where the type check allows them; radius can be split into four corners |
| shadow | a list of layers, each with offsets, blur, spread, colour (the colour control) and inset; add, remove, reorder; a "none" state |
| font-family | an ordered list of families chosen from the draft's fonts and the system stacks (decision 2), with a sample line rendered in the result |
| font-weight | a select of the named and numeric weights; when the first family in force is one of the draft's fonts, mark the weights that font declares |
| font-style, keyword | a select of the options |
| duration | number with ms or s |
| transition | a list of property, duration, easing, delay |
| opacity | number 0–1 or percent, with a slider |
| blur | a length inside `blur()` |
| image | `none` or one of the draft's images (decision 10), with a thumbnail |
| z-index | integer |
| raw | text |

Then the primitives panel, replacing the read-only list:

- add (name, type, value), edit value and dark value with the control for
  its type, rename, remove (decision 3, behind an `alertdialog` that lists
  the users);
- each primitive shows how many tokens follow it; choosing that shows them.

### Tests and proof

- Unit tests for every model function; component tests for each control:
  it shows a parsed value, writes a formatted one, falls to text for an
  unparseable one and leaves it untouched.
- In V4test: copy each of two bundled themes and, without editing, open
  every section at every level and confirm the saved `tokens.json` has not
  changed. Then make one edit of each type and confirm the app repaints and
  the draft still validates and installs.
- `npm run lint`, `npx tsc`, the theme snapshot check and the unit suite
  pass.

**Stop.** This stop is the human's hands-on review.

## Stage 3 — documentation

- `help/theme-editor.md`: the levels, search, the controls, primitives,
  density, undo.
- `docs/developer/THEME_DEVELOPMENT.md`: keyword options; what the editor
  can and cannot set.
- `CLAUDE.md`, Themes section: `lib/themes/engine/values/` as the one place
  a token value is parsed or formatted, and the model as the one place a
  tokens document is edited.
- `docs/CHANGELOG.md`.
- Mark this spec implemented, link it from the proposal, and move it to
  `features/complete/`.

## Report back

At each stop: what was done, what differs from this spec and why, anything
found that the spec did not foresee, and the commands run with their
results. At the end, add an "Implementation notes" section to this file,
and in it a list of what Specs F and G should know — in particular how a
new section (specimens, custom CSS, the manifest) would join the editor's
navigation.
