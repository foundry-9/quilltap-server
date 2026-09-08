# Feature: Character Progressions — timed properties reported per turn

**Status:** Implemented (v4.10-dev, 2026-09-08). All six phases shipped; the checklists below are retained as the record of what was built.
**Owner subsystems:** Aurora (character data — the vault's `metadata.json`), the per-turn context builder (`lib/chat/context-manager.ts`), and Pascal the Croupier (`lib/pascal/`, which reads and writes them).
**Implementation note:** This spec is written to be executed by Claude Code with minimal further design input. Where a choice existed, it has been made — see [Design Decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, debug logging on every touched backend path, export round-tripping, tool chokepoints, `npx tsc`). Plan in the most capable model; the phases below are written so that Phases 0, 2, 3 and 4 can each be delegated to a cheaper agent with this document as the whole brief.

## Motivation

Some facts about a character are *in progress*: a pregnancy that began on 1 August 2026 and is due 1 May 2027; a ship's cannon that takes ten minutes to recharge; a curse that lifts at the next full moon; a fermentation that finishes in three weeks. Today nothing in Quilltap can tell a character, deterministically and without the model doing arithmetic, "you are 20 weeks along" or "charge completion in eight minutes, 30% complete." The model has to be reminded by the user, or it guesses — and models are bad at both elapsed-time arithmetic and at *remembering* that time has passed at all.

A **progression** is a named, bounded span of time on a character: a start instant, an end instant, and rules for how — and how often — its state is reported to the character. Every time the character is prompted, Quilltap computes elapsed time, remaining time and percentage complete from the wall clock, decides from the progression's own cadence whether *this* turn should mention it, and if so appends a short second-person report to the uncached, per-turn tail of the prompt. Scale drives both cadence and phrasing: a pregnancy is mentioned once an hour and spoken of in weeks; a recharging weapon is mentioned every turn and spoken of in minutes and megajoules.

Progressions live in the character's `metadata.json` so that **Pascal's custom tools can read and change them** — a `fire_cannon` tool can be withheld until `progress.cannon.complete` is true and, on a successful roll, re-arm the recharge by writing a new `startTime`/`endTime`. The model never sets its own due date: progressions are authored by the user (Aurora editor or the vault file) and by Pascal's server-side effects, never by the LLM.

## Vocabulary

- **Progression** — one entry: a named span with start, end, increment unit and reporting rules.
- **Increment** (`timeIncrement`) — the unit the report *speaks in* (`week` for a pregnancy, `minute` for a recharge). It does not affect computation, only phrasing and the `increment` cadence.
- **Cadence** (`reportFrequency`) — when a prompted turn includes the report: every turn, whenever the increment ticks over, or on a wall-clock period.
- **Report** — the rendered second-person line(s) the character receives.
- **Derived fields** — what the engine computes from a progression and `now`: elapsed, remaining, percent, started, complete, quantity.

## Storage — a reserved key in `metadata.json`

Progressions are stored under **one reserved top-level key, `progressions`,** in the character vault's `metadata.json` (the file introduced by [character-metadata-json.md](complete/character-metadata-json.md)). The value is an object keyed by progression id:

```json
{
  "faction": "Ordo Aurum",
  "progressions": {
    "pregnancy": {
      "name": "Pregnancy",
      "description": "You are carrying a child.",
      "startTime": "2026-08-01T00:00:00Z",
      "endTime": "2027-05-01T00:00:00Z",
      "timeIncrement": "week",
      "percentageReport": false,
      "reportFrequency": "1h",
      "reportTemplate": "{{description}} You are {{elapsedWhole}} along; due in {{remaining}}.",
      "onComplete": "keep"
    },
    "cannon": {
      "name": "Cannon recharge",
      "startTime": "2026-09-08T14:02:10Z",
      "endTime": "2026-09-08T14:12:10Z",
      "timeIncrement": "minute",
      "percentageReport": true,
      "reportFrequency": "turn",
      "quantity": { "total": 1.0, "unit": "MJ", "precision": 1 },
      "onComplete": "once",
      "updatedAt": "2026-09-08T14:02:10Z"
    }
  }
}
```

**Why a reserved key rather than a new file or a DB column.** The user's requirement is that Pascal's tools read and change this data, and Pascal's one character-scoped store *is* `metadata.json`: its snapshot is already hydrated at run start, its effects already commit through one whole-object replace, and its `.qtap` round-trip is already done. A second file would need a second hydration path, a second write path and a second export path for no gain. The [metadata spec's](complete/character-metadata-json.md) "no reserved keys" statement is **amended** by this feature: `progressions` is reserved, and its shape is validated. Every other key stays freeform. Record that amendment as a "Correction" paragraph in that document when this lands.

**Why a record keyed by id, not an array.** Pascal addresses a progression by name in a tool file written before the character exists (`progress.cannon.complete`); a stable id decouples that address from the display `name`, which the user may edit freely.

**Absent / malformed.** A missing `progressions` key means "none." Hydration of the character is unchanged — the `metadata` parser (`lib/database/repositories/vault-overlay/parsers.ts:100-116`) stays fail-soft and shape-agnostic. Validation happens **at the point of use**: the progressions module parses `character.metadata.progressions` through `ProgressionsSchema`; an entry that fails validation is **dropped with a `warn` log naming the character, the id and the issue**, and the rest are kept. A broken entry must never hollow the character or fail a turn. There is no migration and no backfill: the key appears on first write.

## The schema

New module **`lib/progressions/schema.ts`** — Zod is the single source of truth; the published JSON Schema mirrors it (below). CLIENT-SAFE: no logging, no I/O, no server imports (the Aurora editor and the Workbench run it in the browser).

```ts
export const PROGRESSION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;     // same identifier rule as custom-tool names
export const TimeIncrementSchema = z.enum(['second', 'minute', 'hour', 'day', 'week', 'month', 'year']);
export const REPORT_FREQUENCY_PATTERN = /^(turn|increment|[1-9]\d{0,4}[smhdw])$/;
export const OnCompleteSchema = z.enum(['keep', 'once']);
export const MAX_PROGRESSIONS_PER_CHARACTER = 32;
export const MAX_REPORT_TEMPLATE_LENGTH = 500;

export const ProgressionSchema = z.strictObject({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),          // second person, the user's own words; rendered by {{description}}
  startTime: IsoDateTimeSchema,                          // ISO-8601 with offset or Z; must parse to a finite instant
  endTime: IsoDateTimeSchema,                            // must be strictly after startTime (superRefine)
  timeIncrement: TimeIncrementSchema,
  percentageReport: z.boolean().default(true),
  reportFrequency: z.string().regex(REPORT_FREQUENCY_PATTERN).default('turn'),
  quantity: z.strictObject({
    total: z.number().finite().positive(),
    unit: z.string().min(1).max(16),
    precision: z.number().int().min(0).max(6).default(1),
  }).optional(),
  reportTemplate: z.string().min(1).max(MAX_REPORT_TEMPLATE_LENGTH).optional(),
  onComplete: OnCompleteSchema.default('keep'),
  updatedAt: IsoDateTimeSchema.optional(),               // stamped by every writer Quilltap controls; see Cadence
});

export const ProgressionsSchema = z.record(z.string().regex(PROGRESSION_ID_PATTERN), ProgressionSchema)
  .refine(r => Object.keys(r).length <= MAX_PROGRESSIONS_PER_CHARACTER);
```

Field semantics, beyond what the user's sketch already fixed (`name`, `startTime`, `endTime`, `timeIncrement`, `percentageReport`, `reportFrequency` are kept **by those exact names**):

| Field | Meaning |
|---|---|
| `timeIncrement` | The unit the report speaks in. Elapsed/remaining render as whole units of this plus a remainder in the next finer unit (`year→month`, `month→day`, `week→day`, `day→hour`, `hour→minute`, `minute→second`, `second→none`): "20 weeks, 3 days". Month and year are **fixed-length** (30.436875 d, 365.2425 d) — deterministic and calendar-free; document this. |
| `percentageReport` | Whether the default report includes ", 45% complete". Custom templates use `{{percent}}` regardless. |
| `reportFrequency` | `turn` = every prompted turn. `increment` = only when the whole-unit count of `timeIncrement` has changed since the character's last turn (week 20 → week 21). `<n><unit>` (`s m h d w`) = only when the wall-clock bucket of that period has changed since the character's last turn (`1h`: at most once per clock hour). See [Cadence](#cadence--deterministic-history-derived-no-bookkeeping). |
| `quantity` | Optional scalar the span fills: `{{quantity}}` renders `current/total unit` with `precision` decimals, current = `total × clamp(percent)/100` — "0.3/1.0 MJ". |
| `reportTemplate` | Overrides the default in-progress wording. Placeholders below. Plain string substitution, no logic. |
| `onComplete` | `keep` (default): once `endTime` has passed, the completed state keeps being reported on the same cadence ("Pregnancy: complete; 3 days past due"). `once`: the completion is reported exactly on the first turn after `endTime` passed, then the progression goes silent (it stays in the file, still readable by Pascal, until the user or a tool removes it). |
| `updatedAt` | Stamped by the Aurora editor and by Pascal's applier on every write. A progression whose `updatedAt` is later than the character's last turn is reported **regardless of cadence** — a re-armed cannon is announced immediately. Hand edits through the file manager may omit it; then the next report waits for the cadence. |

### Placeholders (report templates)

Substituted by `renderProgressionReport` with the same plain-scan mechanics as Pascal's `renderTemplate` — unknown placeholders stay verbatim. `{{name}}`, `{{description}}` (empty string when absent), `{{elapsed}}` ("20 weeks, 3 days"), `{{elapsedWhole}}` ("20 weeks"), `{{remaining}}`, `{{remainingWhole}}`, `{{percent}}` (integer 0–100, clamped for display), `{{quantity}}` ("0.3/1.0 MJ", empty when no quantity), `{{start}}` / `{{end}}` (wall-clock date-time in the chat's resolved timezone — date only when `timeIncrement` is `day` or coarser), `{{increment}}` (the unit word).

### Default wording

The default template is composed from the flags, so a plain entry reads well with nothing else set:

- **In progress:** `{{name}}: {{elapsed}} elapsed, {{remaining}} remaining` + `, {{percent}}% complete` when `percentageReport` + ` ({{quantity}})` when `quantity` + `.` A `description` is prefixed as its own sentence. → *Cannon recharge: 2 minutes, 10 seconds elapsed, 7 minutes, 50 seconds remaining, 22% complete (0.2/1.0 MJ).*
- **Not yet started** (`now < startTime`): `{{name}}: begins in {{remaining}}.` (here `remaining` counts to `startTime`; percent is 0).
- **Complete:** `{{name}}: complete; {{elapsed}} since it finished.` (`elapsed` counts from `endTime`; percent is 100). `reportTemplate` applies to the in-progress state only — the other two states are short and fixed.

### Published JSON Schema

`public/schemas/qtap-progression.schema.json` (draft-07), describing the **value of the `progressions` key** — so a user editing `metadata.json` by hand can point an editor at it, and so the format is documented for tool authors. Keep it in lockstep with the Zod schema through an agreement test modelled on `__tests__/unit/lib/pascal/custom-tool-definition.test.ts` (one corpus, both validators, assert they agree; the `endTime > startTime` cross-field rule is the one accepted divergence, asserted explicitly).

## The engine — `lib/progressions/engine.ts`

Pure, client-safe, injectable clock. Everything else in the feature is plumbing around these four functions:

```ts
export interface DerivedProgression {
  id: string; name: string;
  startMs: number; endMs: number; nowMs: number;
  elapsedMs: number;            // clamp(now − start, 0, end − start)
  remainingMs: number;          // end − now, negative when overdue (uncapped)
  percent: number;              // (now − start) / (end − start) × 100, UNCAPPED (Pascal sees this)
  percentClamped: number;       // 0–100 for display
  state: 'pending' | 'active' | 'complete';
  started: boolean; complete: boolean;
  quantityCurrent?: number;
  elapsed: string; elapsedWhole: string; remaining: string; remainingWhole: string;   // formatted in timeIncrement
}

export function parseProgressions(metadata: unknown, onIssue?: (id, issue) => void): Record<string, Progression>;
export function deriveProgression(id: string, p: Progression, nowMs: number): DerivedProgression;
export function shouldReportProgression(p: Progression, d: DerivedProgression, lastTurnMs: number | null): { report: boolean; reason: ReportReason };
export function renderProgressionReport(p: Progression, d: DerivedProgression, opts: { timezone?: string }): string;
```

`formatSpan(ms, unit)` is the one place the "whole units + one finer unit" rule lives; give it its own exhaustive unit test (every unit, zero, sub-unit, exact multiples, the fixed month/year lengths, negative input never reaches it).

### Cadence — deterministic, history-derived, no bookkeeping

`shouldReportProgression` needs one input the caller supplies: **`lastTurnMs`, the `createdAt` of the responding participant's most recent `role: 'ASSISTANT'` message in this chat**, or `null` if they have never spoken. This is exactly how Aurora's Core whisper decides its cadence (`lib/chat/context/core-whisper-trigger.ts:113`, walking `events` with `isVisibleConversationalTurn` at `:66`) — the precedent for deriving cadence from history rather than storing "last reported at." Add a small shared helper `findLastOwnTurnMs(events, respondingParticipantId)` beside it and reuse it.

Rules, in order; the first that applies wins:

1. `lastTurnMs === null` → report (`first`).
2. `p.updatedAt` parses and is `> lastTurnMs` → report (`updated`).
3. State transition: `d.state` differs from the state at `lastTurnMs` (pending→active, active→complete) → report (`transition`). This is what makes `onComplete: 'once'` work without a flag: the completion turn is the one where the state flipped since the character last spoke.
4. `d.state === 'complete'` and `p.onComplete === 'once'` → **no** report (`silenced`).
5. `reportFrequency === 'turn'` → report.
6. `reportFrequency === 'increment'` → report iff `floor(elapsedAt(now) / unitMs) !== floor(elapsedAt(lastTurnMs) / unitMs)`.
7. `<n><unit>` → report iff `floor(now / periodMs) !== floor(lastTurnMs / periodMs)` (epoch-anchored wall-clock buckets).

Why no stored "last reported" timestamp: it would be a write on every prompted turn for `turn`-cadence progressions, it would race the participant-JSON whole-column replace, and in the forked job child it could not be read back within the same job (no read-your-writes — [BACKGROUND_JOBS_CHILD.md](../BACKGROUND_JOBS_CHILD.md)). The history-derived rule has **one known approximation**, to be documented in the help page: a character who is prompted but does not speak (a "nothing to add" pass) has no new own message, so a period-cadence progression can be mentioned again on their next prompt inside the same period. That is over-reporting by at most one turn per silent turn, and it is the honest trade for zero writes.

### The clock

`nowMs = Date.now()` — the **wall clock**, injected as a parameter everywhere for tests. Not the chat's fictional timestamp: a progression belongs to a character across every chat, while fictional time is per chat, so a story clock would give the same pregnancy two different ages in two rooms. The default templates print no absolute dates, so a fictional-time chat sees no contradiction between the Host's announced story date and the progress report; `{{start}}`/`{{end}}` are documented as wall-clock. Story-clock mapping is [deferred](#deferred). Timezone for `{{start}}`/`{{end}}` is the chat's resolved timezone (`options.timezone` in `buildContext`, via `resolveTimezone`, `lib/chat/timestamp-utils.ts:341`).

## Prompt integration

### Where — the uncached trailing section

**Never in system block 1.** The identity stack and `buildSystemPrompt` are the cached prefix ([PROMPT_ARCHITECTURE.md](../PROMPT_ARCHITECTURE.md) §1, §4); a per-turn clock inside them would bisect the cache, break the golden hash in `__tests__/unit/cache-determinism/system-prompt.test.ts` and the 30-turn stability eval in `__tests__/eval/cache-stability/cache-stability.test.ts`. `IDENTITY_STACK_BUILDER_VERSION` and `PROMPT_CACHE_STRUCTURE_VERSION` are **not** bumped by this feature.

The report is a **trailing per-turn section** (§9), computed in `buildContext` (`lib/chat/context-manager.ts:686`) and pushed into `trailingContextSections` at `:2592-2600`, in this order: Aurora Core → Commonplace Book recall → Suparṇā mail → **progressions** → turn-skip note. It is plain second-person prose with no Staff persona and **is not persisted as a message**: it is recomputed every turn, and a transcript whisper per turn for a `turn`-cadence weapon would be noise. (The `self_inventory` builder's known fidelity gap — it omits Taboo — now also omits this; note it in §13 of the architecture doc.)

Wrapper, one block:

```
Time-bound conditions you are carrying, as of this moment:
- Pregnancy: You are carrying a child. You are 20 weeks along; due in 18 weeks, 4 days.
- Cannon recharge: 2 minutes, 10 seconds elapsed, 7 minutes, 50 seconds remaining, 22% complete (0.2/1.0 MJ).
```

Emitted only when at least one progression reports this turn; otherwise **nothing, byte-for-byte** (the empty-is-identical guarantee every trailing section keeps).

### Branches the composer already has

- **Normal turn:** appended to the new user message with the `---` separator (`:2598`).
- **No new user message** (chained autonomous turns, nudges): the `else if` at `:2603-2612` pushes trailing content as its own `role: 'user'` message; the progressions section joins the turn-skip note there. Whisper role must end `user` (§14 trap).
- **Continue mode** (`isContinueMode`): **skip** — the model is finishing its own sentence; the Core whisper skips here too.
- **Autonomous rooms:** nothing extra — autonomous turns run the same `buildContext` (`lib/background-jobs/handlers/autonomous-room-turn.ts:25` → `handleSendMessage`). The engine is pure and the reads pass through the job-child proxy; there are no writes on this path.

### Inputs available at that point

`buildContext` already holds `respondingParticipant`, `participantCharacters` (the hydrated `Character` map — `character.metadata` is populated by the read overlay, `read-overlay.ts:187-196`), the event list, `options.timezone`. Only the responding character's progressions are considered; user-controlled seats are never prompted and get nothing. Multi-character rooms therefore see each character's own conditions only.

### Other prompt paths

| Path | Action |
|---|---|
| **Greeting** (`lib/chat/initialize.ts:112`, its own flat builder) | Append the report after the subprompts block with `lastTurnMs = null` (force). The opener should know she is pregnant. |
| **Carina** (`lib/services/carina/carina.service.ts:584-586`) | Append to the `role: 'user'` question, not to the single system message (which carries the Anthropic breakpoint at index 0). Force-report. |
| **Character-voiced announcer**, **help chat**, **Brahma** | No. |
| **`self_inventory`** | No (documented gap). |

### Chokepoint

All prompt-side reads go through one function, **`buildProgressionsSection({ character, events, respondingParticipantId, nowMs, timezone, force? })`** in `lib/progressions/prompt-section.ts` (server side; logs). Add it to CLAUDE.md's chokepoint list: *derived progression state comes from `lib/progressions/`; never re-derive elapsed/remaining/percent at a call site.*

## Pascal integration

Custom tools gain a **`progress` family** — a read subject, a gate subject, a template/expression family, and an effect target — shaped exactly like `metadata`, backed by the engine's derived fields. `now` becomes a reference too.

### Reads — `progress.<id>.<field>`

Derived fields exposed per progression, all primitives so the existing fail-soft comparison table applies unchanged:

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `percent` | number | uncapped (can be negative before start, above 100 after end) |
| `elapsedMs`, `remainingMs` | number | `remainingMs` negative when overdue |
| `startTime`, `endTime` | number | **epoch milliseconds** — numbers, so ordering comparators and arithmetic work |
| `started`, `complete` | boolean | |
| `state` | string | `pending` / `active` / `complete` |
| `quantity` | number | current amount; absent when no `quantity` block |
| `elapsed`, `remaining` | string | formatted in `timeIncrement` |

Implementation: `flattenProgressions(metadata, nowMs): Record<string, Primitive>` builds a sheet keyed `"<id>.<field>"`. Then:

- **`when.progress`** — `WhenObjectSchema` (`lib/pascal/custom-tool.types.ts:457-460`) gains `progress: z.record(z.string(), ComparatorSchema)` beside `metadata`. `matchesWhen` evaluates it with **`metadataComparatorHolds`** (`lib/pascal/metadata-match.ts:72`) against the flattened sheet — one semantics table, no new comparison code. Absent id or field → the comparator is false, debug-logged, row declines, catch-all answers (the metadata doctrine).
- **Gates** — `availableWhen` / `withheldWhen` (`:436-439`) gain the `progress` subject; `evaluateToolGate` (`lib/pascal/tool-gate.ts`) takes the flattened sheet alongside the metadata sheet. `availableWhen: { progress: { "cannon.complete": { eq: true } } }` is the whole weapon-recharge use case. Fail-closed / fail-open reads exactly as for metadata. Gates are evaluated at roster time; the roster already holds the invoker's metadata (`RosterContext.metadata`), so derivation adds no reads.
- **Templates / expressions** — `classifyPlaceholder` (`lib/pascal/placeholders.ts`) gains `{ kind: 'progress'; id; field }` for `progress.<id>.<field>` and `{ kind: 'now' }` for `now`. `renderTemplate` renders numbers like `{{params.x}}`; absent → verbatim + debug log. `expressions.ts` accepts both refs automatically through `isKnownRef`.
- **`{{now}}`** — epoch milliseconds at run start, one value for the whole run. This is what lets an effect write `{{now}} + 600000`.

Load-time validation is the metadata-shallow kind: shape and operand types only; ids and fields cannot be known from the file. `formatDefinitionIssues` needs no change.

### Writes — effect targets `progress.<id>.<field>`

`parseEffectTarget` (`custom-tool.types.ts:621-649`) gains a third branch: `progress.<id>.<field>` where `<id>` must match `PROGRESSION_ID_PATTERN` and `<field>` is one of the **writable fields**: `name`, `description`, `startTime`, `endTime`, `timeIncrement`, `percentageReport`, `reportFrequency`, `onComplete`, `reportTemplate`, `quantity.total`, `quantity.unit`, `quantity.precision`, plus the pseudo-field **`remove`** (write `true` to delete the progression). Anything else is a load-time rejection with the field list in the reason.

Applier (`lib/pascal/side-effects.ts`, the metadata branch at `:123-137`):

1. Progress effects fold into the same `metadataNext` RMW copy, under `metadataNext.progressions[id]`. **One character write** still lands at `:194` — progressions ride inside the metadata replace, so the job-child contract is untouched.
2. A write to an id that does not exist **creates** it with defaults: `name = id`, `startTime = now`, `endTime = now + 1h`, `timeIncrement` inferred from the span once `endTime` is known (`< 2 min → second`, `< 2 h → minute`, `< 2 d → hour`, `< 2 w → day`, `< 8 w → week`, `< 2 y → month`, else `year`), `percentageReport = true`, `reportFrequency = 'turn'`, `onComplete = 'keep'`. Effects apply in file order and see each other's values via the local copy, so `endTime` first then `startTime` is fine.
3. Time fields accept a **number (epoch ms)** or an **ISO string**; both are normalised to ISO on write. A `{{now}} + 600000` expression is the expected idiom.
4. After all effects for a run are folded, every touched progression is re-validated through `ProgressionSchema`. An invalid result (e.g. `endTime` not after `startTime`) **drops that id's writes** with a `warn` log, restores the pre-run entry, and the roll still stands — never a throw, Pascal still announces.
5. `updatedAt` is stamped with `now` on every touched entry, so the next prompt reports the change immediately (cadence rule 2).
6. `pascalMeta.effects` records these like any effect — `target` `"progress.cannon.endTime"`, `previous`, `next`; the entry shape (`lib/schemas/chat.types.ts:418-431`) has no store enum to extend, so **no schema or export change**. The Workbench dry run shows resolved progress writes with no route change (`handlePreview` spreads `...result`).

The **manual popup** keeps its existing asymmetry: progress writes apply only when `asCharacterId` names a character (a run nobody made re-arms nobody's cannon); the LLM path uses the rolling character. Both entrances already hydrate the character's metadata at run start (`run-custom-handler.ts:122-127`, `app/api/v1/chats/[id]/custom-tools/route.ts` ~`:441`) — derive the progress sheet from that same snapshot with a single `nowMs` taken at run start.

### Roster and vocabulary

- `RUN_CUSTOM_PREAMBLE` gains one sentence: some tools consult, or adjust, the rolling character's timed progressions (recharges, gestations, countdowns) server-side. Re-run `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`.
- `collectToolVocabulary` (`lib/pascal/tool-vocabulary.ts:92`) gains `progress: string[]` (ids read: `when.progress`, gates, `{{progress.*}}`) and `progressWrites: string[]` (ids written). Update `isEmptyVocabulary`, the run dialog's "What this tool can quote" panel (`components/chat/CustomToolsDropdown.tsx` / `CustomToolRunDialog.tsx`) with "reads progress: cannon" / "may adjust progress: cannon" lines. Never values.
- With `revealOdds: true`, `progress` clauses render in the roster like any other comparator; under `revealOdds: false` nothing beyond the preamble.

### Workbench

- **Proving bench** (`components/custom-tools/ProvingBench.tsx:291-340`): the mock fact sheet already accepts any JSON, so a hand-typed `progressions` block works with no new field. The bench derives at `Date.now()` on each roll; add a small read-only "Progressions derived from this sheet" list under the fact-sheet card so the author can see `cannon.percent` before rolling.
- **Builder**: the condition-chip subject select in `OutcomesSection.tsx` and `GateSection.tsx` gains "progress" with a free-text `id.field` key (the metadata chip is the template); `SideEffectsSection.tsx:170`'s target-prefix affordance gains `progress.`; the placeholder insert menu gains `now` and a `progress.` entry. `tool-draft.ts` round-trips the new shapes verbatim (`validateDraft`: target parses, field is writable). Keep it minimal; the JSON mode is always available.

### What Pascal cannot do

- No `progress_set` LLM tool and no `state`-tool access to progressions: a model setting its own due date is exactly the fudge Pascal exists to prevent. Transparent characters can still edit `metadata.json` through `doc_*` tools, as they can any vault file — the existing, documented caveat.
- No scheduling: a progression completing does not fire a tool. Completion is observed at the next prompt (the report) or the next roster resolution (a gate).

## Aurora editor

A **"Progressions"** card on the character edit page, sibling to where `SubpromptsSection` (`components/characters/system-prompts-editor/SubpromptsSection.tsx`) landed — pick the tab whose neighbours are the other "what this character carries" editors, not the prose-field tab. New `components/characters/progressions/ProgressionsSection.tsx` + `ProgressionEditorModal.tsx`:

- List of entries (name, state pill, one-line live report rendered by the client-safe engine at `Date.now()`), add / edit / delete.
- Editor fields: id (identifier-coerced from the name on create, immutable afterwards — the subprompts precedent), name, description, start / end (`datetime-local` inputs in the browser's timezone, stored as ISO with offset), duration shortcut ("ends N units after start"), increment select, cadence (radio: every turn / when the unit changes / every `n` `unit`), percentage toggle, quantity (total, unit, precision), template textarea with a placeholder legend and a live preview line, on-complete select.
- **Save** = client-side read-modify-write of the hydrated character's `metadata`: spread every other key untouched, replace `progressions`, stamp `updatedAt` on the edited entry, `PUT /api/v1/characters/[id]` with `{ metadata }` (the PUT route already routes `metadata` into the vault as a whole-object replace, `app/api/v1/characters/[id]/handlers/put.ts:77-81` → `managed-fields.ts:461-475`). No new API route. Every character write already publishes `characters/<id>` on the realtime bus; the section reads through `queryKeys.characters.detail(id)`.
- Archived characters: the tombstone rule already refuses the PUT; render the card read-only when `archivedAt` is set.
- The AI Wizard, summon-from-lore and the Character Optimizer do not read or write progressions (audit `collectTemplateFields` / `applyCharacterFieldUpdates` — `metadata` is already excluded there; keep it so).

## Export / import / backups / DDL

- **`.qtap`:** nothing new. `metadata` is already materialised on the character record and travels as the vault document (`qtap-export.schema.json:427`); `progressions` rides inside. `pascalMeta.effects` entries with `progress.*` targets are free-form strings there already.
- **SillyTavern:** omitted, like the rest of metadata.
- **Backups:** automatic.
- **DDL.md:** the character-vault file table's `metadata.json` row gains: "reserved key `progressions` — validated by `lib/progressions/schema.ts`, JSON Schema `qtap-progression.schema.json`."
- **Migrations:** none.

## Logging

Debug logs on every new backend path, via the built-in logger: per turn, the responding character id, each progression id with its derived state, cadence reason (`first` / `updated` / `transition` / `silenced` / `turn` / `increment` / `period` / `skip`), and whether the section was emitted; `warn` for dropped invalid entries (character id, progression id, Zod issue); Pascal applier: each progress write with previous/next and any post-validation drop.

## Engineering tasks (phased)

### Phase 0 — schema + engine (pure; delegable)

- [x] `lib/progressions/schema.ts` — Zod schemas, constants, `IsoDateTimeSchema`, `endTime > startTime` refine, id pattern, cadence regex.
- [x] `lib/progressions/engine.ts` — `parseProgressions`, `deriveProgression`, `formatSpan`, `shouldReportProgression`, `renderProgressionReport`, default-template composition, `flattenProgressions`, `inferIncrement`.
- [x] `public/schemas/qtap-progression.schema.json` + agreement test.
- [x] Tests (`__tests__/unit/lib/progressions/`): schema accept/reject matrix; `formatSpan` per unit; derivation at before/at/after start and end (percent uncapped, clamped, quantity current); cadence rule table incl. `null` last turn, `updatedAt` forcing, state transitions, `once` silencing, `increment` ticks, period buckets across a bucket edge; rendering with and without description/percent/quantity, custom template, unknown placeholder verbatim; `flattenProgressions` field set.

### Phase 1 — prompt integration

- [x] `lib/chat/context/core-whisper-trigger.ts` — `findLastOwnTurnMs` (exported, tested).
- [x] `lib/progressions/prompt-section.ts` — `buildProgressionsSection` (logs; the chokepoint).
- [x] `lib/chat/context-manager.ts` — compute after Suparṇā mail, push before the turn-skip note (`:2592-2600`); the `else if` branch (`:2603`); skip on `isContinueMode`.
- [x] `lib/chat/initialize.ts` greeting builder — forced report after subprompts.
- [x] `lib/services/carina/carina.service.ts` — forced report appended to the user question.
- [x] Tests: `__tests__/unit/cache-determinism/system-prompt.test.ts` — assert block 1 is byte-identical with progressions present (the negative guarantee); context-manager test for placement/order and the empty-is-identical case; greeting and Carina append tests; eval `cache-stability.test.ts` still green.

### Phase 2 — Pascal reads (delegable)

- [x] `placeholders.ts` (`progress`, `now`), `custom-tool.types.ts` (`WhenObjectSchema.progress`, gate subject), `custom-tools.ts` (`OutcomeSubjects.progress`, `now`, `matchesWhen` branch via `metadataComparatorHolds`, `renderTemplate` families), `tool-gate.ts` (progress sheet), `metadata-match.ts` (no change expected — verify), `tool-vocabulary.ts` (`progress`, `progressWrites`).
- [x] Both entrances + Workbench route derive the sheet from the run-start snapshot with one `nowMs`.
- [x] `run-custom-tool.ts` preamble sentence; snapshot `-u`.
- [x] `qtap-custom-tool.schema.json` mirror (`progress` in `When`, gates, effect targets) + agreement corpus.
- [x] Tests: when/gate/template/expression matrix incl. absent id, absent field, wrong-type comparator, `$param` operands, `{{now}}` arithmetic.

### Phase 3 — Pascal writes (delegable; depends on 2)

- [x] `parseEffectTarget` progress branch + writable-field list + `remove`.
- [x] `side-effects.ts` — fold into `metadataNext.progressions`, create-with-defaults, time normalisation, post-validation drop, `updatedAt` stamp.
- [x] Manual-route asymmetry preserved; Workbench dry-run shows the writes.
- [x] Tests: create/update/remove; ISO and epoch inputs; invalid result dropped and roll stands; single character write; job-child (buffered proxy) path; `pascalMeta.effects` entries.

### Phase 4 — Aurora editor + Workbench UI (delegable)

- [x] `components/characters/progressions/` section + modal; wired into the edit page; RMW save; archived read-only; realtime refetch.
- [x] Workbench: subject/target/placeholder affordances; bench derived list.
- [x] Component tests with `renderWithQuery`; payload-shape test for the PUT body (spreads other metadata keys untouched).

### Phase 5 — docs

- [x] `help/character-progressions.md` (new; `url: /aurora/:id/edit`, In-Chat Navigation `help_navigate(url: "/aurora/:id/edit")`; steampunk voice): what a progression is, the two worked examples, cadence semantics in plain terms including the silent-turn approximation and fixed-length months, the placeholder legend, `onComplete`, hand-editing `metadata.json` with the schema link, and that the LLM cannot set them.
- [x] `help/custom-tools.md` and `help/pascals-workbench.md` — the `progress` subject, `{{now}}`, effect targets and the create-on-write defaults, the `remove` pseudo-field.
- [x] `help/shared-character-vaults.md` — `metadata.json` now has one reserved key.
- [x] `help/character-editing.md` — link to the new page.
- [x] `docs/developer/PROMPT_ARCHITECTURE.md` §9 (new trailing section, order), §13 (Carina, greeting, `self_inventory` gap), §15 (key files).
- [x] `docs/developer/features/complete/character-metadata-json.md` — Correction: reserved key; the "no prompt injection" statement now reads "raw metadata is never injected; the derived progression report is the one sanctioned reader." Same amendment to the normative doc comment at `lib/schemas/character.types.ts:172-185`.
- [x] `docs/developer/features/pascal-custom-tools.md` — `progress` row in the subject table, `{{now}}` and `{{progress.*}}` in Templating, effect targets.
- [x] `docs/developer/DDL.md`, `docs/CHANGELOG.md` (plain voice), CLAUDE.md chokepoint bullet, `.claude/commands/update-documentation.md` (new help page), `docs/developer/API.md` (no new routes — note the PUT `metadata` usage only if the doc enumerates fields).

## Verification (live, on the V4test instance — never Friday)

1. Give a character the two example progressions through the Aurora editor; open a chat; confirm the first turn's LLM request (tail `logs/combined.log`, or the LLM log viewer) carries the section after Suparṇā mail and that system block 1's hash is unchanged from a chat without progressions.
2. Send three quick turns: the cannon line appears every turn with advancing numbers; the pregnancy line appears once and not again within the hour.
3. Wait past the cannon's `endTime` with `onComplete: 'once'`: exactly one "complete" report, then silence; flip to `keep` and see it persist.
4. Author `fire_cannon.tool.json` with `availableWhen: { progress: { "cannon.complete": { eq: true } } }` and effects `progress.cannon.startTime = {{now}}`, `progress.cannon.endTime = {{now}} + 600000`. Confirm the tool is absent from the roster while charging, present when complete, that a run re-arms it (`metadata.json` shows new ISO times and `updatedAt`), that the very next turn reports the reset regardless of cadence, and that `pascalMeta.effects` lists both writes. Repeat through the composer popup with and without `asCharacterId`.
5. Run one turn in an autonomous room and confirm the section appears and no write occurs on the prompt path.
6. Export `.qtap`, import into a scratch instance, confirm `progressions` survive on the character.

## Design Decisions (resolved)

1. **Reserved `progressions` key inside `metadata.json`**, not a new file, column or the state cascade. Pascal's character-scoped store is metadata; reuse its hydration, write, and export paths. The metadata spec's "no reserved keys" is amended.
2. **Record keyed by identifier**, so tool files can address a progression before the character exists and the display name stays free to change.
3. **The user's field names are kept verbatim** (`name`, `startTime`, `endTime`, `timeIncrement`, `percentageReport`, `reportFrequency`); `description`, `quantity`, `reportTemplate`, `onComplete`, `updatedAt` are added because the examples (megajoules; "how it's told") need them.
4. **`reportFrequency` is a small closed grammar** (`turn` / `increment` / `<n><unit>`), validated by regex — not free text, not a cron expression.
5. **Cadence is derived from message history, never stored.** Zero writes on the prompt path, no participant-JSON race, job-child safe. The silent-turn over-reporting approximation is accepted and documented.
6. **Wall clock, not fictional time.** A progression spans every chat; fictional clocks are per chat. Default wording prints no absolute dates, so fictional-time chats see no contradiction.
7. **Trailing per-turn section, ephemeral, no persona.** Recomputed each turn; not a persisted whisper; outside the cached prefix; no version bumps.
8. **Fixed-length month and year.** Deterministic, no calendar library (none is a dependency), and "8 months along" does not need calendar months.
9. **Pascal gets a typed `progress` family, not raw metadata pokes.** `{{metadata.progressions}}` is a non-primitive and would fail soft everywhere; the derived sheet gives tools `percent`/`complete`/`remainingMs` for free, reuses `metadataComparatorHolds` unchanged, and effect writes fold into the existing single metadata replace.
10. **`{{now}}` is a Pascal reference** so effects can express "ten minutes from now" without a date grammar.
11. **Create-on-write with inferred defaults**, post-validated, fail-soft. A tool can arm a countdown that no human pre-authored; a broken result never sinks the roll.
12. **The LLM never writes progressions directly.** User (Aurora editor, vault file) and Pascal effects only.
13. **An Aurora editor ships in v1.** Hand-editing ISO timestamps in a JSON file is the wrong surface for "you became pregnant on 1 August."

## Deferred

- **Per-chat overrides** (mute a progression in one room, different cadence per chat) — would need a participant-record field and a recompile-free read; wait for a real request.
- **Story-clock progressions** (`clock: 'story'`, mapped through the chat's `fictionalBaseTimestamp` / `fictionalBaseRealTime`) — solvable, since story time runs 1:1 with the wall clock from an anchor, but it is per chat by nature; design with per-chat overrides.
- **Completion-triggered tool runs** ("when the fuse burns down, run `explode`") — Pascal has no scheduler; a scheduler is a feature of its own.
- **Non-linear or multi-stage progressions** (trimesters with their own wording) — expressible today with several entries; a `stages` array is a v2 schema addition, which is why the schema is strict now and would grow additively.
- **A CLI subcommand** (`npx quilltap characters progressions …`) — the vault file is readable through the existing document commands.
