# Storyteller Mode — Spec

**Status:** Proposal / Not Implemented
**Scope:** quilltap-server (Salon back end and client), `@quilltap/plugin-types`, `qtap-plugin-mcp`
**Prerequisite:** bug 258 (an operator whisper runs single-turn and queues behind an open stream),
[fixed 2026-10-22](../bugs/fixed/bug-258-whisper-starts-chain.md)

## Summary

A third Salon turn mode beside **Normal** (the weighted rotation, re-drawn each cycle) and
**Paused** (the operator speaks, then nudges characters one at a time).

In **Storyteller** mode each operator post opens a *round* in two phases:

1. **Bidding.** Every present LLM character is asked in parallel whether it wants to respond and,
   if so, what it plans to say and how much it plans to do: a simple reply, a reply after read-only
   lookups, or a reply that acts on the world. A bid is a plan, not a turn. It runs no tools, has
   no side effects, and never enters the transcript.
2. **Speaking.** The operator picks which bids go ahead, and those characters take real turns,
   limited to the tier they bid. They run either **in order**, following the turn manager's drawn
   rotation and seeing each other's replies, or **all at once**, as overlapping speech.

The floor then returns to the operator. Storyteller mode never chains past the round.

The design separates *wanting to speak* from *speaking*, so tool side effects happen only on turns
the operator has approved. That needs a structural notion of a tool's effect, which Quilltap
doesn't have yet. Building it is half of this spec.

## Decisions of record

Settled with the operator on 2026-10-22:

| # | Decision |
|---|---|
| D1 | Every tool declares an effect: `none` / `read` / `write` / `destroy`. Anything undeclared counts as `write`. |
| D2 | `destroy` replaces the `DESTRUCTIVE_TOOL_NAMES` allowlist (`lib/tools/destructive-tools.ts`). The autonomous-room destructive-tool gate reads the level instead. |
| D3 | A tool's effect may be fixed or computed from its input (`state` get is `read`, set is `write`). A call above the turn's ceiling is refused at execution with a tool result that says why. |
| D4 | Plugins declare an effect for each tool they add. An MCP server's configuration carries one effect, which every tool from that server inherits. |
| D5 | A Pascal custom tool's effect is derived from its definition: `read` unless it has `effects` (a `state` / `progress` write, a wardrobe, inventory or `log` effect), in which case it's `write`. Posting the outcome is reporting, not a side effect. |
| D6 | The bid prompt lists the custom tools that character can run, with each one's tier. The server computes the bid's tier from the tools it names. The character's own claim is only a cross-check. |
| D7 | Bid tiers are **Simple**, **Lookup**, **Act** and **Destroy**. A Destroy bid carries a strong warning on the board and must be selected on its own; "select all" never includes it. |
| D8 | A selected speaker gets every tool at or below its tier, not only the tools it named. The named tools show on the board as intent. |
| D9 | During storyteller turns, a custom tool fired by a trigger phrase runs only if its effect is within the speaker's tier. |
| D10 | "All at once" runs selected Simple and Lookup turns concurrently, then the selected Act and Destroy turns one at a time, in rotation order. |
| D11 | Every LLM call is recorded in the LLM log and visible in the inspector, including losing bids. Bids are otherwise not part of the record: they're not in the transcript, any context or memory. |
| D12 | Talkativeness goes into the bid prompt as a disposition. An optional per-chat filter can skip inviting low-talkativeness characters in some rounds (off by default). |
| D13 | In sequential order, a later speaker may adapt its plan to what came before it, or pass with `[NOTHING TO ADD]`. The operator accepts that a plan can drift. |
| D14 | An inform may be delivered more than once within one round. Accepted. |

## Part 1 — Tool effects

Storyteller mode depends on this part, but Part 1 is worth doing on its own: it replaces a curated
allowlist with a property every tool must declare.

### 1.1 The type

```ts
// lib/tools/effects.ts
export type ToolEffect = 'none' | 'read' | 'write' | 'destroy'
export const TOOL_EFFECT_RANK: Record<ToolEffect, number> = { none: 0, read: 1, write: 2, destroy: 3 }
export type ToolEffectSpec = ToolEffect | ((input: unknown) => ToolEffect)
```

- **`none`**: no reads and no writes beyond its own return value: decorative, a transform, a
  calculator.
- **`read`**: reads stores, the conversation, the web or a terminal's screen, and changes nothing.
- **`write`**: changes stored state: documents, state, wardrobe, inventory, mail, memory, images,
  terminal input.
- **`destroy`**: a `write` that cannot be undone from inside Quilltap: deletion.

A computed effect gets the *validated* input. If validation fails, the tool is `write` for that
call. Where an effect depends on the input, the computed form must cover every branch the schema
allows. A test feeds each tool's schema examples through it.

### 1.2 Built-in tools (`lib/tools/`)

The definitions are OpenAI-format objects that go to providers as they are, so the effect can't
live inside them. Instead:

- Each tool file exports `xxxToolEffect: ToolEffectSpec` beside `xxxToolDefinition`.
- `lib/tools/effects.ts` collects them into `BUILT_IN_TOOL_EFFECTS` and exposes
  `effectOfToolCall(name, input, ctx): ToolEffect`, the one resolver for built-in, plugin, MCP and
  custom tools.
- `lib/tools/__tests__/tool-definitions-snapshot.test.ts` fails if any registered tool has no
  effect, and records the static effect (or `computed`) in the snapshot. That makes "always
  declare it" the same kind of rule as "register new tools here."
- `DESTRUCTIVE_TOOL_NAMES` is deleted. `doc_delete_file`, `doc_delete_folder`, `doc_delete_blob`
  and `discard_mail` become `destroy`. The autonomous-room filter in `orchestrator.service.ts`
  (around line 1132) asks `effect === 'destroy'` and keeps its existing per-room and per-user
  policy. The `runDestructiveToolsAllowed` comment in `chat.types.ts` is updated to match.

Tools whose effect depends on the input include at least `state` (get/set), and probably the
inventory, wardrobe and terminal families. A full audit of `lib/tools/` is the first task of
Part 1. Its table goes into this spec before any code lands.

### 1.3 Plugins (`@quilltap/plugin-types`)

`UniversalTool` is the wire format and doesn't change. `ToolPlugin` gains an optional
`getToolEffects?(config) => Record<string, ToolEffect>`. A plugin tool missing from that map
counts as `write`, so older plugins keep working, just restricted to Act bids. This is a
`packages/` change: bump the version, **stop for `npm publish`**, then bump every bundled tool
plugin that declares effects (plugin build rules apply).

### 1.4 MCP (`qtap-plugin-mcp`)

`MCPServerConfig` gains `effect: ToolEffect`, defaulting to `write`, set on each server in the
plugin's configuration UI. Every tool discovered from that server inherits it.

MCP's own `annotations.readOnlyHint` / `destructiveHint` come from the server and aren't trusted.
The setup UI may show them as a suggestion ("this server says its tools are read-only"), but only
the operator's setting is used.

### 1.5 Pascal custom tools

`run_custom` is a single tool whose input names the custom tool. Its effect is computed:

```ts
runCustomToolEffect = (input) => customToolEffect(lookUpDefinition(input.tool))
```

`customToolEffect(def)` lives in `lib/pascal/` (pure). It returns `write` if any outcome on the
definition carries any effect (`isWriteEffect`, `isWardrobeEffect`, `isInventoryEffect`,
`isLogEffect`), and `read` otherwise. An `llm` consult is a read. The Workbench shows the derived
effect on each tool, and the bid prompt's roster shows it too (D6).

### 1.6 Enforcement chokepoint

`executeToolCallWithContext` (`lib/chat/tool-executor`) is the one place a call's effect is checked.
`ToolExecutionContext` gains `effectCeiling?: ToolEffect`, which is unset everywhere outside
storyteller turns. A call above the ceiling is not executed. It returns a tool result stating its
effect and the turn's ceiling, so the model can carry on. This check is the real guarantee.
Filtering the tool list (1.7) only spares the model offers it can't use.

### 1.7 Tool-list filtering

`buildTools()` (`streaming.service.ts`) gains the same ceiling. A tool whose *static* effect is
above the ceiling is dropped. A tool with a computed effect stays listed, and its description gets
one line explaining which uses are allowed this turn (for example "only `get` this turn").

### 1.8 Trigger phrases (D9)

`lib/pascal/trigger-runner.ts` runs from the finalizer on a character's reply. When the turn has an
`effectCeiling`, a matched tool whose `customToolEffect` exceeds it is skipped, logged at debug
level, and not posted.

## Part 2 — The mode

### 2.1 Storage

- `chats.turnMode TEXT` holds `'rotation'` (NULL reads as rotation) or `'storyteller'`. It's
  patch-only, like the Concierge columns, so a whole-row update can't overwrite it with a stale
  copy. It's added to `ChatMetadataSchema`, DDL.md, `.qtap` export and its schema, backup and
  restore, and a migration with a pretty label.
- `isPaused` remains, and the two are independent: a paused storyteller chat records operator
  posts without opening a round, just as a paused chat records them without a reply today. The
  Salon control has three positions:
  - **Normal**: `rotation` and not paused
  - **Paused**: paused, whatever the turn mode
  - **Storyteller**: `storyteller` and not paused

  Stop, the all-LLM threshold and the chain-error handler still set `isPaused` without changing
  `turnMode`, so un-pausing returns the chat to whichever of Normal or Storyteller it was in.
- **Rounds** live in a new table, `storyteller_rounds` (`id`, `chatId`, `triggerMessageId`,
  `status` open/running/closed, `bids` JSON, `selection` JSON, `createdAt`, `closedAt`). A round
  survives a reload, and the board can be rebuilt from it. When the round closes, its `bids` are
  cleared and only ids, timings and the selection are kept. The full bids stay in the LLM log
  (D11). The table is not exported or backed up, because bids are not part of the record.
- A speaking turn's message stores the bid it carried out in
  `chat_messages.storytellerBid` (JSON: `roundId`, `tier`, `plan`, `toolsNamed`). Swipe and
  regenerate re-apply it, so a re-roll runs under the same plan and ceiling. This *is* part of the
  record: it goes into DDL.md, export and its schema, and backup.

### 2.2 Opening a round

An operator public post in a storyteller chat:

1. Is persisted as normal.
2. Opens a round with `status: 'open'`.
3. Fans out one bid call per invited character (2.3) and streams a `bid` SSE event to the send's
   stream as each one arrives.
4. Closes the stream with `roundOpen { roundId }` once every bid is in or the board timeout passes
   (default 45 s; late bids still land on the round row and reach the board through realtime).

The send stream does **not** stay open waiting for a human decision. The round publishes a
`storytellerRounds` realtime topic so other tabs show the board too.

Who is invited:

- Every present, non-archived LLM-controlled CHARACTER seat. Silent seats are invited, and their
  bid prompt says they may only act or emote.
- User-controlled seats and seats under impersonation are not invited.
- With the talkativeness filter on (D12), each seat is invited with probability
  `0.25 + 0.75 × talkativeness`. The skipped seats are listed on the board as "kept quiet," so the
  operator can invite one by hand with **Ask anyway**.

Rounds that skip the board:

- **A whisper** to one character runs as it does in every mode since bug 258: one reply. There is
  nothing to bid on.
- **`@Name:` / `@Name?`** (Carina) is answered as now, and no round opens.
- **Nudge** in storyteller mode runs the nudged character as a single turn with no ceiling. Nudge
  remains the operator's direct summons.

### 2.3 The bid call

A bid is a full in-character call: same connection profile, same identity stack, same recall and
transcript as a real turn. A cheap LLM can't plan in someone else's voice.

**It must write nothing.** Building a turn today *does* write:

- `processMessage` posts Prospero's general-context and group-context whispers.
- `context-manager.ts` posts the Commonplace Book's recall whisper (`kind: 'consolidated'`, around
  line 2010).
- `deliverRecall` stamps `lastAccessedAt` and advances the anti-repetition ring.
- The Core whisper can fire.
- `takeRaisedHand` consumes a raised hand.

A bid needs a **dry build**. `buildContext` and its callers gain a `purpose: 'turn' | 'bid'` flag.
Under `'bid'`:

- recall is assembled but not delivered
- no staff whisper is posted (their text can still go *into* the context, so the bid sees what the
  turn will see)
- the Core whisper doesn't fire
- the raised hand is not consumed
- inform rows are read but not consumed
- nothing reaches the finalizer

A grep-test holds the dry path to read-only repository calls, in the same spirit as the memory
chokepoints.

**The prompt.** The bid instructions are a **trailing section** after recall, progressions and
inform, never in the system prefix. That way the bid call shares the character's cached prefix,
and it warms the cache for the same character's speaking turn. The section contains:

- that this is a chance to speak, not a turn
- the character's disposition from talkativeness, in plain words
- the tier menu: Simple; Lookup, with the read tools by name; Act; Destroy, only if the character
  has any `destroy` tool
- the custom-tool roster with each tool's derived effect (D6)
- the reply format

**Tools on the bid call.** Where the provider supports it, the same tool list is sent with tool
choice set to "none", so the cache prefix matches. Otherwise no tools are sent. Any tool call that
comes back anyway is discarded, and the call counts as a pass if no bid can be parsed.

**The reply format** is a short labelled text block, parsed as forgivingly as the sentinels in
`skip-signal.ts`:

```
BID: speak | pass
TIER: simple | lookup | act | destroy
TOOLS: doc_read_file, run_custom:entanglement_scan
PLAN: One or two sentences, in the character's own words, of what they mean to say or do.
```

A text format suits this better than a `submit_bid` tool, because the bid call must not be a tool
loop, and tool choice "none" rules a tool out. Anything unparseable is a pass, and the raw text
stays in the LLM log.

**Computed tier** = the highest of the stated tier and the effects of the named tools (D6). Each
named built-in tool is ranked by its static effect, or by its highest possible effect if computed.
Each named custom tool is ranked by `customToolEffect`. If the computed tier is above the stated
one, the board says so ("asked for Lookup, named a write tool").

**Refusals and errors.** A refused or failed bid is shown as a pass with a reason. It does **not**
call `recordModerationRefusal` and triggers no Concierge failover, because a bid is not a turn. The
LLM log row records what happened.

**LLM log.** A new `LLMLogTypeEnum` value, `STORYTELLER_BID`, plus a nullable `storytellerRoundId`
column on `llm_logs`. It is set on bids and on the speaking turns of a round (through an
AsyncLocalStorage, as `autonomousRunId` is), so the inspector can show a round as one group. DDL.md
and the inspector filter are updated with it.

### 2.4 The board (client)

The board is a panel above the composer, shown while a round is `open`, with one card per invited
seat, filled in as bids arrive. Each card shows:

- the avatar
- the plan
- a tier badge, in a danger style for Act and the strongest warning style for Destroy
- the named tools
- a "tier raised" note when it applies
- the talkativeness value
- for a pass, its reason

Controls:

- Per-card checkboxes. **Select all** never selects a Destroy bid (D7).
- **Ask anyway** on a kept-quiet seat sends one late bid.
- **Run in order**, **All at once** and **Let it lie** (select nobody; the round closes and the
  floor stays with the operator).
- Typing a new message while a round is open closes that round unrun and opens a new one.

A selection is POSTed to `/api/v1/chats/[id]?action=storyteller-run` with
`{ roundId, participantIds, order: 'sequential' | 'simultaneous' }`, which returns the SSE stream
for phase 2. The board collapses into a one-line summary of who was chosen, which stays until the
next round.

New `qt-*` classes for the board are mirrored into theme-storybook (publish gate) per the usual
rules.

### 2.5 Speaking — in order

1. `resolveCycleOrder` gives the order. It's drawn now if no cycle is under way, using the same
   weighted draw as Normal mode.
2. The selected seats are run in that order.
3. Each turn is a continue-mode `processMessage` for that seat, with:
   - `effectCeiling` = the computed tier
   - the bid stored on the message (2.1)
   - a trailing **"Your plan"** section saying:
     - what you planned
     - who has spoken since you planned it
     - that the plan is private (don't announce or quote it)
     - that you may adapt it, or pass with `[NOTHING TO ADD]` if the moment has gone (D13)
     - which tools this turn allows

   The skip option is offered even though the operator chose the speaker. That's an exception to
   the queue-popped rule, and the reason is drift.
4. Turns update `spokenThisCycleParticipantIds` as rotation turns do, so switching back to Normal
   picks up a consistent cycle.
5. There is no chain afterward. The stream ends with `chainComplete { reason: 'user_turn' }`.

Stop and raise-hand behave as in a chain: Stop ends the run and pauses the room, and a raised hand
is offered to the next speaker in line.

### 2.6 Speaking — all at once

Selected Simple and Lookup seats start together. Selected Act and Destroy seats then run one at a
time in rotation order, after the concurrent group finishes (D10).

Concurrent turns each see the transcript as it stood at the operator's post. Their messages are
saved in the order they *finish*. So the transcript reads as overlapping speech: nobody answers
anyone in the same group, and the next round sees them all.

**Assumptions that "one turn at a time" made, and how this mode handles each:**

| Concern | Handling |
|---|---|
| One SSE stream carries several turns | Every streamed event already carries `participantId`. `turnStart` / `done` gain a `concurrent: true` flag, and the Salon client keeps a map of streaming bubbles keyed by participant instead of one streaming slot (`useSSEStreaming`). This is the largest client change. |
| Turn control | All concurrent turns run under the round's single `runWithTurnControl` handle. Stop aborts them all. A raised hand is offered only to the sequential tail. |
| Wardrobe and inventory turn containers | Each concurrent turn gets its own `newWardrobeTurnContainers()`. Flushes already serialise per chat (inventory) and through `settle` (wardrobe history), so each character's announcement posts when its own turn ends. |
| Informs | May be delivered to two concurrent turns (D14, accepted). |
| Context-summary fold, auto-title, memory extraction | Run once after the whole round, triggered by the round's last message, not once per concurrent turn. |
| Prompt cache | Each character has its own prefix, and the bid warmed it. No cross-character dependency. |
| Provider rate limits | Concurrency is capped at 4 per connection profile. Extra Simple/Lookup turns wait for a free slot. |
| Prospero and Commonplace whispers before each turn | Posted per turn as now. They may interleave in the transcript. Accepted: they're targeted whispers and render collapsed. |

### 2.7 What is not in the record

- **Bids** appear only in `storyteller_rounds` while the round is open, and in the LLM log.
- **Not in context:** bids are never added to any context. `extractVisibleConversation`, the
  Courier transport and memory extraction never see them.
- **The stored plan:** a speaking turn's `storytellerBid` is stored on its message, but it is
  stripped from every model-facing transcript just like the `inform` record. Only that same
  message's own swipe reads it.
- **Losing bids** form no memories and don't count as speech for staleness ("counts as talk").

## Part 3 — Interactions

- **Autonomous rooms**: out of scope for v1. An automatic chooser (top-N bids by talkativeness)
  is a natural later addition. Nothing here should rule it out: keep the chooser a pure function of
  `(bids, chat)`.
- **Scenario Builder / chat creation**: a new chat may start in Storyteller mode. The greeting
  turn isn't a round.
- **Concierge**: phase-2 turns go through the existing failover. Only bids are excluded from the
  ledger.
- **Carina**: as in 2.2. An `ask_carina` call from a speaking turn is a `read`-effect tool.
- **Ariel terminals**: `terminal_read` is `read`. Anything that sends input to a terminal is
  `write`.
- **Help**: a new `help/storyteller-mode.md` (with `url`, and an In-Chat Navigation
  `help_navigate` that matches it), plus updates to `chat-multi-character.md` (modes),
  `chat-participants.md` (talkativeness and the invite filter), the Pascal and MCP help (effects),
  and `custom-tools.md` (derived effect, trigger-phrase rule).

## Phasing

1. **Tool effects** (Part 1): the audit table, the built-in effects, the executor ceiling, the
   `destroy` cutover, then the plugin-types publish, MCP and Pascal. This stands on its own, and
   autonomous rooms benefit right away.
2. **Dry build** (2.3): `purpose: 'bid'` through `buildContext` and the staff-whisper sites, with
   its grep-test. This also stands on its own, and is useful for any future "preview a turn"
   feature.
3. **Rounds, bids and sequential speaking**: storage, the round lifecycle, the board, and 2.5.
4. **All at once**: the client's multi-bubble streaming and 2.6.

Each phase is verified live on `V4test`, using `fd40d93a-5930-4a02-a9aa-f7a808362cff`
(Lorian and Riya, with the user-controlled Tester) as the baseline room.

## Still open

1. **Board timeout default** (45 s proposed) and whether it's a per-chat setting.
2. **The concurrency cap** (4 per profile proposed): a constant, or a profile setting.
3. **Is a whisper's reply private?** Live verification of bug 258 showed both characters answering
   an operator whisper twice: once privately through their own `whisper` tool, and once publicly,
   where Lorian partly repeated the private answer aloud. It's model behaviour, not a bug in the
   path, but the whisper prompt could say that a whispered question is normally answered with a
   whisper.
4. **Storyteller in a one-character chat**: offer the mode there at all, or hide it? (A board with
   one card is just Paused mode with a preview.)
