# Plan: Append custom text to a chosen scenario in the New Chat dialog

## Goal

In the New Chat dialog, let the user write additional scenario text *alongside* a chosen
scenario. Two cases:

1. **No scenario chosen** → the text the user writes *is* the custom scenario (today's behaviour).
2. **A scenario chosen** (character / project / general / group) → the chosen scenario's body,
   concatenated with the user's extra text, becomes the chat's scenario.

The result is "start from a scenario, then layer extra scene-setting on top." Per the request,
**no data-model change** — we resolve the preset body server-side as we already do, then append
the user's free text, and persist the single combined string into `chat.scenarioText` exactly as
today.

## Background: how scenario resolution works today

The flow already collapses every scenario source into one resolved string:

- **UI state** (`components/new-chat/types.ts`, `NewChatFormState`) carries five mutually-exclusive
  scenario fields: `scenario` (free text), `scenarioId` (character scenario UUID),
  `projectScenarioPath`, `groupScenarioPath` + `groupScenarioGroupId`, and `generalScenarioPath`.
- **Form** (`components/new-chat/NewChatForm.tsx`): a dropdown picks a preset; selecting one clears
  `scenario` and sets the relevant path/id. The key line is
  `const showCustomTextarea = !selectedPreset` — when a preset is chosen, the free-text editor is
  **hidden** and the preset body is shown read-only. This is exactly the limitation to remove.
- **Submit** (`components/new-chat/hooks/useNewChat.ts`, `handleCreateChat`): sends *one* of the
  scenario fields by precedence (`scenario` > `scenarioId` > `projectScenarioPath` >
  `groupScenarioPath` > `generalScenarioPath`).
- **Server** (`app/api/v1/chats/route.ts`): the `createChatSchema` Zod object declares those fields;
  the resolution block (~lines 946-1035) walks the same precedence, loading preset bodies from the
  mount index, and produces a single `resolvedScenario` string that is baked into `chat.scenarioText`
  and announced by the Host (`postHostScenarioAnnouncement`).
- **Downstream** (`lib/chat/initialize.ts`, `buildChatContext`): receives the already-resolved
  scenario string as `customScenario`; it does no source-selection of its own. **No change needed here.**

## Design decision

Add **one new optional free-text field**, `additionalScenario`, that is *independent* of the
preset selection — it is never cleared when a preset is picked. The wire contract gains one field;
the five existing fields keep their current mutually-exclusive semantics.

Server-side resolution becomes: resolve the chosen preset body (or the legacy free-text `scenario`)
exactly as today → if `additionalScenario` is non-empty, append it with a blank-line separator →
that combined string is `resolvedScenario`.

This keeps the precedence logic, the Host announcement, the persistence, and `initialize.ts` all
untouched in shape; only the value of `resolvedScenario` changes when extra text is present.

### Why a separate field rather than reusing `scenario`

`scenario` currently doubles as "free-text custom scenario" *and* "highest-precedence override that
suppresses every preset." If we let the existing `scenario` box stay visible alongside a preset, its
mere presence would short-circuit preset resolution (the server returns early on `scenario`). A
distinct `additionalScenario` field that is explicitly *additive* avoids that collision and keeps the
"no preset → this is the whole scenario" path working unchanged (when no preset is selected,
`additionalScenario` is simply appended to an empty base, i.e. it *is* the scenario).

> Decision point for review: alternatively we could keep a single textarea and special-case it as
> "additional when a preset is selected, primary when not." That's fewer fields but more implicit;
> the separate-field approach is more legible and is what the steps below assume. Flag if you'd
> prefer the single-field variant.

## Concatenation rule

`combined = [presetBody, additionalText].filter(s => s && s.trim().length > 0).join('\n\n')`

- Trim trailing whitespace on the preset body before joining; join with one blank line (`\n\n`).
- If only one side is present, `combined` is just that side (no stray separators).
- If both are empty, `resolvedScenario` stays `undefined`/`null` as today.

Implement this once, server-side, in `app/api/v1/chats/route.ts`. Do **not** also concatenate in the
client — the client only needs to *send* `additionalScenario`; the server owns the single source of
truth for the persisted scenario. (Reason: the client doesn't always have the resolved preset body
for project/group/general scenarios — those are loaded from the mount index server-side.)

## Implementation steps

### 1. UI state — add the field
`components/new-chat/types.ts`
- Add `additionalScenario: string` to `NewChatFormState`.
- `components/new-chat/hooks/useNewChat.ts`: add `additionalScenario: ''` to `INITIAL_STATE`.
- Confirm none of the seeding branches need to set it (they shouldn't — it starts empty).

### 2. Form — always show an "additional" editor
`components/new-chat/NewChatForm.tsx`
- Keep the existing dropdown and the read-only preset preview block.
- Replace the current `showCustomTextarea` gating so that:
  - When **no preset** is selected: render the existing `MarkdownLexicalEditor` bound to
    `state.scenario` (unchanged — this remains the "primary" custom scenario), **and** below it the
    new additional editor is unnecessary (the primary editor already covers it). To keep things
    simple and match the request, prefer the single combined approach below.
- **Recommended concrete layout** (keeps one editor, clearest UX):
  - Always render **one** `MarkdownLexicalEditor`.
  - When no preset is selected, it is bound to `state.scenario` with label "Starting scenario"
    (today's behaviour).
  - When a preset **is** selected, show the read-only preset preview (already present), then render
    the same editor bound to `state.additionalScenario` with a label like
    "Add to this scenario (optional)" and placeholder explaining the text is appended to the
    selection above.
  - Net effect: exactly one free-text editor visible at a time; its binding (`scenario` vs
    `additionalScenario`) depends on whether a preset is active. This is the minimal, legible change
    and directly realizes "if you pick a scenario, your text is concatenated to it."
- When the user switches *from* a preset *back* to "Custom…", carry any text they typed in
  `additionalScenario` over into `scenario` (or clear it) — pick one and be consistent.
  Recommended: on switching to Custom, move `additionalScenario` → `scenario` and clear
  `additionalScenario`, so typed text isn't lost. Handle this in `handleScenarioSelectChange`'s
  `CUSTOM_SCENARIO_VALUE` branch.
- When the user switches *from* Custom *to* a preset, the existing code already clears `scenario`;
  leave `additionalScenario` untouched so prior extra text (if any) persists. (Edge case — usually
  it's empty.)

### 3. Submit — send the field
`components/new-chat/hooks/useNewChat.ts`, `handleCreateChat`
- In the request-body assembly, after the existing scenario-precedence block, add:
  `if (state.additionalScenario && state.additionalScenario.trim()) requestBody.additionalScenario = state.additionalScenario`.
- Important: this is sent **in addition to** whichever preset field is set. The existing
  `if/else if` chain that picks exactly one preset field stays as-is; `additionalScenario` is a
  sibling, not part of that chain.
- Note the `scenario`-vs-preset interaction: when no preset is selected the form binds the editor to
  `state.scenario`, so the existing `if (state.scenario)` branch already sends it as the primary
  scenario and `additionalScenario` stays empty — correct. When a preset is selected, `state.scenario`
  is empty (cleared on selection) and `additionalScenario` carries the extra text — also correct.

### 4. Server schema — accept the field
`app/api/v1/chats/route.ts`, `createChatSchema`
- Add `additionalScenario: z.string().max(<limit>).optional()` with a doc comment: free text appended
  to whichever scenario was resolved (preset body or `scenario`); not part of the precedence chain.
- Pick a sane max (e.g. match whatever cap `scenario` effectively has; `scenario` is currently
  uncapped `z.string()`, so leaving `additionalScenario` uncapped is consistent — or add a modest cap
  to both. Flag if a cap is desired.)

### 5. Server resolution — append after precedence
`app/api/v1/chats/route.ts`, the `resolvedScenario` block (~946-1035)
- After the entire precedence chain has settled `resolvedScenario`, add:
  ```ts
  const extra = validatedData.additionalScenario?.trim();
  if (extra) {
    const base = resolvedScenario?.trimEnd();
    resolvedScenario = base ? `${base}\n\n${extra}` : extra;
  }
  ```
- This single insertion covers all five sources plus the empty-base case. Everything downstream
  (`chat.scenarioText`, `postHostScenarioAnnouncement`, `createInitialMessagesScenarioAndStaff`,
  `buildChatContext`) consumes `resolvedScenario` unchanged.
- Add a debug log when appending (project convention requires debug logs on touched backend paths):
  `logger.debug('[Chats v1] appended additionalScenario to resolved scenario', { presetPresent: Boolean(base), extraLength: extra.length })`.

### 6. `contextSummary`
`app/api/v1/chats/route.ts` ~line 1097 sets `contextSummary: validatedData.scenario || null`.
- Decide whether the combined scenario or just the custom text should be the summary. Lowest-risk:
  set `contextSummary: resolvedScenario || null` so the summary reflects what was actually used. Flag
  if `contextSummary` has a narrower intended meaning (check usages before changing).

## Other entry points to audit

These also build chat context / scenarios; confirm whether the new field should reach them, or
whether they're out of scope for "the New Chat dialog":

- **`NewChatModal.tsx`** — uses the same `useNewChat` hook + `NewChatForm`, so it inherits the change
  for free. Verify continuation mode still behaves (it intentionally doesn't pre-fill `scenario`;
  `additionalScenario` should likewise start empty — fine).
- **`app/salon/new/page.tsx`** — also uses the hook; inherits the change. Smoke-test.
- **`AddCharacterDialog.tsx` / `CreateNPCDialog.tsx`** — confirm these don't have their own scenario
  textareas that users would expect the same behaviour from. If they do, they're a separate
  follow-up, not part of this change.
- **`buildChatContext` callers** — search for other callers of `buildChatContext` that pass a
  `customScenario`; none should need changes since they receive an already-resolved string, but
  confirm no caller is doing its own preset+custom merge that this would duplicate.

## Tests

- **Server unit/integration** for `POST /api/v1/chats` scenario resolution. Add cases:
  - preset (each of: character scenarioId, projectScenarioPath, groupScenarioPath,
    generalScenarioPath) **+** `additionalScenario` → `scenarioText` equals `body + "\n\n" + extra`.
  - `additionalScenario` only, no preset → `scenarioText` equals the extra text.
  - preset only, empty `additionalScenario` → unchanged from today.
  - whitespace-only `additionalScenario` → ignored (no trailing separator).
- **Form** (RTL): selecting a preset shows the read-only preview *and* the "Add to this scenario"
  editor; typing populates `additionalScenario`; switching back to Custom migrates the text into
  `scenario`.
- Run `npx tsc` (not `npm run build`) for type-checking per project convention.

## Documentation & changelog

- Update the relevant help file(s) under `help/*.md` that describe starting a chat / choosing a
  scenario (search `help/` for "scenario") to mention that extra text can be layered onto a chosen
  scenario. Keep help-file voice (steampunk / Roaring-20s / Wodehouse / Lemony Snicket) and update
  the `url` frontmatter + "In-Chat Navigation" `help_navigate(...)` block if the page changes.
- Add a terse, plain-English entry to `docs/CHANGELOG.md` (the changelog is the one place that does
  **not** use the steampunk voice) — e.g. "New Chat: free-text scenario notes can now be appended to
  a selected scenario; server concatenates the chosen scenario body with the extra text into
  `chat.scenarioText`."

## Out of scope / non-goals

- No new DB column, no `.qtap`/SillyTavern export change, no migration — `chat.scenarioText` already
  stores the final string and is unchanged in shape.
- Not changing how scenarios are *authored* or stored in mounts.
- Not adding per-preset "append" defaults or templating beyond plain concatenation.

## Risk notes

- The only behavioural change to existing flows is the addition of one optional field and one
  append step; with `additionalScenario` empty (the default), every existing path produces byte-for-
  byte the same `resolvedScenario`. Low blast radius.
- Watch the "switch back to Custom" text-migration in the form so users don't silently lose typed
  text; cover it with the RTL test above.
