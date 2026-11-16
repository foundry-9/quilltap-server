# Calliope Live — Spec H: the specimen gallery and inspect mode

**Status:** implemented 4.14-dev, 2026-11-16 (Stages 0–1 in `141df9f06`, Stage 2 in `68789c967`, Stage 3 documentation; user docs [help/theme-editor.md](../../../../help/theme-editor.md)).
Implements the last slice of Phase 2 of [calliope-live.md](../calliope-live.md).
Read, before starting:

- Spec G, [calliope-live-spec-g-custom-css.md](calliope-live-spec-g-custom-css.md),
  especially "For Spec H" in its implementation notes;
- Spec B, [calliope-live-spec-b-hook-catalogue.md](calliope-live-spec-b-hook-catalogue.md),
  and the generated [THEME_HOOKS.md](../../THEME_HOOKS.md);
- Spec D's implementation notes on the nested-theme boundary
  ([calliope-live-spec-d-live-preview.md](calliope-live-spec-d-live-preview.md));
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

## Progress

### Stage 0 — done 2026-11-16 (uncommitted)

- `components/theme-inspect/model.ts` (pure): `hookForChain` / `describeHook`
  (element to hook, decision 4); `inspectProperties` over `MatchedRule`s
  (cascade: `!important`, the style attribute, layer order, specificity,
  document order; hover / focus / active kept apart; `fromCustomCss`);
  `traceProperty` (Tailwind names read as their semantic token, defaults
  written as `var(--color-*)` followed through); helpers
  `splitSelectorList`, `parseDeclarations` (from `style.cssText`, which
  keeps `var()` shorthands), `varsIn`, `specificity`, `stripInteraction`,
  `propertyCategory`.
- `components/theme-inspect/dom.ts`: `elementFacts` / `elementChain` (classes
  and attributes, never text) and `matchingRules` (every stylesheet;
  unreadable sheets counted; `@media` / `@supports` evaluated, `@container`
  always walked, `@layer` order recorded, `@scope` root and limit honoured,
  nested rules resolved; the theme's style element told apart: token block,
  icon overrides, custom CSS).
- `tokenLocation` / `tokenRowDomId` (editor model), a stable id and
  `tabIndex=-1` on `TokenRow`, a slot id on `LazyRow`, and `goToToken` on
  `DraftEditor`, published through an optional `navigatorRef`
  (`EditorNavigator`) for Stage 2's provider.
- **Measured** in V4test, Salon chat with two messages, theme
  `spec-f-lato-parlour`, 5 stylesheets, 4,114 rules: `matchingRules` takes
  9–33 ms per element (median 9–22 ms; a message row 22 ms, a bubble 31 ms,
  a left-rail item 13–20 ms); the model then takes under 1 ms. Fine for a
  click, far too slow for pointer move — as the spec requires.
- Found: a rule's selector is kept as written, `:hover` included, so its
  specificity is right and it reads as what to write. A universal
  `:focus-visible` rule makes "focus" appear for nearly every element; the
  panel should say so plainly rather than hide it. The draft's custom CSS
  carries no line mapping back to `styles.css` once compiled, so "jump to
  the rule's line" needs the compiler to keep one (not done).

### Stage 1 — done 2026-11-16 (uncommitted)

- Tab kind `theme-specimens` (`TAB_KINDS`, tab meta "Calliope's Specimens",
  `TabView`, `route-to-intent`, `/calliope/specimens` → workspace redirect).
  Adding the kind adds a `data-tab-kind` value, so `THEME_HOOKS.md` and the
  CLI's theme-engine bundle were regenerated. **Open the gallery**
  (`OpenGalleryButton`) sits in the editor's header and the draft list; in the
  workspace it opens the tab in the other pane (splitting if need be).
- `components/theme-specimens/`: `instances.ts` (pure: an instance per
  closed variant value, one sample for an open set, one per class state and
  per ARIA state value; the props the hooked element wears), `types.ts`,
  `registry.ts` (no fallback), `specimens/{shell,salon,pages,common}.tsx`,
  `SpecimenGallery.tsx`; the view is `app/calliope/specimens/SpecimenGalleryView.tsx`.
- Each instance is drawn on a **stage**: `data-theme` of the shown theme (the
  preview's id, else the worn theme), the mode's class, and the root's
  `data-qt-<choice>` attributes copied (not its feature attributes, which
  would paint page backgrounds into stages). Stages contain layout and paint,
  so the dialog backdrop and full-height shell stay inside them. Articles use
  `content-visibility: auto` (415 stages; 830 side by side).
- **Light and dark side by side holds**: in V4test the dark stage's
  `--theme-card` equalled the window's dark value exactly, and the light
  stage resolved to the theme's light value. Kept as a fourth mode choice
  ("Side by side") beside "As the window", "Light" and "Dark".
- **Real components**: `CollapsibleCard` (the settings card's first
  instance), `EmptyState` (`qt-empty-state-title`), `QuillAnimation`
  (`qt-thinking-indicator`, and the streaming bubble's mark). **Everything
  else is markup** — 171 of 174 hooks. Most hooks are drawn by components
  that read the workspace, router, chat or server; `BaseModal` portals to the
  body; `SectionCard` and `CollapsibleCard` write DOM ids (the card's
  `data-card` instances are therefore markup, so they cannot collide with an
  open Settings tab).
- **Coverage test** `__tests__/unit/components/theme-specimens/coverage.test.tsx`:
  every hook has a specimen and none is stale; within each hook's own
  article, every instance selector matches; every instance is on a stage;
  no DOM id inside a stage. `NOT_SHOWN` is empty.
- **Found:**
  - *The page theme leaked into nested theme containers* — **fixed
    2026-11-16, after the Stage 1 stop**. Two causes. (1) Optional tokens
    (`--qt-button-text-transform`, the heading and scrollbar hooks, …) are
    never declared by the defaults, so an element wearing
    `data-theme="default"` under a page wearing Art Deco inherited Art Deco's
    values. The generator now emits
    `:where([data-theme]:not(:root)) { --opt: initial; … }` at the end of
    `_theme-defaults.css` (`renderOptionalReset` in
    `lib/themes/registry/emit-css.ts`): guaranteed-invalid, so each reader's
    fallback applies, at specificity 0 so a theme's own `[data-theme="id"]`
    value still wins on a stage wearing it. (2) `font-family` (from `<body>`),
    `font-weight` and `color-scheme` (from `:root`) are computed once with the
    page theme's tokens and inherited; `_base.css` now re-establishes them on
    `[data-theme]:not(:root)` in `@layer base`, so any utility still
    overrides. Effect: the Atelier panel and the gallery's chrome wear the
    house default's type; a gallery stage and a Settings theme preview wear
    their own theme's body font. Registry test: the reset lists exactly the
    optional tokens, and "never declares an optional hook" now allows only
    `initial`. Storybook CSS regenerated, `@quilltap/theme-storybook` 1.0.123.
    Theme snapshot unchanged.
  - No catalogued hook is missing from the app (the hook lint agrees). About
    180 surface-prefixed `qt-*` classes in the markup are not hooks (many are
    state classes catalogued as states); candidates a theme author would
    reach for include `qt-chat-message-content`, `qt-chat-layout` /
    `qt-chat-messages-list`, the roleplay text classes (`qt-chat-dialogue`,
    `qt-chat-narration`, `qt-chat-ooc`, `qt-chat-inner-monologue`) and
    `qt-chat-composer-actions`. Reported, not added.

### Stage 2 — done 2026-11-16 (uncommitted)

- `InspectProvider` (`components/theme-inspect/InspectProvider.tsx`) sits
  inside `ThemeProvider` in `session-provider.tsx` and holds the mode, the
  selection, the report, the outlines and the two bridges. Its layer portals
  to the body inside `data-theme="default"` + the window's mode +
  `data-inspect-ignore`. `InspectToggle` is in the editor's header and the
  gallery's toolbar; Escape turns the mode off and keeps the selection.
- **Listeners are on `window`, in capture**, not `document`: the
  workspace's link interceptor is a `document` capture listener registered
  earlier, and in V4test a click on a rail link while inspecting opened
  Characters before the inspector saw it. On the window they run ahead of
  every document-level capture listener. Swallowed: pointer down/up, mouse
  down/up, click, dblclick, auxclick (default prevented, propagation
  stopped); a click chooses. All are removed when the mode goes off.
- **What may not be inspected** is marked: `data-inspect-ignore` on the
  editor's panel, the gallery view and the inspector's layer;
  `data-inspect-target` on a specimen's stage reopens it inside the
  gallery (the nearer marker wins, `isInspectIgnored` in `dom.ts`).
  "Show on this page" and "Inspect this" from the reference skip ignored
  zones and stages.
- **The report** (`report.ts`) is built in the frame after the commit that
  changed the selection, the draft's resolved theme or `themeRevision`,
  never on pointer move; the pointer only walks classes. With no draft open
  it traces against the registry defaults and says so instead of naming
  sources. Values shown are the browser's computed value on the hooked
  element. The outline follows the hooked element, not the descendant
  clicked.
- **The panel** (`InspectPanel.tsx`): hook, surface, depth note, variants,
  states, other hooks on the element, a selector picker from
  `hookSelectors`, "Write CSS for this" (begins a stylesheet first when the
  draft has none), "Show in the gallery"; token groups by category with
  swatch, value, chain and source, each with "Row"; a collapsed section per
  interaction state; "Your own CSS that applies" with selectors as authored
  (the compiler's `:scope ` taken off — `authoredSelector`). It docks on the
  side away from the editor's panel (`data-inspect-editor`), re-docks after
  "Row" or "Write CSS" brings the editor forward, and has a button to move
  it. It never shows the inspected element's text.
- **The editor bridge** (`DraftEditor`): `goToToken` and `writeCss` first
  bring the editor's tab to the front of its pane (the gallery may be over
  it); `writeCss` clears the filter, opens Custom CSS and inserts
  `selector { }` at the stylesheet's caret through a new `insertRef` on
  `StylesSection` (the same `insertAtCursor` the reference uses);
  `beginStylesheet` is the existing `set-styles-file` operation; the
  gallery opens in the pane beside the editor's own
  (`useOpenSpecimenGallery`, now pane-of-the-calling-tab rather than
  focused pane). The **gallery bridge** reveals a specimen (clears the
  search, scrolls until the position holds — `content-visibility` above it
  settles late — and focuses its heading); a gallery opened by "Show in the
  gallery" is handed the hook when it registers.
- **Keyboard path:** "Inspect this" and "Show on this page" on every
  specimen (hidden when there is no provider); "Inspect this" on every hook
  in the CSS section's reference, which, when nothing on the page wears the
  hook, says so and offers the gallery.
- `scripts/check-modal-shell.mjs`: `components/theme-specimens/specimens/pages.tsx`
  allowlisted (it draws the dialog hooks in a stage; Stage 1's lint ran
  before the file was tracked, so the gate never saw it).
- **Tests:** `inspect-mode.test.tsx` (every capture listener the mode adds is
  removed and no attribute is left on `html` / `body`; a click while
  inspecting reaches neither the element nor an earlier document capture
  listener, and the ignored zone still works; showing in the gallery opens
  it through the editor and the gallery reveals the hook when it registers;
  the panel for a hooked element via a descendant with `goToToken` and
  `writeCss` arguments, the begin-a-stylesheet path, an unhooked element
  without a draft, a hover state, and custom CSS), and `customCssRules` in
  `model.test.ts`.
- **V4test** (port 3005, draft "Blank Atelier Test", Salon on the left,
  Atelier on the right): inspected a Salon bubble
  (`qt-chat-message-assistant`, two levels up), a rail item, a real dialog
  (Create Group, through the reference's "Inspect this"; the panel stays
  usable over the modal and the dialog does not close) and specimens in the
  gallery. "Row" focused `--qt-chat-assistant-bg` and `--theme-foreground`;
  changing Foreground's dark value turned the page orange and the panel
  re-read it as "Set by this theme" while its own text stayed in the house
  default. "Write CSS for this" began a stylesheet and inserted the rule;
  typing `outline` into it outlined the rail item and the panel listed the
  rule as the author's own. Undone and the stylesheet removed afterwards; no
  preference changed. A settings card was not tried by hand (the panel path
  is the same; `CollapsibleCard` is covered by the gallery).
- **Differs from the spec:** while the pointer is over an element its
  `:hover` rules match for real, so the panel lists them in the base group
  (the walker reports what matches now). Escape leaves the selection open.
- Commands: `npx tsc` clean; `npm run lint` clean; theme snapshot unchanged;
  `npm run test:unit` 1,512 suites / 21,544 tests passed.

### Stage 3 — done 2026-11-16

- `help/theme-editor.md`: "The specimen gallery" (Stage 1) and "Inspecting
  what you see" (Stage 2, with the keyboard path) checked against what was
  built.
- `docs/developer/THEME_DEVELOPMENT.md`: adding a hook means adding a
  specimen, and the coverage test that asks for it (under "Hooks and
  `hooksVersion`"); the gallery and inspect mode under "Drafts and the
  Atelier".
- `CLAUDE.md`, Themes: a new hook needs a specimen; the inspector reads
  stylesheets only on selection, never on pointer move.
- `docs/CHANGELOG.md`; this spec marked implemented, moved to
  `features/complete/` and linked from the proposal.

## Implementation notes

What the LLM-assistance step and Phase 3 should know.

### Could the gallery stand in for the Storybook stories?

For a theme author checking a theme, yes, and better: it shows all 174 hooks
in every variant and state under the real compiled theme, in both modes at
once, inside the running app, where Storybook shows a hand-kept subset under
a CSS copy (`@quilltap/theme-storybook`'s `qt-components.css` is generated
from the app's styles, but the stories are not). It cannot replace the
package for someone writing a theme *outside* a Quilltap instance, which is
what the published Storybook is for. And it is not component documentation:
171 of the 174 specimens are markup carrying the hook's classes and
attributes, not the components that render them (most read the router,
workspace, a chat or the server; `BaseModal` portals; some write DOM ids).
So: retire the theme-facing stories in favour of the gallery once Phase 3
decides the external authoring path; keep Storybook for components if it is
kept at all.

### Should `scripts/theme-probe` measure the gallery instead of seven live pages?

For hook coverage, yes. The probe records "the first visible element of
every catalogued hook (and of each variant value and state)" and today finds
many of them missing on the seven pages (no dialog open, no whisper, no
error alert), so a missing element reads as a count change. On
`/calliope/specimens` every hook and instance is present by construction
(the coverage test guarantees it), each on a stage that is easy to address
(`[data-specimen-for="<class>"] [data-specimen-stage="<mode>"]`), in both
modes in one page with "Side by side". Two cautions: a stage contains layout
and paint and caps its height, so anything measuring position or viewport
size (the shell, fixed overlays, sticky headers) still needs a live page;
and articles use `content-visibility: auto`, so the driver must scroll each
into view (or the probe must set `content-visibility: visible` on them)
before measuring. Keep two or three live pages for layout and use the
gallery for everything else.

### What an assistant needs from the inspector's model

`hookForChain`, `inspectProperties`, `groupTokenUses`, `traceProperty` and
`customCssRules` are pure, client-safe and indifferent to where the rules
came from; only `matchingRules` needs a DOM. To tell an assistant "what is
this hook styled by" without a user pointing at anything:

- run `buildInspectReport` on each hook's base specimen in the gallery (a
  browser pass, like the probe) and keep the result as a static table, hook →
  property → token names (plus the hover/focus/press groups). The table
  depends on the app's stylesheets, not on any theme, so it can be generated
  at build time and checked for staleness the way `THEME_HOOKS.md` is;
- give the assistant, per hook, that table joined with `traceProperty`
  against the draft being edited (value, what it follows, whether the theme
  sets it) — the same rows the panel shows, as text;
- the assistant should prefer a token change when the property is read
  through a token the hook owns, and propose custom CSS only when the
  property is set by a literal or a shared token whose change would reach
  other hooks; `inspectProperties` already tells the two apart (`vars` empty
  versus present) and `fromCustomCss` marks the theme's own rules.

### Smaller things found

- While the pointer is over an element its `:hover` rules match for real,
  so they appear in the base group; a "freeze state" (strip `:hover` from
  matches when not forced) would make the panel stable but disagree with
  what is on screen.
- The custom CSS has no line mapping from the compiled rule back to
  `styles.css`; the panel shows selectors as authored, not line numbers.
- About 180 surface `qt-*` classes are not hooks (see Stage 1); the
  inspector reports "no hook" and the nearest one above, which makes them
  easy to find for the catalogue's next version.
