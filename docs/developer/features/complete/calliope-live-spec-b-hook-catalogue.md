# Calliope Live — Spec B: structural hook catalogue

**Status:** implemented 2026-11-14 (4.14-dev); see "As built" at the end. Design decisions confirmed by the human. Implements Phase 0b′ of
[calliope-live.md](calliope-live.md). Read that document and the audit,
[calliope-live-audit.md](calliope-live-audit.md) — sections 2.3 and 4 in
particular — before starting.

**Scope:** `quilltap-server` only. Independent of Spec A
([calliope-live-spec-a-token-registry.md](calliope-live-spec-a-token-registry.md));
see "Running beside Spec A" at the end.

## Goal

A theme's custom CSS can only reach what has a stable name. Today those names
are an accident of whoever wrote the component. This spec makes them a
contract:

- a **catalogue** of structural hooks in `lib/themes/hooks/` — the single
  source of truth for which elements a theme may rely on;
- the **missing hooks** added to the markup, for a bounded list of surfaces;
- a **lint** that fails when the markup and the catalogue drift apart, and
  that can tell a theme author (later, the editor and an LLM) when a selector
  targets something that is not a hook;
- a **versioning rule**, so removing or renaming a hook is a visible act.

Nothing here should change how the app looks.

## Out of scope

Migrating or fixing the bundled themes' selectors (Spec C); the theme manifest
and bundle format (Spec A, Spec C); any editor UI, including inspect mode;
layout variants; cataloguing every `qt-*` class in the app (about 1,000 — the
catalogue starts with the surfaces listed here and grows by request).

## Decisions taken

| # | Decision | Status |
|---|---|---|
| 1 | The catalogue is TypeScript in `lib/themes/hooks/`, framework-free, beside Spec A's registry. | settled |
| 2 | **Element identity is a `qt-*` class.** One class names one kind of element. | settled |
| 3 | **Which one of a set is a data attribute named for the set**: `data-section`, `data-nav`, `data-role`, `data-staff`, `data-tab-kind`, `data-tool`, `data-group`. Values are stable ids, never display text, never instance ids (no character or chat ids). | confirmed 2026-11-14 |
| 4 | **State is the ARIA attribute when one says it** (`aria-current`, `aria-selected`, `aria-expanded`, `aria-disabled`, `aria-busy`); otherwise the existing modifier-class pattern (`qt-x-active`, `qt-x-silent`). Existing state classes are catalogued as they are, not converted. | confirmed 2026-11-14 |
| 5 | Scope is bounded to the surfaces in "Hooks to add". | confirmed 2026-11-14 |
| 6 | The lint fails on catalogue-versus-markup drift now. Its check of bundled theme CSS is report-only until Spec C migrates the themes. | settled |

## Constraints that apply throughout

- **No visual change.** Adding a class with no rule, or a data attribute, does
  not restyle anything; the one CSS change in this spec (the dialog body and
  footer, below) must render identically. Check each touched surface in the
  running app in light and dark, under the default theme and one bundled
  theme, and say in the report which you checked. Use the V4test instance on
  port 3005 for this, not the developer's own instance.
- Follow `CLAUDE.md`: no stubs or `TODO`s; `npm run lint` and `npx tsc` pass;
  after any change under `app/styles/qt-components/`, run
  `npm run generate:storybook-css` and bump `packages/theme-storybook`'s patch
  version; record changes in `docs/CHANGELOG.md` in plain voice.
- New `qt-*` classes that exist only as hooks need no CSS rule;
  `check-qt-classes.mjs` deliberately leaves bare component classes alone.
  Do not add empty rules to satisfy anything.
- Do not rename or remove any existing `qt-*` class or data attribute. This
  spec only adds.
- Accessibility: where this spec adds an ARIA state, it must be true. Do not
  add an ARIA attribute as a styling convenience.
- Commit nothing; leave the work for the human to review.

## Part 1 — the catalogue

`lib/themes/hooks/`, importable by server, client and scripts.

```ts
interface HookDef {
  /** The class that identifies the element, e.g. 'qt-homepage-section'. */
  className: `qt-${string}`;
  surface: 'app-shell' | 'workspace' | 'home' | 'sidebar' | 'salon'
         | 'character' | 'dialog' | 'settings' | 'common';
  label: string;                 // plain English: "Home page card"
  description?: string;
  /** Classes of elements this one is always inside, for documentation. */
  within?: `qt-${string}`[];
  /** Data attributes that say which one of a set this is. */
  variants?: { attribute: `data-${string}`; values: readonly string[] | 'open' }[];
  /** State an author may select on. */
  states?: (
    | { kind: 'class'; className: `qt-${string}`; label: string }
    | { kind: 'aria'; attribute: `aria-${string}`; values: readonly string[]; label: string }
  )[];
  /** Catalogue version in which the hook first appeared. */
  since: number;
  /** Where the class is written, when it is not a literal in the source. */
  composedIn?: string;           // repo-relative path
}

interface RemovedHook {
  className: `qt-${string}`;
  removedIn: number;
  replacedBy?: `qt-${string}`;
  note?: string;
}
```

- `HOOK_CATALOGUE_VERSION` is an integer, starting at 1. It rises by one in
  any change that removes a hook, removes a variant value or state, or changes
  what element a hook names. Adding does not raise it.
- A removed hook moves to a `REMOVED_HOOKS` list; it is never silently
  deleted. Export `hooksRemovedSince(version)` — Spec C will use it to warn
  when a theme written against an older catalogue targets something gone.
- `variants.values` is a closed list wherever the app has one (take it from
  the app's own source of truth — for example the `systemSender` enum in
  `lib/schemas/chat.types.ts` for `data-staff`, the workspace tab kinds, the
  settings groups in `lib/settings/registry.ts`) and `'open'` only where the
  set is genuinely open (tool names).
- One file per surface, collected in `index.ts` with lookups by class and by
  surface.

Populate it with, for each surface below, the hooks the audit found already
present (section 4, verdict "hooked") plus the ones this spec adds. Catalogue
the shared building blocks that themes already target as `surface: 'common'`:
`qt-card` and its parts, `qt-button` and its variants, `qt-input` /
`qt-textarea` / `qt-select`, `qt-badge` and its categories, `qt-alert` and its
statuses, `qt-heading-1` … `qt-heading-4`, `qt-avatar-*`, `qt-tab-group` /
`qt-tab`.

Read each component before cataloguing it. The audit's tables are a guide with
file and line references that will have drifted; the source is the truth.

## Part 2 — hooks to add

Each row is a gap from audit section 4. Add exactly these; where the code
suggests a better name or a missing sibling, add it and say so in the report.

### Home (`components/homepage/`)

| Element | Add |
|---|---|
| The three cards (`qt-homepage-section`) | `data-section="chats" \| "projects" \| "characters"` |
| A row in the chats and projects lists | `qt-homepage-row` |
| Empty state inside a card | `qt-homepage-empty` |
| Welcome block | `qt-homepage-welcome` |

### Left sidebar (`components/layout/left-sidebar/`)

| Element | Add |
|---|---|
| Each nav item (`qt-collapsed-nav-button`) | `data-nav="<item id>"`, using the ids the nav already has; `"home"` for the brand link |
| Active nav item | `aria-current="page"` on the item that corresponds to the active tab of the focused workspace pane; no item carries it when none corresponds. This is also a real accessibility gain — there is no active indication at all today. |
| Each footer button (`qt-left-sidebar-item`) | `data-nav="<action id>"`; `aria-expanded` on those that open a popout, if not already present |
| Popout menus | `qt-left-sidebar-popout` |

### App shell and workspace (`components/layout/`, `components/workspace/`)

| Element | Add |
|---|---|
| `<main>` | `qt-app-content` |
| Pane chrome (`qt-workspace-pane-chrome`) | `data-pane="left" \| "right"`, matching the tab strip |
| Tab content pane (`qt-tab-pane`) and its tab (`qt-tab` in the strip) | `data-tab-kind="<kind>"` from the workspace's tab kinds |

`qt-tab` is shared by the workspace tab strip and the in-page entity tabs. Do
not rename either. Catalogue `qt-tab` once under `common`, with `within`
naming both `qt-tab-strip` and `qt-tab-group`, and a description telling
authors to scope by the parent.

### Salon (`app/salon/[id]/`, `components/chat/`)

| Element | Add |
|---|---|
| Message row (`qt-chat-message-row`) | `data-role="user" \| "assistant" \| "staff" \| "tool"`. Today anything not from the user gets the `-assistant` class, Staff included; the attribute tells them apart. Keep the existing classes. |
| Staff row and announcement chip | `data-staff="<systemSender>"` |
| Tool-call card | `qt-chat-tool-card`, with `data-tool="<tool name>"` |
| Pending tool calls block | `qt-chat-pending-tools` |
| Streaming bubble | the same bubble classes a finished assistant message has, plus `qt-chat-message-streaming` — **only if** that leaves it rendering as it does now; if the assistant classes restyle it, add `qt-chat-message-streaming` alone and report it |
| Avatar image box (`components/ui/Avatar.tsx`) | `qt-avatar-image` |
| Carried-items strip under the avatar | `qt-chat-avatar-carried` |

No speaker, character or chat id goes on any element (decision 3).

### Character page (`app/aurora/[id]/`)

| Element | Add |
|---|---|
| Page container | `qt-character-page` (keep the existing bare `character-page`) |
| Sticky header | `qt-character-header` |
| Avatar region | `qt-character-avatar` |
| Name and meta block | `qt-character-identity` |
| Tag pills, stats, actions | `qt-character-tags`, `qt-character-stats`, `qt-character-actions` |
| Archived banner | `qt-character-archived-banner` |
| Field section (`components/SectionCard.tsx`) | `qt-section-card`, with `data-section="<anchor>"` (the value it already uses as `id`), plus `qt-section-card-header` and `qt-section-card-body` |

### Dialogs (`components/ui/BaseModal.tsx`)

| Element | Add |
|---|---|
| Close button | `qt-dialog-close` |
| Body and footer | must always carry `qt-dialog-body` / `qt-dialog-footer`, whatever the caller passes |

The second row needs care. `bodyClassName` and `footerClassName` default to
the hook classes, so a caller that passes its own value drops the hook; 41 of
67 such callers do, usually to shed the default padding. Make the identity
class unconditional and move the styling it carries today to a default
modifier:

- `.qt-dialog-body` keeps no declarations; its current declarations move to
  `.qt-dialog-body-default`. Likewise `.qt-dialog-footer` →
  `.qt-dialog-footer-default`.
- `BaseModal` always applies the identity class, and applies the `-default`
  class only when the caller has not supplied its own class name.
- Callers that pass a class string which itself includes `qt-dialog-body` or
  `qt-dialog-footer` were relying on the styling: give them the `-default`
  class so they render as before.
- Update `packages/theme-storybook/src/stories/components/Dialogs.tsx` to
  match, regenerate the Storybook CSS, and check no bundled theme's
  `styles.css` targets these two classes (the audit found none).

### Settings (`app/settings/SettingsView.tsx`)

| Element | Add |
|---|---|
| Rail items (`qt-settings-rail-item`) | `data-group="<group id>"` from the settings registry |
| Collapsible cards (`qt-collapsible-card`) | `data-card="<card id>"` (the value already used as `id`) |

### Headings

Three bundled themes style bare `h1`–`h3` because not every heading carries a
`qt-heading-*` class. Within the surfaces above only, give each `h1`–`h4`
that lacks one the `qt-heading-*` class matching the size it already renders
at — **only where that class's rule leaves it looking the same**. Where it
would change the heading, leave it and list it in the report. Do not sweep the
rest of the app.

## Part 3 — the lint

`lib/themes/hooks/lint.ts` holds the logic as pure functions; a thin
`scripts/check-theme-hooks.mjs` (or `.ts` run with `tsx`, matching how the
other generators import TypeScript) runs them and joins `npm run lint`.

1. **Catalogue is well-formed.** Unique class names; every `within` and every
   state class names a catalogued hook or is itself listed; no hook appears in
   both the catalogue and `REMOVED_HOOKS`.
2. **Every catalogued hook is in the markup.** Each `className`, state class
   and variant attribute must occur in a `.tsx` / `.ts` file under `app/` or
   `components/` — as a literal, or, when `composedIn` is set, in that file.
   A miss is a failure with the message "catalogued hook `X` is no longer in
   the markup: restore it, or move it to REMOVED_HOOKS and raise
   HOOK_CATALOGUE_VERSION".
3. **Variant values are real.** Where `values` is a closed list, a literal
   value written for that attribute in TSX must be in the list. (Values
   supplied from a variable are not checked.)
4. **Theme selectors, report-only.** Export
   `lintThemeSelectors(css, catalogue)`: given a stylesheet, return each
   selector that targets (a) a class or attribute in `REMOVED_HOOKS`, (b) a
   `qt-*` class that is not catalogued, (c) a non-`qt` class, (d) a bare
   element other than `html` / `body`, or (e) a class-substring attribute
   selector (`[class*=…]`), with the line and a reason. The script runs it
   over `themes/bundled/*/styles.css` and prints a summary **without
   failing**. Spec C turns this into a gate; the editor and LLM assistance
   will call the same function.

   Extract classes and attributes from selectors with PostCSS for the rule
   structure and a tokeniser of your own for the selector text (there is no
   selector-parser dependency; do not add one for this). Unit-test it against
   the selectors listed in audit section 2.3.

Add Jest tests for the lint functions: a fixture catalogue, markup strings
that satisfy and violate each rule, and stylesheets covering (a)–(e).

## Part 4 — reference document

Generate `docs/developer/THEME_HOOKS.md` from the catalogue
(`npm run generate:theme-hooks-doc`): the conventions (decisions 2–4), then one
table per surface — class, what it is, where it sits, variants, states. Mark
it generated; have the lint script fail when the committed file is stale.
Add it to `.claude/commands/update-documentation.md`. The author-facing help
page is Phase 3, not this spec.

## Verification

- `npm run lint`, `npx tsc`, and the unit tests pass.
- `git diff --stat app/styles` shows only the dialog body / footer change.
- The three test cases from the proposal, checked by writing a few lines of
  throwaway CSS in the browser's inspector (not committed):
  1. each home card can be selected and transformed on its own without
     `:nth-child`;
  2. a Staff announcement from one sender, a user message and an assistant
     message can each be styled differently; the character page's header,
     avatar and one named section can each be selected;
  3. the active sidebar item can be selected.
  Say in the report what was selected and that it matched.
- The lint's report-only run lists the bundled themes' off-catalogue
  selectors; include its summary in the report — it is Spec C's worklist.

## Report back

What was added per surface; anything named differently from this spec and
why; headings and the streaming bubble left alone because a class would have
restyled them; the dialog callers changed; the surfaces checked visually and
under which themes; the theme-selector summary.

## Running beside Spec A

The two specs touch different code, with three overlaps to merge by hand if
they run at the same time: the `lint` script line in `package.json`,
`docs/CHANGELOG.md`, and the regenerated Storybook CSS with its version bump.
Spec A also edits `components/providers/theme/theme-utils.ts`; this spec does
not. The project's rule is not to run agents in separate worktrees, so the
simple course is to run this spec after Spec A's Stage 1 has been committed,
or before Spec A starts.

## As built

Implemented 2026-11-14 (4.14-dev). Catalogue version 1, 156 hooks, in
`lib/themes/hooks/` (one file per surface; `index.ts`, `lint.ts`, `doc.ts`).
`npm run lint` runs `scripts/check-theme-hooks.ts`; the reference is
[THEME_HOOKS.md](../../THEME_HOOKS.md) (`npm run generate:theme-hooks-doc`).

Departures from the text above:

- **Tool-call card is `qt-chat-tool-call`, not `qt-chat-tool-card`.** The card
  has a visible border, and art-deco, great-estate and madmans-box all recolour
  the border of anything matching `[class*="card"]`; a class containing "card"
  would have restyled it under those three themes.
- **Great-estate lost two dead rules.** Its `[data-role="assistant"]` /
  `[data-role="user"]` borders had never matched anything; with `data-role`
  on message rows they would have started to. Removed on the human's
  instruction (theme 1.0.13), so nothing changes; Spec C can restore the accent
  deliberately.
- **Streaming bubble** carries `qt-chat-message-streaming` alone: the finished
  bubble's `qt-chat-message-assistant` sets its own padding, background and
  border, so adding it would restyle the stream.
- **`data-role="tool"`** is on the standalone pending-tool row (a
  `qt-chat-message-row`) and on `qt-chat-message-row-tool` (which is not a
  `qt-chat-message-row`; giving it that class would restyle it).
- **Added beyond the list:** `qt-app-scroll` on the scroll area under the page
  toolbar; `data-pane` on `qt-tab-pane` as well as the pane chrome;
  `qt-left-sidebar-popout` on the profile menu too; `qt-page-container` in
  `common`; `aria-pressed` and `aria-busy` states where the markup already
  carried them.
- **Section anchors are a closed list, and required.** `CHARACTER_SECTION_ANCHORS`
  in `lib/themes/hooks/character.ts` types `SectionCard`'s `anchor` prop, which
  is no longer optional, so the compiler keeps the catalogue and the page in
  step. Seven cards had no anchor and were given one: `facts`, `dossier`,
  `connection-profile`, `conversation-partner`, `image-profile`, `timestamps`,
  `chat-tools`.
- **The theme-selector check** also flags data attributes the app does not set
  (`[data-sidebar]`), inline-style matches (`[style*=…]`), and a catalogued
  attribute given a value outside its list (`[data-role="narrator"]`). The
  root's `.dark` / `.light` / `data-theme` / `data-color-mode` and
  `data-qt-modal` are allowed.
- **Headings:** no `qt-heading-*` class was added. Every bare heading in scope
  already carries its own component class (`qt-homepage-section-title`,
  `qt-card-title`, `qt-dialog-title`) that sets size and font; a heading class
  would change the font family. Left alone: the three home card titles, the
  dialog title, the settings card titles (`CollapsibleCard`), the Salon's
  screen-reader-only `h1`, `ScenariosCard`'s scenario titles and
  `VaultRepairCard`'s heading.
- **Dialog callers:** `BaseModal` writes the identity class itself; the 27
  files whose class strings named `qt-dialog-body` / `qt-dialog-footer` now
  name the `-default` modifier (prop strings) or carry both (footers and bodies
  drawn by hand inside the dialog). No bundled theme targets either class.

Spec C's worklist (report-only run at the time of writing): art-deco 24
selectors, earl-grey 32, great-estate 32, madmans-box 30, old-school 9,
rains 38 — 105 uncatalogued `qt-*` classes, 33 bare elements, 25 uncatalogued
attributes, 13 non-`qt` classes, 9 class-substring selectors.
`tsx scripts/check-theme-hooks.ts --verbose` lists them.
