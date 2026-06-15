# Plan: Redesign the Scenarios card (kebab-menu rows, width-adaptive)

## Problem

In `/prospero/[id]`, the **Scenarios** card lives inside the project cards grid
(`app/prospero/[id]/page.tsx`, `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3`).
At `xl` each card is ~370 px wide. The scenario row in
`components/scenarios/ScenariosManager.tsx` tries to lay out, on one line:

```
[radio]  name   filename.md   [Default]      Edit  Rename  Delete
```

With three full-text buttons (`Edit` / `Rename` / `Delete`) plus the name and
filename, the row overflows the narrow card. Flexbox wraps each button — and the
buttons themselves wrap to one character per line — producing the unreadable
vertical "columns" of single letters seen in the screenshot. The markup is not
broken; it simply has no horizontal room in a one-third-width grid column.

## Decision

Two decisions, already made:

1. **Icon-menu rows.** Replace the three text buttons with a single `⋮` kebab
   menu per row holding Edit / Rename / Delete. The default toggle stays a radio
   on the row. This works at any width and never wraps.
2. **Make `ScenariosManager` width-adaptive** so both consumers benefit — the
   narrow project `ScenariosCard` and the wide instance-wide `/scenarios` page
   (`app/scenarios/page.tsx`, via `useGeneralScenarios`). One component, both
   scopes.

## Reference implementation to mirror

`components/wardrobe/wardrobe-item-row.tsx` **already implements exactly this
kebab pattern** — do not invent a new one, and do not add a dependency. Copy its
approach:

- Local `const [kebabOpen, setKebabOpen] = useState(false)` and a
  `kebabRef = useRef<HTMLDivElement>(null)`.
- A `useEffect` that, while open, closes on outside pointerdown (ref
  `.contains` check) and on `Escape`.
- Trigger button: `qt-button-ghost qt-button-sm`, `aria-label="More actions"`,
  `aria-haspopup="menu"`, `aria-expanded={kebabOpen}`, glyph `⋮`.
- Menu: `<div role="menu" className="absolute right-0 top-full mt-1 z-30 min-w-[14rem] rounded border qt-border-default qt-bg-default shadow-md">`
  with a `<ul className="divide-y qt-border-default">` of `role="menuitem"`
  buttons (`block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted`); each
  handler calls `setKebabOpen(false)` first, then the action.

There is **no shared dropdown primitive** in `components/ui/` — confirmed. The
wardrobe row is the house pattern. (Optional, only if it's genuinely clean: this
plan permits extracting a tiny shared `KebabMenu` used by both wardrobe and
scenarios — but that's a stretch goal, not a requirement, and must not regress
the wardrobe row. Default to copying the pattern inline.)

## Why each scenario row should be its own component

Right now the row is inline JSX inside `ScenariosManager`'s `.map`. A kebab menu
needs per-row open state, a ref, and an effect — which cannot live inside a
`.map` callback. So **extract the row into its own component** that owns that
state. This is the core structural change.

## Implementation steps

### 1. New file: `components/scenarios/ScenarioRow.tsx`

A `'use client'` component rendering one `<li>` for a single scenario. Props:

```ts
interface ScenarioRowProps {
  scenario: Scenario
  scopeLabel: string
  onSetDefault: (s: Scenario) => void
  onEdit: (s: Scenario) => void
  onRename: (s: Scenario) => void
  onDelete: (s: Scenario) => void
}
```

Layout (replaces the current inline `<li>`):

- Keep the **default radio** on the left (`qt-radio mt-1`, same title/aria copy
  as today: `${scopeLabel} default` / `Set as ${scopeLabel} default`).
- Middle column (`flex-1 min-w-0`): name (`qt-label truncate`), the
  `filename.md` (`qt-text-xs qt-text-secondary truncate`), the `Default`
  badge when `scenario.isDefault`, and the optional `description`
  (`qt-text-small qt-text-secondary mt-1`) — unchanged content, just moved.
- Right: the `⋮` kebab (`shrink-0`), mirroring `wardrobe-item-row.tsx`. Menu
  items, in order: **Edit**, **Rename**, **Delete** (Delete styled
  `qt-text-destructive`). Each closes the menu then calls the corresponding prop.
- Wire the menu's open/outside-click/Escape state exactly as the wardrobe row
  does.

Accessibility: keep the radio's `aria-label`; give the kebab
`aria-label="More actions for {scenario.name}"`.

### 2. Edit `components/scenarios/ScenariosManager.tsx`

- Remove the inline action-button cluster and the inline `<li>` body.
- In the `scenarios.map(...)`, render `<ScenarioRow key={scenario.path} ... />`,
  passing the existing handlers: `handleSetDefault`, `openEdit`, `handleRename`,
  `handleDelete`. **All existing handler logic stays in the manager** (it owns
  `showConfirmation` / `showPrompt` / `actionError`); the row is presentational
  plus its own menu state. Single source of truth for mutations is preserved.
- Keep the `<ul className="divide-y qt-border-default">` wrapper, warnings block,
  error block, empty state, `+ New scenario` button, and `ScenarioEditorModal`
  exactly as they are.

### 3. Width adaptivity

The kebab approach is already width-agnostic, so the project card stops wrapping
with no further work. For the wide `/scenarios` page we have a choice — pick
**one** and apply it consistently:

- **Simplest (recommended):** use the kebab everywhere. Uniform, less code, and
  the wide page reads fine with a compact `⋮`. No container queries needed.
- **Optional polish:** if you want the wide page to keep inline text buttons,
  gate it with a Tailwind **container query** on the `<ul>`/row
  (`@container` on the manager's root + `@md:` variants on the row) so the row
  shows inline `Edit/Rename/Delete` when the container is wide and collapses to
  the kebab when narrow. This is the only place container queries would be
  needed; do **not** reach for a JS width prop. Confirm container-query support
  is enabled in the Tailwind setup before relying on it; if not, fall back to
  the recommended uniform-kebab approach rather than adding plugins.

Default to the recommended uniform kebab unless Charlie asks for the inline
variant on the wide page.

### 4. `app/prospero/[id]/components/ScenariosCard.tsx`

No change required — it just renders `<ScenariosManager .../>`. Leave it alone.

## qt-* / theming

Use only existing `qt-*` classes already used by the wardrobe row and current
manager (`qt-button-ghost`, `qt-button-sm`, `qt-bg-default`, `qt-bg-muted`,
`qt-border-default`, `qt-text-secondary`, `qt-text-xs`, `qt-text-destructive`,
`qt-radio`, `qt-badge qt-badge-primary`, `qt-label`). **No new Tailwind
utilities and no new qt-* tokens** — so no stylebook / theme-storybook /
create-quilltap-theme / bundled-theme updates are triggered.

## Logging

This is presentational/UI state only (menu open/close) — no backend or data-flow
change, so no new debug logs are warranted. The existing mutation paths
(`createScenario` / `updateScenario` / `renameScenario` / `deleteScenario` /
`setDefaultScenario`) already log wherever they log today; don't touch them.

## Tests

- If `ScenariosManager` has a test, update it for the new row structure (buttons
  now live behind the kebab — open the menu, then assert/click Edit/Rename/Delete).
- Add a focused `ScenarioRow` test: renders name/filename/badge/description;
  kebab opens and closes on outside click and Escape; each menu item fires its
  callback once and closes the menu; the default radio fires `onSetDefault`.
- Mirror the wardrobe row's test conventions if it has them.
- Run the suite plus `npx tsc` (per project convention, type-check with `tsc`,
  not `npm run build`).

## Docs

User-visible UI change → update the relevant `help/*.md` for Scenarios (the file
covering project Scenarios and/or the `/scenarios` page). Keep the steampunk /
Roaring-20s / Wodehouse voice in help copy. Confirm the help file's `url`
frontmatter and its "In-Chat Navigation" `help_navigate(...)` call still match
after any wording change. Add a terse, plain-English entry to
`docs/CHANGELOG.md` (the changelog is the documented exception to the steampunk
voice).

## Out of scope / guardrails

- Don't move `ScenariosCard` out of the grid; the kebab makes that unnecessary.
- Don't change the mutator hooks (`useProjectScenarios`, `useGeneralScenarios`)
  or any API route — this is pure presentation.
- Don't introduce a UI dropdown library; mirror the existing wardrobe pattern.
- Preserve every existing behavior: default radio, default badge, warnings,
  action errors, empty state, editor modal, rename-via-prompt, delete-confirm.

## Suggested commit shape

1. Add `components/scenarios/ScenarioRow.tsx`.
2. Refactor `ScenariosManager.tsx` to use it.
3. Tests + `npx tsc`.
4. Help doc + `docs/CHANGELOG.md`.

## Files to touch

- **Add:** `components/scenarios/ScenarioRow.tsx`
- **Edit:** `components/scenarios/ScenariosManager.tsx`
- **Edit:** the Scenarios `help/*.md` + `docs/CHANGELOG.md`
- **Reference (read, don't edit):** `components/wardrobe/wardrobe-item-row.tsx`
- **No change:** `app/prospero/[id]/components/ScenariosCard.tsx`,
  `app/scenarios/page.tsx`, the scenario hooks
