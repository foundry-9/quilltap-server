# Feature: Trigger phrases — words that pull Pascal's lever

**Status:** Implemented (4.11-dev, 2026-10-15). Implementation notes at the end ([As built](#as-built)).
**Owner subsystem:** Pascal the Croupier (`lib/pascal/`), with one chat-settings toggle beside the auto-RNG one.
**Extends:** [pascal-custom-tools.md](pascal-custom-tools.md) (read first) and the auto-detect RNG precedent in `lib/services/chat-message/rng-pattern-detector.service.ts`. Independent of [pascal-wardrobe-effects.md](pascal-wardrobe-effects.md), but the two compose: a trigger phrase that fires a tool with a wardrobe effect is "say the word and the cloak goes on".
**Implementation note:** Written to be executed by Claude Code (Opus) with no further design input. Where a choice existed it has been made — see [Design decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, logging, migration pretty-labels and progress, no stubs, the Pascal chokepoints).

## Motivation

When anyone in a chat writes `2d20`, and Auto-Detect RNG is on, the dice are thrown without anyone reaching for a tool. A custom tool has no such reflex: it runs only when a model calls `run_custom` or the operator opens the popup. Yet many custom tools are *about* something that gets said. "I draw my sword" could roll the initiative table. "Abracadabra" could run the transformation. "Let's see what the oracle says" could consult the oracle. The author knows the exact words; what is missing is a way to tell Pascal "when you hear these, deal."

This feature lets a custom tool declare **trigger phrases** — exact, case-insensitive substrings — and adds an **off-by-default** chat setting under which any message from anyone in the chat (the operator, a user-driven seat, an LLM character, a character in an autonomous room) that contains such a phrase runs that tool automatically, with every parameter at its default, and Pascal announces the outcome as he would for any other run. Carina's answers and the staff's announcements are never scanned.

## Doctrine (read first)

1. **The definition owns its phrases.** Triggers are a key of the `.tool.json` file, not a separate registry: the file is the single source of truth for what a tool is, and tier shadowing, availability gates and `disabled` all apply to a triggered run exactly as to any other. There is nothing to keep in sync.
2. **A triggered run is an ordinary run.** Same roster resolution, same cascade, same effects, same Pascal post, same failure path (Prospero's error bubble; Pascal never announces a run that did not happen). The only differences are provenance (`invokedBy: 'trigger'`, the phrase) and that the parameters are always the defaults.
3. **Substring, case-insensitive, nothing cleverer.** No word boundaries, no regex, no stemming. `"fire"` matches `"fireplace"`. Authors who want precision write longer phrases. This is the user's stated requirement and it keeps the scanner a one-liner with no grammar to validate.
4. **Only words someone said are scanned.** The two sites that already run the auto-RNG scan — the operator's message in the orchestrator and the character's reply in the finalizer — are the two sites here. Pascal's own outcomes, Carina's answers, Prospero's bubbles, the Host's and Aurora's announcements, tool messages and informs never pass through either, so none of them can fire a trigger, and a tool cannot trigger itself through its own announcement. The one subtraction inside a scanned message is a Carina query line (`@Name: …` / `@Name? …`): that line is addressed to the reference desk, not spoken in the scene.
5. **Off by default.** `chatSettings.customToolTriggers` defaults to `false`, and is dead when the `customTools` master switch is off.

## 1. Definition schema

`lib/pascal/custom-tool.types.ts`, a new optional top-level key on `QtapCustomToolSchema` (after `chipLabel`, before `availableWhen`):

```ts
export const MAX_TRIGGERS = 8;
export const MIN_TRIGGER_PHRASE_LENGTH = 3;
export const MAX_TRIGGER_PHRASE_LENGTH = 80;

triggers: z
  .array(z.string().min(MIN_TRIGGER_PHRASE_LENGTH).max(MAX_TRIGGER_PHRASE_LENGTH))
  .min(1)
  .max(MAX_TRIGGERS)
  .optional()
  .describe(
    'Phrases that run this tool automatically, with every parameter at its default, when a message from anyone ' +
      'in the chat contains one — exact substrings, case-insensitive, no wildcards. Only honoured when the chat ' +
      'setting "Auto-Run Custom Tools on Trigger Phrases" is on (it is off by default).'
  ),
```

Load-time rules (a new `validateTriggers` in the existing `superRefine`):

- Each phrase is **stored as written** but must equal its own `trim()` (leading/trailing whitespace is a typo; reject with "trigger N has leading or trailing whitespace").
- No two phrases in one tool may be equal case-insensitively.
- `MIN_TRIGGER_PHRASE_LENGTH` is 3 to keep `"a"` and `"ok"` out; it is a length, not a word count.
- **Warning, not rejection, in the Workbench only:** an outcome `message` (or `chipLabel`, or `llm.prompt`) of this tool that contains one of its own phrases. Pascal's announcement is never scanned (Doctrine 4), but a model that *narrates* the announcement back will say the words, and the tool fires again on the next reply. `validateDraft` emits the warning with the row that carries it; discovery does not.

`KNOWN_TOP_LEVEL_KEYS` picks the key up from the schema shape. Mirror it into `public/schemas/qtap-custom-tool.schema.json` (array of strings with `minLength`/`maxLength`/`minItems`/`maxItems`/`uniqueItems`; case-insensitive uniqueness and the trim rule are `description` text — add both to the agreement test's accepted-divergence list). Add a `triggers` entry to `docs/developer/CUSTOM_TOOL_SPEC_DICE.json` (the dice specimen is the shorter file) with a `description` explaining it.

`triggers` is **never** sent to the model: it is not in `buildRunCustomDescription`'s output under either `revealOdds` setting. A phrase is something said in the fiction, not a mechanic the model reaches for; `run_custom` remains its door. (It is, like everything else in the file, readable by anyone who can read the store — the `revealOdds` caveat applies.)

## 2. The scanner — new `lib/pascal/trigger-phrases.ts`

Pure and client-safe (the Workbench may reuse it for its warning). Imports only `custom-tool.types.ts` and the Carina line predicate.

```ts
export const MAX_TRIGGER_RUNS_PER_MESSAGE = 4;

export interface TriggerHit {
  /** The tool's `name`. */
  tool: string;
  /** The phrase as written in the definition. */
  phrase: string;
  /** Offset of the match in the scanned text — for ordering only. */
  index: number;
}

/**
 * Strip Carina query lines, fold case, and find every tool whose phrases the text
 * contains. ONE hit per tool — the earliest occurrence of any of its phrases — in
 * order of appearance, capped at MAX_TRIGGER_RUNS_PER_MESSAGE (the rest are
 * returned separately so the caller can log them).
 */
export function scanTriggerPhrases(
  content: string,
  tools: Iterable<Pick<QtapCustomTool, 'name' | 'triggers'>>,
): { hits: TriggerHit[]; dropped: TriggerHit[] };
```

Rules:

- Folding is `toLocaleLowerCase()` on both sides (the mention ranker's precedent, `lib/mentions/mention-typeahead.ts`). No Unicode normalisation beyond that.
- The Carina subtraction uses a new export in `lib/chat/carina-parser.ts`: `stripCarinaQueryLines(text: string): string`, built on the module's existing `LINE_RE` so the two never disagree about what a query line is. It removes **every** line that parses as a query, not just the first (the parser fires only the first; the scanner should not scan any).
- A tool with no `triggers` contributes nothing. A tool with several phrases present fires once.
- Two tools whose phrases both match fire both (ordered by index); a phrase that is a substring of another tool's phrase fires both tools — documented, not prevented.
- The cap is on **tools fired per message**, not matches. Over the cap, the earliest four fire and the rest are logged at `warn` with the tool names — never silently truncated (the roster-cap precedent).

Tests: `__tests__/unit/lib/pascal/trigger-phrases.test.ts` — case folding, substring (not word) semantics, one-per-tool, ordering, cap and `dropped`, Carina line stripping (public and whisper forms, smart quotes, a query line in the middle of a message), empty content, tools without triggers.

## 3. One run service for every entrance — refactor first

Today the LLM entrance (`lib/tools/handlers/run-custom-handler.ts`) and the manual route (`app/api/v1/chats/[id]/custom-tools/route.ts`) each carry a ~100-line copy of the same sequence: read the cascade, `executeCustomTool`, `applyCustomToolEffects`, `buildPascalResultContent`, `postPascalResult` with an identical `pascalMeta` literal. A third entrance would make a third copy. **Extract it first.**

New `lib/pascal/run-service.ts` (server-only):

```ts
export interface RunCustomToolParams {
  userId: string;
  chatId: string;
  /** The resolved roster entry — the caller resolves the roster (its perspective rules differ per entrance). */
  entry: DiscoveredCustomTool;
  /** Supplied parameters; null/undefined = every default. */
  parameters: Record<string, unknown> | null | undefined;
  /** Explicit privacy, or undefined for the definition's default. */
  private: boolean | undefined;
  /** The rolling character, or null for a run nobody made (metadata/progress/wardrobe effects then skip). */
  characterId: string | null;
  /** The rolling character's hydrated fact sheet ({} for a run nobody made). */
  metadata: Record<string, unknown>;
  /** Who the whisper goes to when the run is private. */
  whisperTargetIds: string[] | null;
  /** Provenance for pascalMeta. */
  invokedBy: 'llm' | 'user' | 'trigger';
  callerParticipantId: string | null;
  triggerPhrase?: string;
  /** The turn's announcement set, inside a model turn. */
  pendingWardrobeAnnouncements?: Set<string>;
  /** One clock reading for the whole run. Defaults to Date.now(). */
  nowMs?: number;
}

export type RunCustomToolOutcome =
  | { ok: true; result: CustomToolRunResult; posted: MessageEvent | null; appliedEffects: AppliedEffect[] }
  | { ok: false; reason: string; whisper: boolean };

/**
 * Deal one hand: cascade → execute → effects → Pascal's post. Resolves the group
 * scope from `characterId` (a run nobody made gets `{ kind: 'none' }`). Catches
 * CustomToolRunError into `{ ok: false }`; rethrows anything else. Never posts
 * the Prospero error bubble — that stays with the entrance, which knows how to
 * report to its caller.
 */
export async function runCustomTool(params: RunCustomToolParams): Promise<RunCustomToolOutcome>;
```

Both existing entrances become: resolve the roster their way → `runCustomTool` → report (Prospero bubble + model result / HTTP response) exactly as they do now. Their behaviour must be **byte-identical** before and after: the existing `custom-tools-*` tests, `run-custom-handler` tests and the route tests are the regression net; add a service test (`__tests__/unit/lib/pascal/run-service.test.ts`) covering the cascade-unavailable fallback, effects-before-post, post-failure-leaves-effects, and the three `invokedBy` values landing in `pascalMeta`.

(If [pascal-wardrobe-effects.md](pascal-wardrobe-effects.md) lands first, its `userId` / `pendingWardrobeAnnouncements` parameters to `applyCustomToolEffects` are simply forwarded from here. If it lands second, it adds them here instead of in two entrances.)

## 4. The runner — new `lib/pascal/trigger-runner.ts`

Server-only; the thing both scan sites call. **Never throws.**

```ts
export interface TriggeredSpeaker {
  /** The participant whose words these are — the whisper target for a private tool. */
  participantId: string | null;
  /** Their character, when the seat is a character (LLM-driven, user-driven or impersonated). null = the bare operator. */
  characterId: string | null;
}

export interface RunTriggeredCustomToolsParams {
  userId: string;
  chatId: string;
  /** The message text as persisted. */
  content: string;
  speaker: TriggeredSpeaker;
  projectId: string | null;
  /** Every character in the chat (the 'participant' tier). */
  characterIds: string[];
  /** The chat settings already in hand at the call site. */
  chatSettings: Pick<ChatSettings, 'customTools' | 'customToolTriggers'> | null | undefined;
  /** Surface each Pascal post the instant it lands (parent only; the job child passes nothing). */
  onPosted?: (message: MessageEvent) => void;
  pendingWardrobeAnnouncements?: Set<string>;
}

/** The Pascal messages that were posted, in firing order. [] when disabled, nothing matched, or every run failed. */
export async function runTriggeredCustomTools(params: RunTriggeredCustomToolsParams): Promise<MessageEvent[]>;
```

Steps (normative):

1. **Gate.** Return `[]` unless `chatSettings?.customTools !== false && chatSettings?.customToolTriggers === true` and `content.trim()` is non-empty. One debug log when gated off by the trigger switch is **not** wanted (it would fire on every message); log only when something matched.
2. **Cheap pre-check before any read.** Resolving a roster costs store listings. Do nothing further unless `content` contains at least one phrase of at least one tool — but the phrases live in the roster. Resolve the roster once (step 3) and scan; there is no cheaper order. Keep this honest in the module header rather than inventing a cache (Design Decision 12 in the parent spec: rosters are resolved per call, never cached).
3. **Perspective.** The speaker's. When `speaker.characterId` is set: `characters.findById` for the fact sheet and vault mount (a `CharacterVaultUnavailableError` → `warn`, return `[]`; no Prospero bubble — nothing was asked for). `flattenProgressions(metadata, nowMs)`. When null: `metadata = {}`, no vault tier, group scope `none` — the same "run nobody made" posture as the manual route without `asCharacterId`, so availability gates fail closed and effects that need a character skip.
4. **Roster.** `resolveCustomToolRoster({ userId, chatId, characterId, characterMountPointId, characterIds, projectId, metadata })`. Gates and `disabled` are therefore honoured: a tool the speaker cannot be dealt cannot be triggered by them.
5. **Scan.** `scanTriggerPhrases(content, roster.tools.values())`. Log `dropped` at `warn`. Return `[]` on no hits.
6. **Run each hit in order** through `runCustomTool` with `parameters: null`, `private: undefined` (the definition's `defaultVisibility` decides), `characterId`, `metadata`, `whisperTargetIds: speaker.participantId ? [speaker.participantId] : null` (a private triggered roll is whispered to the speaker, as a private `run_custom` is whispered to the caller; for the bare operator, `[userId]` — the manual route's rule), `invokedBy: 'trigger'`, `callerParticipantId: speaker.participantId`, `triggerPhrase: hit.phrase`, the announcement set, one shared `nowMs`. On `{ ok: false }` post the Prospero error bubble (`postProsperoCustomToolError`, whispered per `whisper`) exactly as the LLM entrance does, and continue with the next hit. On `ok` with a `posted` message, call `onPosted` and collect it.
7. **Log** one `info` per fired tool (`'Custom tool fired by trigger phrase'`: chatId, tool, phrase, speaker participantId, invokedBy) and a `debug` for each skipped/failed hit.

The runner performs reads and buffered writes only — it is safe in the forked job child (autonomous rooms run the finalizer there). `onPosted` is parent-only by construction: the child sites pass nothing.

## 5. The two scan sites

### 5.1 The operator's message — `lib/services/chat-message/orchestrator.service.ts`

Immediately after the user message is persisted (after `ledger.userMessagePersisted = true`, ~line 828, and after the attachment links), **not** in the RNG block above it. Dice are thrown before the message is saved so their TOOL rows precede it; a triggered Pascal announcement must *follow* the words that caused it, so it posts after.

```ts
if (!isContinueMode && content) {
  const triggered = await runTriggeredCustomTools({
    userId, chatId, content,
    speaker: {
      participantId: userParticipantId,
      characterId: userParticipant?.type === 'CHARACTER' ? userParticipant.characterId : null,
    },
    projectId: chat.projectId ?? null,
    characterIds: chat.participants.filter(p => p.type === 'CHARACTER').map(p => p.characterId),
    chatSettings,
    onPosted: (message) => safeEnqueue(controller, encodePascalResultEvent(encoder, message)),
  })
  existingMessages.push(...triggered)   // the responding model must see what Pascal just said
}
```

`userParticipant` is the seat the message is attributed to (`resolveRespondingParticipant`'s result): a `CHARACTER` participant when the operator is speaking as, or impersonating, a character — so a user-driven seat's words are that character's words and its roster is that character's. The RNG block pushes its TOOL messages into `existingMessages` for the same reason; verify at implementation time that the context builder reads `existingMessages` rather than re-reading the chat, and follow whichever the RNG block relies on.

`encodePascalResultEvent` is the existing SSE encoder in `streaming.service.ts` (the `pascalResult` event the Salon already handles for `run_custom`).

### 5.2 The character's reply — `lib/services/chat-message/message-finalizer.service.ts`

After the assistant message is persisted and after the existing RNG-in-response block (~line 381), with `content: cleanedResponse`, `speaker: { participantId: characterParticipant.id, characterId: character.id }`, the same `projectId` / `characterIds` derivation from `chat`, `chatSettings` from `triggers`, `onPosted` → `encodePascalResultEvent` on the finalizer's controller, and **no** `pendingWardrobeAnnouncements` — the finalizer does not carry the turn's set (it lives in the tool-execution context, which has already been drained by the time the reply is final), so a wardrobe effect fired here enqueues its Aurora announcement at once, as the manual route does; the job is debounced. The posted messages need no in-memory push here — the next chained turn reloads messages; **but** a Pascal post that lands after the reply must be visible to the chained speaker: confirm `calculateNextSpeaker` / the chained `processMessage` re-read `getMessages` (they do today for the RNG TOOL rows, which land the same way).

Regeneration and swipes do **not** pass through `finalizeMessageResponse`'s RNG block today and will not pass through this one either: a swipe fires nothing, matching dice.

### 5.3 What is deliberately not a site

- Carina answers (`runCarinaQuery`) — Doctrine 4.
- Announcements, informs, Host/Aurora/Lantern/Prospero/Pascal/Suparṇā messages, tool messages — never pass through either site.
- `?action=add-message`-style direct inserts, imports, merges, reattributions — not "said", not scanned.
- Document Mode edits, terminal output — not chat messages.

## 6. `pascalMeta` and the record

Both pascalMeta schemas (`lib/schemas/chat.types.ts` ~:547 and `lib/database/repositories/chats-messages.ops.ts` ~:168):

```ts
invokedBy: z.enum(['llm', 'user', 'trigger']),
/** The phrase that fired a triggered run, as written in the definition. Present only when invokedBy is 'trigger'. */
triggerPhrase: z.string().optional(),
```

Mirror in `public/schemas/qtap-export.schema.json` (the `invokedBy` enum ~:972 and a new `triggerPhrase` property) and the `pascalMeta` prose in `docs/developer/DDL.md` (~:949). `pascalMeta` is a JSON TEXT column — **no migration**. Import/restore accept the new value through the widened enum; an export from this build read by an older one fails that message's `pascalMeta` validation — note it in the CHANGELOG as the format-forward caveat the `chipLabel` / `effects` additions already carry.

The Salon renders nothing new. `getSystemKindDisplayLabel` precedence is unchanged. The transcript reads the same whether a tool was called or overheard; `invokedBy` is the audit.

## 7. The setting

`customToolTriggers: boolean`, default **false**. Mirror every site `autoDetectRng` touches:

| Site | Change |
|---|---|
| `lib/schemas/settings.types.ts` (~:798) | `customToolTriggers: z.boolean().default(false)` with a doc-comment, beside `customTools`. |
| `lib/database/repositories/chat-settings.repository.ts` (~:192) | default row value `false`. |
| `migrations/scripts/add-custom-tool-triggers-field.ts` + `index.ts` | `ALTER TABLE chat_settings ADD COLUMN "customToolTriggers" INTEGER DEFAULT 0`, id `add-custom-tool-triggers-field-v1`, `dependsOn: ['add-custom-tools-field-v1']`, modelled on `add-auto-detect-rng-field.ts`. No loop, so no `reportProgress`. |
| `lib/startup/prettify.ts` | `'add-custom-tool-triggers-field-v1': 'Teaching Pascal which words to listen for'`. |
| `app/api/v1/settings/chat/route.ts` (~:52, :163, :390, :425) | accept, validate as boolean, return in both payloads. |
| `components/settings/chat-settings/types.ts` (~:97, :498) | `ChatSettings.customToolTriggers?: boolean`; a second `AUTOMATION_OPTIONS` entry: label **"Auto-Run Custom Tools on Trigger Phrases"**, description "When anyone in a chat says a phrase one of Pascal's custom tools declares, run that tool automatically with its defaults. Requires Custom Tools."; `DEFAULT_CUSTOM_TOOL_TRIGGERS = false`. |
| `components/settings/chat-settings/AutomationSettings.tsx` | Generalise: the component hard-codes `autoDetectRng` in both `checked` and `onChange`; make it a `Record<AutomationKey, { value, onChange }>` so a third option costs one line. The trigger row is disabled (with the description explaining why) while `customTools` is off. |
| `components/settings/chat-settings/hooks/useChatSettings.ts` (~:343) | `handleCustomToolTriggersChange`. |
| `components/settings/tabs/ChatTabContent.tsx` (~:171) | wire it; the Automation card already lives there. The Custom Tools card's `sectionId="custom-tools"` deep-link is the help URL's target. |
| `lib/tools/almanack/types.ts`, `phase3-ledgers.ts` (two sites), `render.ts` | carry and print the flag beside Auto-Detect RNG. |
| `lib/tools/handlers/help-settings-handler.ts` (~:111) | expose it. |
| `docs/developer/DDL.md` `chat_settings` | the column, with the same comment style as `customTools`. |
| Backups / `.qtap` | `chat_settings` rows travel whole; confirm the serializers do not enumerate columns (they did not for `customTools`). |

## 8. Workbench

- **BuilderForm** identity card: a "Trigger phrases" chip-style list input between "Chip label" and the gate section — add a phrase, remove a phrase, each with the length bounds shown; hint: "Said by anyone in the chat, these words run the tool with its defaults — only when the chat setting is on. Exact words, any case."
- **tool-draft.ts**: `ToolDraft.triggers: string[]` (empty = key omitted); round-trip; `'triggers'` in `KNOWN_KEY_ORDER` after `'chipLabel'`; `validateDraft` enforces §1 and emits the self-echo warning.
- **Library row / listing**: a small "✦ N phrases" affix on tools that declare triggers, so the library shows which tools are listening.
- `help/pascals-workbench.md`: the new field and the warning.

## 9. Documentation

- `help/custom-tools.md` — a new section **"Words that pull the lever"** after "Naming each run": the `triggers` key, substring-and-case-insensitive semantics (with the `fire`/`fireplace` example), who can set one off (everyone who speaks, including the characters), what is never listened to (Carina's answers, the staff's announcements, Pascal himself), defaults-only parameters, the per-message cap, privacy following `defaultVisibility`, the self-echo caveat, and that it needs the Automation toggle. Steampunk voice. Keep `url` frontmatter and In-Chat Navigation.
- `help/chat-settings.md` — Automation Settings (~:56): the second toggle, default off.
- `help/rng-tool.md` — one sentence: Pascal's custom tools can listen for phrases the same way, link.
- `docs/developer/features/complete/pascal-custom-tools.md` — a "Correction" note that a third entrance exists and the entrance sequence lives in `run-service.ts`; "Design decisions" gains the trigger decision.
- `docs/developer/API.md` — the settings field; the `custom-tools` route section's "entrances" sentence.
- `docs/developer/DDL.md`, `docs/CHANGELOG.md` (plain voice), `docs/FEATURES.md` (Pascal paragraph), `.claude/commands/update-documentation.md` (this spec's row; move to `complete/` when done).
- CLAUDE.md — the Pascal glossary row already says what Pascal is; no chokepoint bullet is needed, but if the implementer judges the "one run service" worth a bullet, it is the sentence "A custom tool is dealt through `runCustomTool` (`lib/pascal/run-service.ts`), whatever the entrance."

## 10. Engineering tasks (phased; each phase compiles and tests green)

1. **Run service** — `lib/pascal/run-service.ts`; both entrances refactored onto it; `run-service.test.ts`; existing entrance tests unchanged and green.
2. **Schema** — `triggers` key, `validateTriggers`, published JSON Schema, agreement corpus, `CUSTOM_TOOL_SPEC_DICE.json`.
3. **Scanner** — `trigger-phrases.ts`, `stripCarinaQueryLines`, tests (incl. a carina-parser test for the new export).
4. **Setting** — every row of §7's table; migration registered and pretty-labelled; settings route tests.
5. **Runner + sites** — `trigger-runner.ts` + `__tests__/unit/lib/pascal/trigger-runner.test.ts` (gate off → no reads; master off → nothing; speaker with vault → their roster; bare operator → empty sheet, gates fail closed; hits run in order with defaults; cap; one failure does not stop the next; whisper targets; `onPosted` called per post); orchestrator and finalizer call sites with tests in `orchestrator`/`message-finalizer.service.test.ts` asserting ordering (after the user message; after the assistant message) and that the runner is not called in continue mode or on swipes.
6. **pascalMeta** — both schemas, export schema, DDL prose.
7. **Workbench** — draft field, BuilderForm input, listing affix, self-echo warning, tests.
8. **Docs** — §9.

## 11. Verification

- `npx tsc`; `npm run lint` (the spelling sweep covers the help page).
- `npx jest __tests__/unit/lib/pascal __tests__/unit/lib/services/chat-message __tests__/unit/lib/chat` plus the settings route and Workbench suites. No tool-definition snapshot change is expected (nothing in `run_custom`'s description changes); if the snapshot moves, something is wrong.
- Live, on the V4test instance: author a tool with `triggers: ["abracadabra"]`, `defaultVisibility: "whisper"`, and a `metadata.` effect. With the toggle **off**, say the word — nothing happens. Turn it on. (a) Say it as the bare operator — Pascal whispers to the operator, the metadata effect is skipped (debug log); the model does not see a whisper to the operator, so prove the context splice with a public tool — the reply reacts to Pascal's line. (b) Speak as a user-controlled character — the effect lands on that character's sheet. (c) Have an LLM character say it — Pascal posts after their reply; the next speaker sees it. (d) Put the phrase in the tool's own outcome message and watch the model echo it and the tool fire again on the next reply — then confirm the Workbench warned. (e) Write `@Name: abracadabra` as a Carina query — nothing fires. (f) In an autonomous room, confirm the post lands through the parent and the SSE event is absent (child). (g) Say five trigger phrases in one message — four fire, one is logged as dropped. Confirm `pascalMeta.invokedBy === 'trigger'` and `triggerPhrase` survive a `.qtap` export.

## Design decisions (resolved)

1. **Phrases in the definition, not a settings table.** A separate "phrase → tool" registry would need its own UI, export, tiering and shadowing rules, and would drift from the file. The file already has every one of those.
2. **Substring, case-insensitive, no boundaries.** Stated requirement; also the only semantics with nothing to parse and nothing to get wrong.
3. **Defaults only.** A triggered run has nobody to fill a form. Every parameter already carries a mandatory default precisely so zero-argument runs always work (parent spec, `parameters`).
4. **Off by default, and under the master switch.** Overhearing is a surprise the first time; the operator opts in, and turning Custom Tools off must stop everything Pascal does.
5. **Announcements follow the words.** Dice land *before* the message because they always have; a Pascal announcement caused by a sentence reads wrong above it. The two orderings differ and the help page says so.
6. **A run service, extracted before the third caller.** Two copies was tolerable; three is how bugs get fixed in one entrance and not the others.
7. **Everyone's words, including the characters'.** The user's requirement; also the symmetry the auto-RNG scan already has (user message *and* assistant response).
8. **Carina's query line is subtracted; her answer is never seen.** The answer is a `carina` system message and never reaches a scan site; the query line is addressed to the desk, not to the room. If this turns out too strict the subtraction is one function to remove.
9. **A per-message cap of four fired tools.** Each run may consult a model and post a message; an author who lists common words in eight tools should not be able to spend eight LLM calls per sentence. Logged, never silent.
10. **No Salon affordance.** The transcript already says who said the words; `invokedBy` is for the audit and for a future inspector.

## As built

Where implementation amended or settled something the spec left open:

- **Run service.** `runCustomTool` (`lib/pascal/run-service.ts`) takes an optional `chat` so an entrance that already holds the chat (the manual route) does not read it twice. The LLM entrance still catches a non-`CustomToolRunError` throw from the service into its Prospero bubble, as it did before. One behaviour difference on the manual route, unreachable from the UI: a request that omits `private` now follows the definition's `defaultVisibility` (the popup always sends a boolean, so its runs are unchanged).
- **No `pendingWardrobeAnnouncements`.** [pascal-wardrobe-effects.md](pascal-wardrobe-effects.md) has not landed, so the parameter has nothing to forward to and was left out of `RunCustomToolParams` and the runner rather than stubbed. That spec adds it in one place now.
- **Call sites live in `lib/services/chat-message/trigger-phrase-sites.ts`.** `runUserMessageTriggers` (orchestrator, after `ledger.userMessagePersisted` and the attachment links, before Carina) and `runReplyTriggers` (finalizer, after the RNG-in-response block, before Carina) derive the speaker and room and call the runner; they exist so the derivations are testable without driving `processMessage`. A source-order test pins each site after its persist and asserts the swipe path reaches neither.
- **Context order.** The context builder appends the new user message after `existingMessages`, so a Pascal post spliced in by the user-message site sits before the user's words in the model's context — the same position RNG TOOL rows and Carina's public answer already take. The transcript order is correct (post after message).
- **`onPosted` in the job child.** Passed unconditionally, like the `run_custom` and Carina SSE hooks: in the child the stream is a sink, so the enqueue is a no-op and the post surfaces from the parent's commit.
- **Announcement that fails to post.** The runner posts the same Prospero "the outcome could not be posted to the chat" bubble the LLM entrance does, then continues with the next hit.
- **Dice specimen.** `docs/developer/CUSTOM_TOOL_SPEC_DICE.json` carries `triggers`; the explanation lives in an outcome message's "Demonstrates:" note because the top-level `description` is capped at 500 characters.
- **Migration dependency.** `add-custom-tool-triggers-field-v1` first shipped to the working tree naming *itself* in `dependsOn`, which the runner's topological sort rejects as a cycle — the server never finished starting. Caught on the first live boot, never committed. It now depends on `add-custom-tools-field-v1` as §7 says, and the migration registry test (`__tests__/unit/lib/database/migration/registry.test.ts`) gained an acyclic-graph check, since the existing dangling-dependency check passes a self-reference.
- **Live walkthrough (V4test, 2026-10-15, deepseek-v4-flash).** Fixtures in Quilltap General: `abracadabra` (whisper, `metadata.lastAbracadabra = {{now}}` effect), `hocus_pocus` (public, its own message repeats the phrase), `cap_one`…`cap_five` (`"zephyr one"`…). Every case observed:
  - **Toggle off** — no trigger fired (no `pascal.trigger-runner` log). The model reached for `run_custom` itself (`invokedBy: 'llm'`), which is the ordinary entrance, not a trigger.
  - **Automation card** — with Custom Tools off the trigger row is disabled at 0.5 opacity with "Requires Custom Tools."; turning both on persists `customToolTriggers: true`.
  - **(a) Bare operator** — Pascal posts after the user's message, whispered to the operator's userId, `callerParticipantId: null`; the metadata effect logs "no rolling character, metadata effect skipped". *Correction to §11:* a whisper to the operator is invisible to the model, so the reply does **not** react to it (Riya replied "no violet, no number"). The context splice is proven instead with a public tool: the operator saying "Hocus pocus! … what number?" got the correct number back from the next model.
  - **(b) User-controlled seat** (Tester, via `speakingAsParticipantId`) — "Abracadabra!" (case differs) fired; whispered to Tester's participant; `lastAbracadabra` landed on Tester's `metadata.json`.
  - **(c) LLM character** — Riya said "Hocus pocus."; Pascal posted after her reply with her as caller; Lorian, the next speaker, quoted Pascal's line with the right value.
  - **(d) Self-echo** — Lorian's quotation contained the phrase and fired the tool again (caller Lorian); Pascal's own post did not. The Workbench shows "⚠ this message contains the trigger "hocus pocus" — a character who repeats Pascal's line will set this tool off again" on the outcome row.
  - **(e) Carina** — `@Lorian: what does the word abracadabra mean…` fired nothing, and neither did Carina's answer, which repeats the word.
  - **(f) Autonomous room** — both characters' cue lines fired through the job child (`module: jobs:processor-host`, `childLog: true`) and the posts landed via the parent's commit; the Host's scenario announcement, which contains the phrase, fired nothing.
  - **(g) Cap** — five phrases in one message: `cap_one`…`cap_four` posted in order, `warn` "Trigger phrases over the per-message cap" with `dropped: ["cap_five"]`.
  - **Export** — a `.qtap` export of the chat carries `invokedBy: 'trigger'` and `triggerPhrase` on all seven triggered rows, each valid against `qtap-export.schema.json`'s `pascalMeta`.
  - **Workbench UI** — the library shows a "✦ 1 phrase" chip on every listening tool; the editor's "Trigger phrases" chip list sits under the identity fields with its hint and 3–80 / up-to-8 bounds.
