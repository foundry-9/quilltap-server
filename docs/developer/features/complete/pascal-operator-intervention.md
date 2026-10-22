# Pascal Operator Intervention — Spec

**Status:** Implemented 2026-10-22 (4.11-dev). See the As-built notes at the end.
**Owner subsystem:** Pascal the Croupier (custom tools — `lib/pascal/`, Workbench at `/custom-tools`).
**Builds on:** [pascal-custom-tools.md](pascal-custom-tools.md) (the format and the run
service), [pascal-trigger-phrases.md](pascal-trigger-phrases.md) (the third entrance),
[storyteller-mode.md](storyteller-mode.md) (tool effects and the ceiling check).

## Summary

A custom tool can be marked **intervenable**. When a model's `run_custom` call or a trigger phrase
runs an intervenable tool, the run is computed as usual and then **held**. A dialog opens for the
operator showing every eligible part of the run: the parameters the model passed, the raw roll, the
value after modifiers, the consult's prompt and answer, the chosen outcome with its message and
state, the effects, the visibility, the announcer, the title and the chip label. The operator can
change any of them, force an outcome directly, run it as rolled, or veto the run. The turn then
continues with the result the operator settled on.

The model is never told. It sees only the final run, in the same tool result and the same Pascal
message it would have seen if the dice had come up that way. Nothing it can read says that a run
was held, changed or vetoed.

Every change applies to **this run only**. Nothing is written back to the definition.

Each eligible field in the definition carries its own flag saying whether the dialog shows it. When
the tool is intervenable, every eligible field is shown unless its flag turns it off.

## Decisions of record

Settled with the operator on 2026-10-22:

| # | Decision |
|---|---|
| I1 | **Hold the turn open.** The tool call blocks inside the running turn until the operator answers. The stream stays open (with keep-alive pings). There is no end-the-turn-and-resume path. |
| I2 | **Wait indefinitely.** There is no timeout. The run waits until the operator answers the dialog, or presses Stop, which vetoes it (I9). |
| I3 | **Two entrances hold:** a model's `run_custom` and a trigger phrase. The operator's own popup run never holds (they set its parameters themselves). Autonomous rooms never hold. Their runs happen in the job child, with nobody watching, and run as rolled. |
| I4 | **One dialog, live recompute.** The dialog opens after the whole run has been computed. Changing an earlier field recomputes every later field the operator hasn't pinned. The consult is never called again on its own. An upstream change marks its answer out of date, with a Re-ask button. |
| I5 | **Veto and bypass.** *Set the table aside* vetoes the run: no Pascal post, no effects, and the model gets a neutral tool result that doesn't mention the operator (wording per I13). Separately, the operator can bypass the dice by forcing an outcome row or typing a roll. |
| I6 | **All fields shown, opt out per field.** Turning on `intervention.enabled` shows every eligible field. A field's flag set to `false` hides it. |
| I7 | **Keep both versions and show a badge.** `pascalMeta.intervention` records what was dealt and what was changed. The bubble shows the operator a small "adjusted" mark. None of it enters any model's context. It is included in export and backup. |
| I13 | **The veto's wording depends on who asked** (added 2026-10-22). A plain character doesn't know the chat is a game, so it gets only "The tool did not run." Only a `systemTransparency` character, or a user-controlled seat, hears about the table being closed. See 2.1. |

Decided while drafting (the operator had no preference on the extra field list). Open to revision
before implementation starts:

| # | Decision |
|---|---|
| I8 | **Every run-time field is eligible**, meaning anything that can differ between two runs of one definition. That includes effects (switch each on or off, force one on, edit what it writes), visibility, announcer, title and chip label. Fields that only matter for finding or offering a tool are not eligible, because they have already done their job by the time a run exists: `name`, `description`, `triggers`, `availableWhen`/`withheldWhen`, `disabled`, `revealOdds`. |
| I9 | **Stop vetoes.** Pressing Stop while a run is held resolves it as a veto. Stop already means "no further tool call starts", and committing a run the operator never approved would contradict it. |
| I10 | **A veto leaves no transcript trace.** No Pascal message and no whisper. It is logged at `info` on the server. A message only the operator can see is still a message that some later renderer might leak. |
| I11 | **A global off switch** is added to the Chat tab, Pascal's area: "Hold intervenable rolls for me" (`chatSettings.customToolIntervention`, default on). Off means every run goes ahead as rolled and no dialog opens. Since there's no timeout (I2), this is the way to let a chat run unattended without editing tool files. |
| I12 | **The ceiling check comes first.** A storyteller turn's effect ceiling is checked in `executeToolCallWithContext` before the handler runs, so a refused call never reaches the dialog. Intervention doesn't change a tool's derived effect class (storyteller D5). The operator can switch effects off, but there's nothing to add. |

## Part 1 — The definition format

### 1.1 The tool-level block

A new optional top-level key on `QtapCustomToolSchema` (`lib/pascal/custom-tool.types.ts`):

```jsonc
"intervention": {
  "enabled": true,          // required inside the block. false = authored but switched off.
  "fields": {               // optional. A key set to false hides that field. Absent keys are shown.
    "roll": false,
    "llmPrompt": false
  }
}
```

The `fields` keys form a closed enum. Unknown keys are rejected at load, the same as everywhere else
in the format:

| Key | Field in the dialog |
|---|---|
| `roll` | The raw draw: a number for the range and `$inventory` forms, the individual dice for the dice form |
| `value` | The value after modifiers (range and `$inventory` forms only; see 3.2) |
| `llmPrompt` | The consult's rendered prompt, which can be edited before a Re-ask |
| `llmAnswer` | The consult's answer and its `ok` flag |
| `outcome` | Which outcome row wins |
| `message` | The winning row's rendered message |
| `state` | The semantic state (`success` / `partial` / `failure` / `info`) |
| `chipLabel` | The rendered chip label |
| `title` | The display title for this run |
| `visibility` | Public or whisper |
| `announcer` | Pascal or the rolling character (`announceAsCharacter`) |

### 1.2 Per-member flags

Members of the parameter record and the effects array are flagged on the member itself, so a flag
moves with the thing it flags when the author renames or reorders:

```jsonc
"parameters": {
  "bonus": { "type": "number", "default": 0, "description": "…", "intervene": false }
},
"effects": [
  { "target": "state.encounter.count", "value": "{{state.encounter.count}} + 1", "intervene": false }
]
```

`intervene` is an optional boolean on `CustomToolParameterSchema` and `CustomToolEffectSchema`.
`false` hides that member, and absent or `true` shows it. The rule for authors: a flag sits on the
thing it flags, and the parts of a run that aren't objects in the file (the roll, the value, the
outcome choice) are flagged in the `intervention` block.

### 1.3 Validation

- `intervention.enabled` is required inside the block, so `"intervention": {}` is rejected as
  ambiguous.
- Flags on a tool that isn't intervenable (no block, or `enabled: false`) are **accepted and
  ignored**, so turning the master switch off and back on keeps the author's per-field choices.
  The same applies to a key naming something the tool doesn't have (`llmAnswer` with no `llm`
  block). Unlike an `llm` test with no `llm` block, these flags can never mislead a run, so they
  don't need the "dead branch" rejection.
- The published `public/schemas/qtap-custom-tool.schema.json` gains all of the above. Its
  descriptions tell the author that a character with read access to the store can see the flag,
  the same caveat `revealOdds` already carries.

### 1.4 What the model sees

**Nothing new.** The `run_custom` roster serializer, the odds rendering under `revealOdds`, the
storyteller bid roster and every other model-facing projection of a definition must leave out
`intervention` and `intervene`. A test serializes an intervenable fixture through each projection
and asserts that neither key, nor the word "intervention", appears in the output.

### 1.5 The Workbench

`tool-draft.ts` round-trips the new keys (draft ⇄ definition). Its existing round-trip tests gain
an intervenable fixture.

- `BuilderForm.tsx` gains a master toggle, **"Let me take a hand in each roll"** (final wording in
  the house voice). It is off by default for new tools.
- While it's on, each eligible field in the builder (the parameter rows in
  `CustomToolParamsForm.tsx`, the roll fields, the consult block, `OutcomesSection.tsx`,
  `SideEffectsSection.tsx`, the visibility, announcer, title and chip-label controls) shows a small
  hand toggle beside its label, on by default. While the master toggle is off, the per-field
  toggles are hidden, but their values are kept in the draft.
- `WorkbenchLibrary.tsx` shows a small hand marker on intervenable tools.
- The Proving Bench is unchanged. Its audit runs and preview rolls never hold.

## Part 2 — The hold

### 2.1 Where it happens

The hold lives in **`runCustomTool`** (`lib/pascal/run-service.ts`), the one run service, so that
every entrance gets it for free. `RunCustomToolParams` gains:

```ts
/** Whether this entrance may hold the run for the operator. Entrances decide; the service checks the rest. */
mayHold: boolean
```

- `run-custom-handler.ts` and `trigger-runner.ts` pass `true`.
- The popup route (`app/api/v1/chats/[id]/custom-tools/route.ts`) passes `false`.
- The service holds only when **all** of these are true: `mayHold`; the definition has
  `intervention.enabled: true`; the chat settings have `customTools` and `customToolIntervention`
  on; the run is in the **parent process** (never the job child, so autonomous rooms and anything
  else run there go ahead as rolled); and the chat is not an autonomous room. Each "no" is logged
  at `debug` with its reason.

The order of operations becomes:

```
cascade → execute (the deal, including any consult)
        → [hold: register, publish, await the operator's decision, apply it]
        → effects → Pascal's post
```

Effects still apply before the post. A veto returns before either.

`RunCustomToolOutcome` gains a third variant:

```ts
| { ok: 'vetoed' }
```

- `run-custom-handler.ts` turns a veto into a tool result for the model,
  `{ success: false, tool, error }`, and posts **no** Prospero bubble. The `error` wording depends
  on whether the calling character knows the chat is a game (I13):
  - **Plain character** (`systemTransparency !== true`): `'The tool did not run.'` That's all. It's
    as generic as a flaky tool call, and says nothing about a table, a game or anyone deciding.
  - **`systemTransparency` character, or a user-controlled seat**: `'The table is closed for the
    moment; this tool did not run. Carry on without it.'` These characters may already know about
    Pascal and the staff, so the fiction can say so.

  Transparency is resolved the way Carina resolves an asker's (`carina.service.ts`): the seat's
  `controlledBy === 'user'`, or `findByIdRaw(characterId)?.systemTransparency === true`. If the read
  fails, the character counts as **plain**, so a failed read can never tell a character it's in a
  game. The two strings are exported constants in `lib/pascal/intervention/veto-result.ts` with a
  `vetoResultFor(transparent: boolean)` helper. That way the handler and its tests use the same
  text, and nobody hand-writes the plain wording somewhere else.
- `trigger-runner.ts` treats a veto as a run that posted nothing. No bubble.

### 2.2 The pending-intervention registry

New module `lib/pascal/intervention/registry.ts`. Like turn control (`lib/chat/turn-control.ts`),
the HTTP actions that resolve a hold run in a different route bundle from the stream that's
waiting, so the registry is a **`processSingleton`** (bug 235). It is in-process only.

```ts
interface PendingIntervention {
  id: string                       // uuid
  chatId: string
  createdAt: number
  entrance: 'llm' | 'trigger'
  characterId: string | null
  characterName: string | null
  definition: QtapCustomTool       // the definition as it was dealt — a mid-hold file edit is not picked up
  definitionTier: …; definitionMountId: string
  snapshot: RunSnapshot            // params as supplied, state, metadata, progress, inventory, now — frozen at deal time
  draw: RecordedDraw               // the random draw itself (3.1), so recompute keeps the luck
  baseline: CustomToolRunResult    // the run as dealt
  consults: LlmConsultResult[]     // the original answer, then one per Re-ask
  resolve: (decision: InterventionDecision) => void
}
```

- `hold(entry)` registers the entry, publishes the realtime topic, and returns the decision
  promise. While waiting it sends SSE keep-alive pings through the turn's controller, the same way
  `pre-compute.service.ts` does.
- If `currentTurnStopSignal()` is present, `hold` subscribes to it. An abort resolves the hold as
  `{ kind: 'veto', cause: 'stop' }` (I9). A hold with no turn handle (a trigger phrase on a message
  sent with no open stream) has no Stop to listen to and waits for the dialog alone.
- **Resolution is first-wins.** Every later resolve, from a second tab or a double click, gets a
  409, and the entry is removed when it settles. Each add and each removal publishes the topic.
- **No timeout** (I2). A server restart loses the entry, but it also kills the turn that was
  waiting, so nothing is left half-done: the run had applied no effects and posted nothing.

### 2.3 Realtime and REST

- New topic `customToolInterventions` in `REALTIME_TOPICS` (`lib/schemas/realtime.types.ts`) and
  `lib/realtime/topic-map.ts`, published with the chat id. It carries a hint only, never data.
- New `queryKeys.customTools.interventions(chatId)` block in `lib/query/keys.ts`.
- Actions on the existing route `app/api/v1/chats/[id]/custom-tools/route.ts`, through
  `withActionDispatch` (never reading `?action=` by hand):

| Verb + action | Body | Does |
|---|---|---|
| `GET ?action=interventions` | — | Lists this chat's pending holds: id, tool, title, character, entrance, created-at, the baseline run, the eligible-field set, the consult history, and the full outcome table and effect list. The operator sees the odds whatever `revealOdds` says. It's their file. |
| `POST ?action=intervention-preview` | `{ id, overrides }` | Recomputes the run against the frozen snapshot and the recorded draw with these overrides (Part 3). Pure. Writes nothing and calls no model. |
| `POST ?action=intervention-reask` | `{ id, overrides }` | Renders the consult prompt under these overrides, or uses the overridden prompt if `llmPrompt` is pinned. It calls the consult through the existing invoker (`buildCustomToolLlmInvoker`, logged as `CUSTOM_TOOL_CONSULT`), adds the result to `consults` and returns the recomputed run. Only allowed when the tool has an `llm` block and `llmPrompt` or `llmAnswer` is eligible. |
| `POST ?action=intervention-resolve` | `{ id, decision }` | `decision` is `{ kind: 'deal', overrides }`, `{ kind: 'as-rolled' }` or `{ kind: 'veto' }`. The overrides go through the same Zod schema and recompute as the preview, so the final run is computed server-side and never taken from the client. 404 if the id is unknown, 409 if it has already been resolved. |

Overrides that name a hidden field (`intervene: false`, or a `fields` key set to `false`) get a 400.
The server enforces the author's choice. It isn't just a UI hint.

## Part 3 — Recompute

### 3.1 Replay, not reroll

`executeCustomTool` (`lib/pascal/custom-tools.ts`) gains two optional inputs. Neither changes
behavior when absent:

- **`draw: RecordedDraw`**: the random draw to use instead of fresh randomness. For the range form
  it's the **unit draw** `u ∈ [0, 1)` that `rollRange` scales into `[min, max)`. For the dice form
  it's the faces. For the `$inventory` form there's nothing random to record. The deal always
  returns the draw it used, so the hold can replay it. Recording `u` rather than `raw` is what
  keeps the luck when the operator changes a parameter that moves `min` or `max`: the
  "top 10%" draw stays in the top 10% of the new range. That's the reading of "recompute" an
  operator would expect.
- **`consult: LlmConsultResult`**: the consult result to use instead of calling the invoker. When
  it's supplied, `llmInvoke` is never called.

On top of those, an **`InterventionOverrides`** object (Zod schema in
`lib/pascal/intervention/overrides.ts`, also the request body schema for 2.3):

```ts
{
  params?: Record<string, number | string | boolean>
  roll?: number                    // range / $inventory forms: the raw value
  dice?: number[]                  // dice form: the faces, same count as the notation, each clamped to [1, sides]
  value?: number                   // range / $inventory forms only
  llmPrompt?: string               // used by the next Re-ask
  llmAnswer?: { ok: boolean; output: string }
  outcomeIndex?: number
  message?: string                 // the rendered text, taken literally — no placeholders re-rendered in it
  state?: OutcomeState
  chipLabel?: string
  title?: string
  visibility?: 'public' | 'whisper'
  announcer?: 'pascal' | 'character'
  effects?: Record<number, { mode: 'auto' | 'on' | 'off'; value?: number | string | boolean; items?: string[]; log?: string }>
}
```

### 3.2 The cascade

Fields are recomputed in pipeline order. **A field the operator has set is pinned.** Recompute
never overwrites a pinned field, and the dialog's reset control unpins it. Everything downstream of
a change that isn't pinned is recomputed:

1. **Parameters.** Coerced and clamped exactly as `resolveParams` does. A supplied value outside
   `min`/`max` is clamped, and the dialog says so.
2. **Roll.** If it isn't pinned, it's replayed from the recorded draw under the new parameters. If
   it is pinned, the raw number or faces are taken as given. The dice total is the sum of the faces
   plus the notation's modifier, so `{{dice}}` stays truthful. For the dice form, `value` is
   always the total and isn't editable separately: changing the total without changing the faces
   would make `{{dice}}` lie. An operator who wants a particular result can still force the
   outcome.
3. **Value.** If it isn't pinned, it's the transform of the raw value (`multiplier`, `offset`,
   `round`).
4. **Consult and outcome**, in whichever order the table already uses (`consultFirst` in
   `executeCustomTool`):
   - The consult is **never called by recompute**. The latest entry in `consults`, or the
     `llmAnswer` override if pinned, is the answer.
   - If the prompt rendered under the current overrides differs from the prompt that produced
     the answer in use, the answer is **out of date**. The dialog shows it and offers Re-ask, but
     submitting with an out-of-date answer is allowed. The operator decides, and the record notes
     it.
   - If `outcome` isn't pinned, the winning row is re-evaluated by `matchesWhen` against the
     current subjects. If it is pinned, that row wins whatever the table says (the bypass, I5).
5. **Message, state, chip label.** If not pinned, re-rendered from the winning row and the current
   variables. A pinned message is taken as written, with no placeholder rendering.
6. **Effects.** Every declared effect is listed, not only the ones that fire. `auto` follows the
   effect's own `when` against the current subjects. `on` forces it to fire and `off` suppresses
   it. An edited `value`, `items` or `log` is taken as a **literal**, not an expression: the
   operator is editing what gets written, not the formula. Item references are still resolved at
   apply time by the existing appliers, with their existing fail-soft rules. Forcing an effect on
   never adds an effect the definition doesn't have.
7. **Visibility, announcer, title.** Taken from the overrides, or the definition's defaults. A
   `character` announcer on a run with no character falls back to Pascal, as it already does.

Recompute is pure and lives in `lib/pascal/intervention/recompute.ts`. It calls
`executeCustomTool` with `draw`, `consult` and the overrides, so it's the same engine and not a
copy. The preview, Re-ask and resolve actions all go through it.

### 3.3 Consistency warnings

These warnings are advisory, never blocking. The dialog shows a quiet note when:

- a forced outcome row doesn't match what the table would pick for the current value, and the tool
  has `revealOdds` on. A model that can see the table could notice the mismatch;
- a pinned message no longer matches the winning row's template;
- the consult answer is out of date.

## Part 4 — The dialog (client)

- **Mounting.** A `CustomToolInterventionDialog` is mounted by the Salon view for the open chat. It
  reads `GET ?action=interventions` through TanStack Query, refreshed by `useRealtimeTopic` on
  `customToolInterventions`. Any polling fallback is gated with `useRealtimeRefetchInterval`, never
  a bare interval. Because the hold lives on the server and not in the stream, **a reload or a
  second tab reopens the dialog**. If there are several holds (storyteller's simultaneous turns,
  or a trigger plus a tool call in one turn), they are shown one at a time, oldest first, with a
  "2 more waiting" note.
- **Portal.** Portaled to `document.body`, like every workspace overlay (the `.qt-workspace`
  stacking-context rule).
- **Layout.** A header names the tool (its title), the character, and how it was reached (*called
  by Mira* / *overheard: "pick the lock"*). Below it are sections in pipeline order. Each section
  shows the dealt value and, once changed, the current value with a reset control. Hidden fields
  aren't rendered at all.
  - Parameters: inputs generated the same way the popup's `CustomToolParamsForm` does (reuse it).
  - Roll: a number, or one input per die.
  - Value.
  - Consult: the prompt in a textarea, the answer with an `ok` switch, Re-ask, and an out-of-date
    marker.
  - Outcome: the table as a list of rows with their conditions summarised (reuse
    `comparator-labels.ts`), the current winner marked, and a click to force a row. Message and
    state below it.
  - Effects: one row per declared effect with its auto status, an Auto / On / Off control, and its
    resolved value, items or log line, editable.
  - Presentation: visibility, announcer, title, chip label.
  - A live preview of the Pascal bubble as it would post.
- **Buttons.** In the house voice; final wording at implementation time:
  - **Deal it**: submit with the current overrides. With no changes this is the same as "as
    rolled".
  - **As rolled**: discard every change and go ahead.
  - **Set the table aside**: veto, with a one-line confirm.
- Each edit calls `intervention-preview`, debounced. The client never computes a run itself.
- New `qt-*` classes for the dialog and the badge go into
  `app/styles/qt-components/_utilities.css` (state forms written out by hand). They are mirrored
  into `packages/theme-storybook/src/css/qt-components.css` in the same change: bump the package
  version and **stop for `npm publish`**. Reuse the existing `qt-dialog` and `qt-pascal-result--*`
  classes wherever possible.

### 4.1 The "adjusted" badge

A Pascal bubble whose `pascalMeta.intervention` is present shows a small hand mark beside its chip.
Its tooltip lists each changed field as *dealt → final* ("roll 0.12 → 0.81; outcome *Still locked*
→ *The lock clicks open*"). The badge is part of the operator's own view of the transcript, which no
model reads.

## Part 5 — The record

`pascalMeta` (`lib/schemas/chat.types.ts`) keeps its meaning: **its top-level fields describe the
run as announced**, so every existing reader (the Salon, the chip, exports, the audit) shows the
final run without changes. A new optional field records the hold:

```ts
intervention: z.object({
  resolvedAt: z.string(),                       // ISO
  decision: z.enum(['deal', 'as-rolled']),      // a veto posts nothing, so it never reaches here (I10)
  changed: z.array(z.string()),                 // field keys: 'params.bonus', 'roll', 'outcome', 'effects.2', …
  dealt: z.object({                             // the run as first dealt
    params, raw, diceRolls?, value, outcomeIndex, state, message,
    chipLabel?, toolTitle?, visibility, announcer,
    llm?: { ok, output, prompt },
    effects?: Array<{ index: number; fired: boolean; target: string; next?: unknown }>,
  }),
  reasks: z.number().int().optional(),          // consult calls made from the dialog
  staleAnswer: z.boolean().optional(),          // submitted with an out-of-date consult answer
}).optional()
```

- An **as-rolled** decision records nothing: `intervention` is absent and the message is identical
  to one that was never held. The badge exists to mark a change, and "I looked and let it stand"
  isn't one. (Changing this later would be a one-line flip.)
- `pascalMeta.llm` holds the consult that was used, whether the original or a Re-ask.
- `pascalMeta` is already stored as JSON text, so **no migration** is needed. Update DDL.md's
  description of the column, `public/schemas/qtap-export.schema.json`, and the export/import
  round-trip test. Backups carry it automatically.

### 5.1 Keeping it from the model

The model-facing paths already read `content`, not `pascalMeta`. That's the guarantee, and this
spec adds tests to keep it true:

- the `run_custom` tool result is built from the final run only;
- `buildMessageContext`, `extractVisibleConversation` (every cheap-LLM pass, including memory
  extraction and the context-summary fold), the Courier transport and `read_conversation`'s
  renderer are each fed a Pascal message carrying `pascalMeta.intervention`, and the test asserts
  that no dealt value and no "adjusted" text reach their output;
- the bid roster and the `run_custom` description don't mention intervention (1.4).

## Part 6 — Settings

`chatSettings.customToolIntervention: z.boolean().default(true)` in
`lib/schemas/settings.types.ts`, beside `customTools` and `customToolTriggers`. It does nothing
while `customTools` is off. The toggle goes in `ChatTabContent.tsx`, Pascal's area: **"Hold
intervenable rolls for me"**. Its hint says that a held roll waits for you indefinitely. It's
written to with `patchSchemaOf`, like every partial settings write.

## Part 7 — Logging

The registry and the run service log: hold opened (`info`: chat, tool, entrance, character),
each skip-the-hold reason (`debug`), preview and Re-ask (`debug`, plus the consult's own LLM log
row), resolution (`info`: decision, the list of changed fields, cause `stop` or `dialog`), and a
409 or 404 on resolve (`warn`). A veto's `info` line is its only record (I10).

## Part 8 — Documentation

- `help/custom-tools.md` gains a section, *Taking a Hand in the Deal* (house voice). It covers the
  master toggle and per-field toggles, what the dialog offers, that the model is never told, that
  a held roll waits indefinitely, Stop, and the settings switch. It also covers the store-readability
  caveat (1.3). The section is linked with `&section=` deep-links where relevant. The file's
  `url` frontmatter and In-Chat Navigation `help_navigate` call stay matched.
- The Workbench help and the settings help get the new toggles.
- `docs/CHANGELOG.md`, in plain voice.
- When complete, this file moves to `docs/developer/features/complete/` and gets a line in
  `ROADMAP.md`.

## Part 9 — Tests

- **Schema:** the new keys accepted and rejected as in 1.3. Ignored flags on a non-intervenable
  tool. The published JSON Schema stays in step (the existing mirror test).
- **Draft round-trip** (`tool-draft.ts`) with every flag set.
- **Recompute** (pure, table-driven): a parameter change keeps the unit draw. A pinned roll
  survives a parameter change. Dice faces clamp, and `{{dice}}` re-renders from them. Both
  consult orders. Out-of-date detection. A forced row. A pinned message taken literally. Effect
  modes auto, on and off, with literal values. A hidden field's override is rejected.
- **Run service:** each skip-the-hold condition (popup, job child, autonomous room, setting off,
  definition not intervenable). Hold, then deal, posts the final run with `intervention` recorded.
  As-rolled records nothing. A veto posts nothing and applies no effects. Stop resolves as a veto.
- **Registry:** first-wins resolution (a second resolve gets 409), removal on settle, a topic
  published on add and remove.
- **Entrances:** the veto's tool result for `run_custom` (no Prospero bubble): the plain wording for a plain character and for a failed transparency read; the table wording for a `systemTransparency` character and a user-controlled seat. The plain string must not contain "table", "game", "Pascal" or "operator". A trigger veto posts
  nothing.
- **Leak tests:** 5.1 and 1.4.
- **API:** the four actions, including 400 on an override for a hidden field and an unknown
  `?action=` getting 400.
- **Client:** the dialog renders only eligible fields, previews on edit, queues several holds, and
  reopens after a remount (`renderWithQuery`).

## Build order

1. **Format.** Schema, validation, published JSON Schema, Workbench toggles, draft round-trip.
   This can ship on its own, since the flags simply have no effect yet.
2. **Engine.** `draw` and `consult` replay in `executeCustomTool`, the overrides schema, and
   `recompute.ts`, all pure and fully unit-tested.
3. **Hold.** Registry, `runCustomTool` changes, entrance handling for the veto, the setting,
   realtime topic, API actions.
4. **Dialog and badge.** Client, `qt-*` classes, and the theme-storybook mirror (publish gate).
5. **Docs**, leak tests, live check on V4test: a model-called intervenable tool, a trigger, a
   reload mid-hold, a second tab, Stop mid-hold, and storyteller's simultaneous turns.

## Out of scope

- Holding the operator's own popup runs (I3). If wanted later, it's `mayHold: true` at that one
  entrance.
- Autonomous rooms (I3). Holding there would need a host-RPC wait from the job child and a
  timeout policy, and nobody is watching.
- Editing a definition from the dialog. Every change is for one run only.
- Timeouts (I2).

## As built (2026-10-22)

Implemented as specified, with these notes:

- **Settings column.** `chatSettings.customToolIntervention` lives in a `chat_settings` column like its siblings, so it needed a migration (`add-custom-tool-intervention-field-v1`, `INTEGER DEFAULT 1`) despite Part 5's "no migration", which applies to `pascalMeta` only. The toggle sits beside the trigger-phrase toggle in Settings → Chat → Automation, and the settings route validates it by hand the way its siblings are validated rather than through `patchSchemaOf`.
- **Keep-alive.** `runWithTurnControl` gained an optional `keepAlive` pinger (the orchestrator passes one per stream), read with `currentTurnKeepAlive()`; the registry pings every 15 s while a hold waits.
- **Deal is server-computed.** The resolve action recomputes the run and hands the `RecomputedRun` to the waiting turn with the decision, so the turn never recomputes. A deal whose recompute changes nothing is treated as as-rolled and records nothing.
- **Pinned state.** A pinned `state` is the state announced and the one effect conditions test (`when.outcome`); the outcome row, brief and `{{outcome.index}}` stay the winning row's.
- **The range draw** is always taken (or replayed), even for a degenerate `min === max` range, so a parameter that later widens the range still has luck to scale.
- **Re-ask** unpins `llmAnswer`: a fresh answer replaces a pinned one.
- **Consistency warnings.** "Pinned message no longer matches" is read as: the message is pinned and a row other than the one first dealt now wins.
- **CSS** lives in its own `app/styles/qt-components/_intervention.css` (like `_storyteller.css`), mirrored into theme-storybook 1.0.79.
- **The dialog** cannot be dismissed unanswered; there is no "later". The realtime topic invalidates `queryKeys.customTools.interventions(chatId)` through `topic-map.ts`; the query polls only while the socket is down.

### Live check on V4test (2026-10-22)

Verified with a throwaway intervenable tool (`Tools/brass_wheel.tool.json` in V4test's Quilltap General): a model's `run_custom` held, adjusted (parameter, forced row, two Re-asks) and dealt — Pascal posted the final run, `pascalMeta.intervention` recorded eight changed fields, the badge tooltip listed them, and the character narrated the final result; a veto posted nothing and returned "The tool did not run."; Stop mid-hold vetoed (`cause: stop`) and a second call in the same turn was vetoed at once on the stopped signal; a trigger phrase held ("overheard"); a second tab showed the same hold and resolving it there closed the first tab's dialog; a reload reopened the dialog. Storyteller's simultaneous turns were not exercised live (covered by the registry's per-hold queue).

Two known limits:

- **A reload mid-hold reopens the dialog, but the turn that was waiting does not survive the resolution.** The Salon stream has no `cancel` handling, and much of the streaming stack calls `controller.enqueue` directly; once the page that opened the stream is gone, the first raw enqueue after the hold settles throws ("Controller is already closed") and the turn ends — after a deal, Pascal's post and the effects stand, but the tool result is not saved and the character does not reply. This is pre-existing for any mid-turn disconnect; holds make it routine. A second tab does not have the problem (the first tab's stream stays open).
- **The dialog's overlay covers the composer's Stop button**, so in the tab showing the dialog the veto is the way to refuse; Stop remains reachable from another tab, and the server path is verified.
