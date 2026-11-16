# Calliope Live — Spec H: the specimen gallery and inspect mode

**Status:** ready to run, 2026-11-16 (design decisions confirmed by the human).
Implements the last slice of Phase 2 of [calliope-live.md](calliope-live.md).
Read, before starting:

- Spec G, [calliope-live-spec-g-custom-css.md](complete/calliope-live-spec-g-custom-css.md),
  especially "For Spec H" in its implementation notes;
- Spec B, [calliope-live-spec-b-hook-catalogue.md](complete/calliope-live-spec-b-hook-catalogue.md),
  and the generated [THEME_HOOKS.md](../THEME_HOOKS.md);
- Spec D's implementation notes on the nested-theme boundary
  ([calliope-live-spec-d-live-preview.md](complete/calliope-live-spec-d-live-preview.md));
- `lib/themes/hooks/`, `components/theme-editor/assets/styles-model.ts`
  and `scripts/theme-probe/README.md`.

**Scope:** `quilltap-server` only.

## Goal

The editor can now change everything a theme holds, but an author still
has two blind spots. They see a change only on whatever the app happens to
be showing, so a danger badge, an empty state or a dialog goes unchecked
until it turns up. And looking at the app, they cannot tell what a thing is
called: which hook to target, which token gives it its colour. At the end
of this spec:

- a **specimen gallery** shows every catalogued hook, in each of its
  variants and states, wearing the draft being edited;
- **inspect mode** lets the author point at any element of the running app
  and see the hook it carries, the tokens that style it and their values,
  and go from there to the token's row or to a CSS rule for it.

## Out of scope

LLM assistance; layout variants; the Storybook package and its stories
(Phase 3 settles its role; nothing here changes it); new hooks, tokens or
contrast pairs, except a hook the gallery shows to be missing from the
catalogue, which is reported and not added; a visual CSS rule editor;
editing a value from the inspector itself (it links to the row); the
auto-indent after `{` and the `css` native text type noted in Spec G.

## Where things stand

- **The catalogue has 174 hooks** over nine surfaces: app shell 9,
  workspace 14, home 13, sidebar 11, Salon 32, character 11, dialog 8,
  settings 16, common 60. 14 have variants and 23 have states. It is
  importable by the client, and `hookSelectors(hook)` already lists every
  way a hook can be written.
- **The preview is app-wide in one browser window.** `setPreview` puts the
  draft on `<html>`, so every workspace tab in that window wears it. The
  editor's own panel sits in a nested element wearing the default theme,
  and the engine's `@scope` boundary keeps a theme's custom CSS out of a
  nested theme.
- **The editor can be handed things.** Sections open by id
  (`goToSection`), search narrows the token rows, the CSS section inserts
  at the cursor through a `CodeEditorHandle`, and an issue can reveal its
  line. Token rows have no stable DOM id.
- **Values in force are known without measuring**: `ResolvedTheme` holds
  every token's value and source for light and dark.
- **A probe already walks the catalogue on a page.** `scripts/theme-probe/`
  measures the first visible element of each hook, variant and state, but
  only on seven real pages, and it reports many hooks as absent because
  those pages do not show them.
- **The Storybook package has 20 story files of hand-written markup**
  (`packages/theme-storybook/src/stories/components/`). They are not app
  components and are not used by the app.
- **Nothing maps an element to the tokens that style it.** The registry
  knows tokens and the catalogue knows hooks; the link between them exists
  only in the app's CSS.

## Decisions

| # | Decision | Status |
|---|---|---|
| 1 | **The gallery is a workspace tab of its own.** A new tab kind, `theme-specimens`, with the route `/calliope/specimens`, opened from the editor. It wears the preview like any other tab, so it sits beside the editor in a split and repaints as the author works. The alternative is a section inside the editor, in a nested element wearing the draft, which keeps one tab but squeezes specimens into the editor's narrow pane. | confirmed 2026-11-16 |
| 2 | **A specimen is the real component where that is cheap, and markup where it is not.** A component that renders from props alone, with no request and no app context, is used as it is, with fixture props. Anything else is hand-written markup carrying the same hooks. A test holds the gallery to the catalogue: every hook, every closed variant value and every state must appear, so a hook added to the catalogue without a specimen fails. The alternative is markup throughout, which is quicker to write and drifts from the app. | confirmed 2026-11-16 |
| 3 | **Inspect mode reads the page's own stylesheets.** For the element under the pointer it finds the rules that match it, collects the custom properties their declarations use, and follows each through the resolved theme to the token an author would change. It needs no generated map and it sees the theme's own custom CSS as well as the app's. The alternative is a map from hook to tokens generated from the app's CSS at build time, which is checkable in lint but cannot see what actually applies to one element in one state. | confirmed 2026-11-16 |
| 4 | Inspect resolves to the nearest element that carries a catalogued hook, at or above the one pointed at, and says when the element itself carries none. | settled |
| 5 | The inspector shows and links; it does not edit. A token opens its row in the editor; a hook inserts a selector into the CSS section through the existing insert path, offering to begin a stylesheet first when there is none. | settled |
| 6 | Pointer inspection has a keyboard equivalent: from the gallery and from the hook list, "inspect this" shows the same panel for a specimen or the first matching element on the page. | settled |
| 7 | The gallery lives in the app (`components/theme-specimens/`). The Storybook package is not touched and does not consume it; that is Phase 3's question. | settled |
| 8 | Hover and focus cannot be forced on an element. Specimens show states that are classes or ARIA attributes as separate instances, and say that hover and focus show on interaction. The inspector lists the rules that would apply on hover and focus, labelled as such. | settled |

## Constraints that apply throughout

- Commit nothing. Stop and report at the end of each stage.
- The dev server on port 3000 is the human's; do not kill it. Try things in
  the V4test instance on port 3005.
- The preview still reaches the DOM only through `setPreview`. The gallery
  and the inspector read the preview; they do not apply one.
- The inspector's own overlay and panel sit in a nested element wearing the
  default theme, like the editor's panel, so no draft can make them
  unreadable or restyle them.
- Inspect mode changes nothing in the app while it is on beyond
  intercepting the pointer: a click that selects an element must not also
  activate it, and leaving inspect mode leaves no listener, class or
  attribute behind. It never reads or shows the text content of what it
  points at, only classes, attributes and styles.
- Opening the gallery from the editor inside the workspace uses `openTab`
  in place, never a route change.
- Specimens make no request and write nothing. Fixture data is invented
  and obviously so; no real character, chat or file is read.
- UI: `qt-*` classes only for anything themed, `BaseModal` for dialogs, an
  accessible name on every control, WCAG 2.2 AA for the gallery's chrome
  and the inspector. The specimens themselves are exempt from contrast
  rules, since showing a draft's contrast is their job.
- User-facing copy is in the house voice; `docs/CHANGELOG.md` is plain.
- No stubs or `TODO` code. Debug logging on any new backend path (none is
  expected).

## Stage 0 — the inspector's model

Pure functions, with unit tests, in `components/theme-inspect/model.ts`
(DOM-reading helpers apart from the logic so the logic tests without a
browser):

- **Element to hook.** Given an element's class list and attributes, and
  its ancestors', return the nearest `HookDef`, the variant values and
  states present on it, and the selector from `hookSelectors` that matches
  what is present (decision 4).
- **Rules to properties (decision 3).** Given the rules that match an
  element — selector, declarations, and which stylesheet they came from —
  return the custom properties used, per CSS property, in cascade order.
  Rules whose selector matches only with `:hover`, `:focus`,
  `:focus-visible` or `:active` removed are kept and labelled with that
  state (decision 8). A property set by a rule from the theme's own custom
  CSS is marked as such.
- **Property to token.** Follow a custom property through the resolved
  theme: the component token, the semantic token or primitive it follows,
  the value in force for the mode, and whether the theme sets it. A
  property that is not a registry token is shown by name only.
- **The DOM side**: one function that walks `document.styleSheets` and
  returns the matching rules for an element. It must tolerate a stylesheet
  it cannot read, rules inside `@media`, `@supports`, `@layer`, `@container`
  and `@scope`, and must not be run on pointer move, only on selection.
  Measure it on a Salon page and report the time.
- Give `TokenRow` a stable id from the token name, and the editor a
  `goToToken(name)` that opens the level and section, scrolls to the row
  and focuses it.

**Stop.** Report, with the measurement.

## Stage 1 — the gallery

- Tab kind `theme-specimens` and route `/calliope/specimens` (decision 1),
  following `theme-editor` end to end. An "Open the gallery" control in
  the editor; in the workspace it opens beside the editor.
- One page section per surface, in catalogue order, with a navigation list
  and a search over hook labels and class names.
- Each specimen shows the element, its label, its class, and one instance
  per variant value and per state (decision 8). Compound things are shown
  whole where a part means nothing alone: a message bubble inside a
  message row, a dialog's header, body and footer together.
- Real components where decision 2 allows; list in the report which hooks
  are real components and which are markup.
- A mode switch for the gallery alone, and — if a nested element wearing
  the draft with the other mode's class resolves correctly — light and dark
  side by side. Verify that first; if it does not hold, keep the single
  switch and say why.
- With no draft being edited, the gallery shows the theme being worn, so it
  is useful on its own.
- **Coverage test (decision 2):** render the gallery and assert that every
  hook's class, every closed variant value and every class or ARIA state
  in the catalogue is present. A hook that cannot sensibly be shown is
  listed in the test with a reason; expect very few.
- Anything the gallery reveals — a hook in the catalogue that no longer
  exists in the app, an element in the app with no hook — goes in the
  report, not into the catalogue.

**Stop.** Report, with screenshots of the gallery in two bundled themes.

## Stage 2 — inspect mode

- A provider beside `ThemeProvider` holds whether inspect mode is on and
  what is selected, so the editor tab, the gallery tab and the rest of the
  app agree. An "Inspect" toggle in the editor and in the gallery; Escape
  turns it off.
- **While on:** moving the pointer outlines the nearest hooked element and
  names it; a click selects it and is not passed to the app. The editor's
  own panel and the inspector are not inspectable.
- **The panel**, for the selection:
  - the hook: label, description, class, the variants and states present,
    and the surface it belongs to; or a plain statement that this element
    has no hook, with the nearest one above it;
  - the tokens that style it, grouped by what they set (background, text,
    border, shadow, radius, spacing, type), each with its value for the
    current mode, a swatch for a colour, the token it follows, and whether
    this theme sets it. Choosing one calls `goToToken`;
  - the same for hover and focus, labelled;
  - rules from the theme's own custom CSS that apply, marked as the
    author's own;
  - "Write CSS for this": inserts the matching selector into the CSS
    section through the existing insert path (decision 5).
- **Keyboard path (decision 6):** "Inspect this" on every specimen and on
  every entry of the CSS section's hook list.
- "Show in the gallery" from the panel, and "show on this page" from a
  specimen, which outlines the matching elements in the current tabs.
- Tests: the provider's on and off leave no listener or attribute behind;
  a click while inspecting does not reach the element; the panel for a
  hooked element, an unhooked one, one with a state, and one styled by
  custom CSS; `goToToken` and the CSS insert are called with the right
  arguments.
- In V4test: with a copy of a bundled theme open, inspect a Salon message
  bubble, a sidebar item, a dialog and a settings card; from each, go to a
  token and change it, and insert a rule and see it apply. Confirm inspect
  mode works in the gallery tab and that the inspector stays readable under
  a deliberately unreadable draft.
- `npm run lint`, `npx tsc`, the theme snapshot check and the unit suite
  pass.

**Stop.** This stop is the human's hands-on review.

## Stage 3 — documentation

- `help/theme-editor.md`: the gallery and inspect mode, with the keyboard
  path.
- `docs/developer/THEME_DEVELOPMENT.md`: how to add a specimen when adding
  a hook, and the coverage test that asks for it.
- `CLAUDE.md`, Themes section: a new hook needs a specimen; inspect mode
  reads stylesheets at selection time and never on pointer move.
- `docs/CHANGELOG.md`.
- Mark this spec implemented, link it from the proposal, and move it to
  `features/complete/`.

## Report back

At each stop: what was done, what differs from this spec and why, anything
found that the spec did not foresee, and the commands run with their
results. At the end, add an "Implementation notes" section to this file
with what the LLM-assistance step and Phase 3 should know: whether the
gallery could stand in for the Storybook stories, whether
`scripts/theme-probe` should measure the gallery instead of seven live
pages, and what an assistant would need from the inspector's model to be
told what a hook is styled by.
