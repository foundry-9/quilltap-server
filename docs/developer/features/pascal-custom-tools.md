# Feature: Custom Tools — Pascal's Table (`run_custom`)

**Status:** Specified, not yet implemented.
**Owner subsystem:** Pascal the Croupier (RNG / game-state — `lib/foundry/subsystem-defaults.ts:134`, settings under `/settings?tab=chat`).
**Implementation note:** This spec is written to be executed by Claude Code (Opus) with minimal further design input. Where a choice existed, it has been made — see [Design Decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, logging, migration pretty-labels, tool chokepoints).

## Motivation

Writers and roleplayers want lightweight, user-defined chance mechanics: "try to pick the lock," "measure the Hawking radiation," "draw from the deck of many things." Today the closest facility is the generic RNG tool (dice, coin, spin-the-bottle), which produces raw numbers with no narrative interpretation. Custom Tools let the user author a **pseudo-tool** as a small JSON document in any document store: a named action with parameters, a random roll (numeric range or dice notation), and an ordered table of outcomes that map the roll to a message and a semantic state. Both the LLM (via a single `run_custom` tool) and the human user (via a composer popup) can invoke them, and the outcome posts as a tamper-evident synthetic message authored by **Pascal the Croupier** — his debut as a `systemSender`.

Because the roll executes server-side and the outcome is persisted as a message the model did not author, the model cannot fudge a failure into a success, and regenerating a reply does not re-roll.

## Definition format

### File location and discovery

A custom tool is a single JSON file matching `Tools/*.tool.json` at the **root** of any document store — the `Tools/` folder name is a well-known convention like Suparṇā's `Mail/` (`lib/post-office/mailbox.ts:38`), but it is **not** added to the character-vault scaffold (`lib/mount-index/character-scaffold.ts` `TOP_LEVEL_FOLDERS`); it is recognized lazily if present.

- Add `export const TOOLS_FOLDER = 'Tools'` and the filename suffix constant in a new module `lib/pascal/custom-tools.ts` (new `lib/pascal/` directory; see [Modules](#new-modules)).
- Discovery layers on the existing tier resolver: `resolveTieredMountPool()` + `flattenTierPool()` (`lib/mount-index/tiered-mount-pool.ts`), then a per-mount file listing filtered to `Tools/*.tool.json` (same primitive `listMailbox` uses: `listDatabaseFiles(vaultId, { folder })`).
- The file's basename is **not** significant; the tool's identity is its `name` field. One tool per file.

### Schema

Zod schema `QtapCustomToolSchema` in `lib/pascal/custom-tool.types.ts`, plus a published JSON Schema at `public/schemas/qtap-custom-tool.schema.json` (draft-07, generated from the Zod schema the same way other published schemas are maintained) so users get editor completion via the `$schema` key.

```jsonc
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "unlock",                      // required. ^[a-z][a-z0-9_-]{0,63}$
  "description": "Attempt to pick the lock.",  // required. What the tool does *in the fiction* — this is how
                                               // the model decides when to reach for it and how the UI labels it.
                                               // Roleplay-facing, not mechanical ("Attempt to pick the lock,"
                                               // not "rolls 0–1 against thresholds"). Max 500 chars.
  "disabled": false,                     // optional. true = suppress this name at this tier and below.
  "revealOdds": true,                    // optional, default true. false = model sees name/description/parameters only, never the roll spec or outcome table.
  "defaultVisibility": "public",         // optional: "public" | "whisper". Default "public".
  "parameters": {                        // optional. Keyed by param name (same identifier rules as `name`). Max 8 params.
    "bonus": {
      "type": "number",                  // "number" | "integer" | "string" | "boolean"
      "default": 0,                      // required — every parameter must have a default so zero-argument runs always work
      "description": "Skill bonus added to the roll.",
      "min": 0,                          // optional, numeric types only; run-time values are clamped into [min, max]
      "max": 10
    }
  },
  "roll": { "min": 0, "max": 1, "multiplier": 1, "offset": { "$param": "bonus" }, "round": false },
  // — OR dice notation, handled by the existing dice system rather than pure math:
  // "roll": "3d6+2",
  "outcomes": [                          // required, ordered, first match wins. Max 32 entries.
    { "when": { "gt": 0.60 },               "message": "The lock clicks open.",  "state": "success" },
    { "when": { "lt": 0.30 },               "message": "Still locked.",          "state": "failure" },
    { "when": true,                          "message": "The lock is giving way…","state": "partial" }
  ]
}
```

The Hawking-radiation example, with parameter references, rounding, and templating:

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "measure_hawking_radiation",
  "description": "Take a Hawking-radiation reading from the detector.",
  "parameters": {
    "baseline": { "type": "number", "default": 0, "description": "Lowest plausible reading." },
    "ceiling":  { "type": "number", "default": 1000000, "description": "Highest plausible reading." }
  },
  "roll": { "min": { "$param": "baseline" }, "max": { "$param": "ceiling" }, "round": true },
  "outcomes": [
    { "when": true, "message": "The detector reads {{value}} µK.", "state": "info" }
  ]
}
```

A dice-driven example:

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "saving_throw",
  "description": "Roll a d20 saving throw against DC 12.",
  "roll": "1d20",
  "outcomes": [
    { "when": { "gte": 12 }, "message": "Saved! ({{dice}})",  "state": "success" },
    { "when": true,          "message": "Failed. ({{dice}})", "state": "failure" }
  ]
}
```

### `roll` — the two forms

**Form A — numeric range object.** Fields (all optional): `min` (default 0), `max` (default 1), `multiplier` (default 1), `offset` (default 0), `round` (default false). Each numeric field accepts either a JSON number or a `{ "$param": "<name>" }` reference to a declared numeric parameter — **`$param` references are the only indirection; no expression strings anywhere.** Raw value = uniform float in `[min, max)` from **crypto-strength randomness** (`crypto.randomInt`/`randomBytes`-derived, not `Math.random`).

**Form B — dice notation string.** A string like `"3d6+2"`, `"1d20"`, `"2d10-1"`. Parsed and rolled by the **existing dice system** in `lib/tools/rng-tool.ts` — extract its dice parser/roller into a shared module (`lib/pascal/dice.ts`) and have both `rng-tool` and `run_custom` consume it, rather than duplicating (single source of truth). Raw value = the dice total. Dice form does not accept `$param` references inside the notation string (v1); if parameterized dice are needed later, that is a v2 extension.

**Transform pipeline (both forms), in this exact order:**

```
value = raw
value = value * multiplier      (Form A only; Form B has no multiplier/offset/round modifiers)
value = value + offset
if round: value = Math.round(value)
```

Outcome tests evaluate against the **final** `value`. Both `raw` and `value` are persisted (see `pascalMeta`).

If `$param` substitution yields `min > max`, or any substituted value is non-finite, the run **fails as an error** (see [Error handling](#error-handling)) — never a fabricated outcome.

### `when` — comparators, not expressions

`when` is either the literal `true` (catch-all) or an object whose keys are drawn from `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, each with a numeric value. Multiple keys AND together, so `>= 0.30 && <= 0.60` is written `{ "gte": 0.30, "lte": 0.60 }`. There is no OR, no nesting, and no string expression grammar — ordered first-match-wins outcomes make OR unnecessary and this keeps the evaluator eval-free and trivially testable.

### `outcomes` entries

- `when` — as above. Required.
- `message` — required string, max 1000 chars, with templating (below).
- `state` — required enum: `"success" | "partial" | "failure" | "info"`. Maps to qt classes at render; authors never write CSS.

### Templating

`message` supports exactly three placeholder families, replaced server-side with plain string substitution (no template engine):

- `{{value}}` — the final post-transform value (integers rendered without decimals; floats to 4 significant digits).
- `{{roll}}` — the raw pre-transform value. For dice form, the total.
- `{{dice}}` — dice form only: the breakdown, e.g. `3d6+2: [4, 2, 6] + 2 = 14`. Empty string for Form A.
- `{{params.<name>}}` — the resolved (post-clamp, post-default) value of a declared parameter.

Unknown placeholders are left verbatim (and logged at debug level).

### Validation rules (load-time)

Files are validated with `QtapCustomToolSchema.safeParse` at roster-resolution time. A file is **rejected** (skipped from the roster, surfaced as an error badge in the UI popup and a debug log) if any of:

1. JSON parse failure or schema mismatch.
2. `outcomes` is empty, or the **final** outcome's `when` is not the literal `true`. Requiring a trailing catch-all makes coverage gaps structurally impossible; earlier `when: true` entries are also invalid (unreachable outcomes below them).
3. Any `$param` references an undeclared or non-numeric parameter.
4. Dice notation fails to parse via the shared dice module.
5. Duplicate `name` **within the same file set of a single mount** (across mounts/tiers, shadowing rules apply instead).

Unknown top-level keys are **ignored with a debug warning**, not rejected — this reserves room for v2 keys (notably `persist`, see [Deferred](#deferred-to-v2)) without breaking older builds.

## Scope resolution — tiers and shadowing

The roster for a chat is resolved through the existing five-tier pool (`character → participant → group → project → global`, `lib/mount-index/tiered-mount-pool.ts`):

- **Nearest tier wins** on a `name` collision — a character-tier `unlock` shadows the project-tier `unlock`.
- `"disabled": true` at a nearer tier suppresses the inherited tool of that name entirely.
- A collision **within the same tier** (two mounts at the same tier both defining `unlock`) resolves deterministically by mount-point id (lexicographic), with a warning logged and an info badge in the UI popup.
- **Perspective:** resolution is computed per invoker. When character X calls `run_custom`, X's character-tier mounts are the "character" tier. For the human user's composer popup, the roster is the union across all participants' perspectives: tools identical for everyone appear once; a tool whose definition differs per character (character-tier shadowing) appears once per variant, labeled with the character's name, and running it executes that character's variant.
### Roster freshness — resolved per call, never cached across turns

The roster is **re-resolved at every assembly point**, so it can never go stale:

- **Every LLM call:** `buildToolsForProvider` (and the system-prompt builder, if the roster is ever surfaced there too) resolves the roster fresh as part of building that call's tools. A brand-new chat therefore gets its full roster on the first turn with no separate "initialize tools" step, and a `.tool.json` added, edited, or deleted mid-chat takes effect on the **next** LLM call automatically — including when the user regenerates a message, since regeneration rebuilds the prompt and tools from scratch.
- **Every UI fetch:** `GET /api/v1/chats/[id]/custom-tools` resolves fresh on each request (the composer popup re-fetches on open).
- The only permitted memoization is **within a single request/turn** (resolve once, share between the tool builder and the handler for that call). No chat-lifetime or process-lifetime cache: document edits inside a mount don't reliably touch the mount index, so index-based invalidation would miss mid-chat additions.

This is affordable because resolution is one folder listing (`Tools/`) per mount in the tier pool — mounts per chat number in the single digits and the listings hit the local mount index/filesystem, not the network. If profiling ever shows otherwise, add a short TTL, never an event-invalidated cache.

**Prompt-cache note:** since the roster rides in the `run_custom` tool description, a roster change alters the tool block and busts the provider prompt cache for that chat. That is the correct behavior (the model must see the new tool) and roster changes are rare; no mitigation needed.

**Odds secrecy caveat (documented, not new machinery):** `revealOdds: false` hides the roll spec and outcome table from the roster injection, but the `.tool.json` file itself remains an ordinary document — a character with `character_read` on that store can still read it with `doc_*` tools. Users who want genuinely secret odds should place the file in a store the character cannot read; the existing per-document policy machinery covers this. State this plainly in the help doc.

## The `run_custom` tool

New file `lib/tools/run-custom-tool.ts`, following the five-part chokepoint pattern exactly (see `lib/tools/wardrobe-wear-tool.ts` as the template):

1. `export const runCustomToolInputSchema = z.object({ tool: z.string().describe(...), parameters: z.record(z.unknown()).nullable().optional().describe(...), private: z.boolean().optional().describe(...) })`
2. `export type RunCustomToolInput = z.infer<...>`
3. `export const runCustomToolDefinition = { type: 'function', function: { name: 'run_custom', description: RUN_CUSTOM_DESCRIPTION, parameters: zodToOpenAISchema(runCustomToolInputSchema) } }`
4. `export function validateRunCustomInput(input): input is RunCustomToolInput` — one-line `safeParse(...).success` delegate.
5. Handler in `lib/tools/handlers/run-custom-handler.ts`.

**Registration:** exported from `lib/tools/index.ts`; wired into `buildToolsForProvider` (`lib/tools/plugin-tool-builder.ts`) behind a new `BuildToolsOptions` boolean `customTools`, which the caller sets **only when the resolved roster is non-empty** and the settings toggle (below) is on. Added to `ALL_TOOLS` in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` and the snapshot updated with `npx jest -u` on that file.

**Roster injection:** the tool's `description` is composed dynamically on **every** tool build (see [Roster freshness](#roster-freshness--resolved-per-call-never-cached-across-turns)): a fixed preamble plus, per available tool, its `name`, its roleplay-facing `description`, parameter list (name, type, default, min/max, description), and — unless `revealOdds: false` — a compact rendering of the roll spec and outcome table. This is how the model learns what its custom tools are and what parameters they take, on the first turn of a new chat and after any mid-chat definition change alike. Prompt-cache trade-off: the description changes only when definitions change, which is rare. `canonicalizeUniversalTools()` handles ordering stability as usual.

**Handler behavior** (`run-custom-handler.ts`):

1. Resolve the invoker's roster; look up `tool`. Unknown name → error result listing available names.
2. Validate/coerce `parameters` against the definition's declarations: unknown keys rejected, missing keys defaulted, numeric values clamped to declared `[min, max]`.
3. Substitute `$param` refs, roll (crypto RNG or shared dice module), run the transform pipeline, evaluate outcomes in order, take the first match (the trailing `when: true` guarantees one).
4. Render the `message` template.
5. Post the **Pascal outcome message** (next section) — honoring visibility: `private` param if present, else the definition's `defaultVisibility`.
6. Return a compact JSON tool result to the model: `{ tool, value, state, message, whispered }`. The TOOL-role message persists as usual for tool-call threading (`tool-call-threading.ts` — do not break linkage), but its content JSON includes `"delegatedDisplay": true` so `ToolMessage.tsx` renders nothing for it (the Pascal bubble is the single visible artifact; no double display).
7. Debug logs at every step per the standing logging rule.

**Job-child compatibility:** the handler runs in autonomous rooms too. All writes go through the buffered `getRepositories()` proxy — never assume read-your-writes. The roll and outcome evaluation are pure computation; only the message post is a write.

## Result delivery — Pascal speaks

### New `systemSender: 'pascal'`

- Add `'pascal'` to the `systemSender` Zod enum in `lib/schemas/chat.types.ts:222` (the column is plain nullable TEXT with no CHECK constraint, so no ALTER is needed for the enum itself).
- Add the value to `public/schemas/qtap-export.schema.json`.
- Add a `getMessageAvatar` branch in `app/salon/[id]/SalonView.tsx` (~line 1083 block) returning `{ name: 'Pascal', title: 'the Croupier', avatarUrl: '/images/avatars/pascal-avatar.webp' }` — the avatar already ships.
- Update the CLAUDE.md personified-avatars sender list (replace the "Pascal authors no synthetic messages yet" note) and the DDL.md doc-comment for the column.

### The outcome message

Constructed like Suparṇā's writer (`lib/services/suparna-notifications/writer.ts:90` is the template): `role: 'ASSISTANT'`, `participantId: null`, `systemSender: 'pascal'`, `systemKind: 'custom-tool-result'`, persisted via `repos.chats.addMessage`. New writer module: `lib/services/pascal/writer.ts`.

**Correction (implementation):** this spec originally said non-opaque (`opaqueContent = content`), copying Suparṇā. That is wrong for Pascal. Suparṇā and Carina set `opaqueContent = content` because their bodies carry *no persona framing* — Pascal's does ("🎲 **unlock** — …", and "At {userName}'s behest, Pascal spins the wheel: …"). Reusing `content` verbatim would leak the name "Pascal" into an opaque character's context, breaking the standing staff-voicing rule. Pascal therefore follows the **Prospero** precedent instead: a genuinely distinct, neutral `System: …` opaque body. The author's own `message` text is interpolated **verbatim into both** bodies — only the framing around it differs.

`content` is the human/LLM-readable text, e.g.:

> 🎲 **unlock** — The lock clicks open. *(rolled 0.7134)*

For manual runs the content also attributes the invoker: "At {userName}'s behest, …". Steampunk voice applies to the fixed framing copy (not to the author's own `message` text, which is rendered verbatim).

### `pascalMeta` column

New nullable TEXT (JSON) column on `chat_messages`, following the `carinaMeta` precedent:

```jsonc
{
  "tool": "unlock",
  "definitionTier": "project",          // MountTier
  "definitionMountId": "…",
  "params": { "bonus": 2 },              // resolved, post-clamp
  "rollForm": "range" | "dice",
  "notation": "3d6+2",                   // dice form only
  "raw": 0.7134,                         // pre-transform (dice: total)
  "diceRolls": [4, 2, 6],                // dice form only
  "value": 0.7134,                       // post-transform; what outcomes tested
  "state": "success",
  "outcomeIndex": 0,
  "invokedBy": "llm" | "user",
  "callerParticipantId": "…"             // LLM path only
}
```

Chores this column triggers (per standing rules): migration in `migrations/scripts/` with an `index.ts` entry and a `PRETTY_LABELS` line in `lib/startup/prettify.ts` (steampunk voice; it's a single ALTER with no loop, so no `reportProgress` needed); DDL.md updated; `qtap-export.schema.json` gains the field; **export and import code both include it** (fields must round-trip); backups pick it up automatically as part of the main DB.

### Live surfacing (SSE)

Follow the `carinaAnswer` / `hostAnnouncement` pattern exactly:

- Server: `encodePascalResultEvent` in `lib/services/chat-message/streaming.service.ts` emitting `{ pascalResult: message }`.
- Client: `pascalResult?: Message` on the SSE payload type in `app/salon/[id]/hooks/useSSEStreaming.ts`, dispatched to an `onPascalResult` callback that inserts into the message list, deduped by id.

Manual runs happen outside a streaming turn; the API response returns the created messages and the client inserts them directly (plus TanStack invalidation via `queryKeys`).

## Whispered (hidden) runs

Both paths support GM-style hidden rolls, riding the existing `targetParticipantIds` machinery (`lib/schemas/chat.types.ts:218`, filtered for LLM context by `filterWhisperMessages` in `lib/chat/context/message-attribution.ts:168`):

- **LLM path:** `run_custom`'s optional `private: boolean` (definition `defaultVisibility` supplies the default). A private run sets the Pascal message's `targetParticipantIds: [callerParticipantId]` — only the rolling character (and the human, below) sees the outcome; other participants' LLM contexts exclude it. The tool result returned to the calling model always contains the outcome (it made the call).
- **Manual path:** a "Roll privately" toggle in the popup. A private manual run follows the existing operator-private convention (operator userId in `targetParticipantIds`, as user-initiated Prospero runs do) so **no character** sees it.
- **UI rule:** Pascal whispers must **always render for the human user** regardless of the "show all whispers" toggle — this instance is single-user and the operator is never the one being surprised. Implement this as: messages with a non-null `systemSender` bypass the whisper-hiding branch in `SalonView.tsx` (~line 290) and render with the whisper styling (`qt-chat-message-whisper`, "whispered" label). This intentionally implements the standing fix noted for systemSender whispers generally (Commonplace Book recall whispers benefit too); keep the change scoped to `systemSender !== null` messages.

## Manual runs — composer UI and API

### UI

- New gutter button in `components/chat/ComposerGutterTools.tsx` (the 3×2 grid gains a slot or reflows to 4×2 — implementer's call, keep `qt-composer-gutter-button` styling), visible **only when the resolved roster is non-empty**.
- The popup follows the `RngDropdown` pattern (`components/chat/RngDropdown.tsx`: outside-click ref, `variant="gutter"`). New component `components/chat/CustomToolsDropdown.tsx`: a list of available tools (name + description; character-labeled variants where shadowed; error badges for invalid files), each expanding to a small parameter form generated from the `parameters` block (defaults pre-filled; number/integer/string/boolean inputs), a "Roll privately" checkbox (pre-checked when `defaultVisibility: "whisper"`), and a Run button.
- Running posts **two messages**: a USER-role message with auto-generated content (e.g. "*I ran `unlock`.*" — with resolved non-default parameters listed) so the model attributes the invocation to the user, followed by the Pascal outcome message. Both share the run's visibility (private manual runs target both messages).
- Icons go through the central `<Icon name>` system (themeable-icons).

### API

Chat-scoped route `app/api/v1/chats/[id]/custom-tools/route.ts` using `createContextHandler` + `withActionDispatch`, responses via `@/lib/api/responses`:

- `GET /api/v1/chats/[id]/custom-tools` — the resolved roster for the composer popup: `[{ name, description, parameters, defaultVisibility, sourceTier, characterLabel?, error? }]` (roll spec and outcomes are **not** included in the payload unless needed; the UI never shows odds — parity with what a tabletop screen hides — except that this is the user's own file, so include a `definitionPath` so the UI can link to the document).
- `POST /api/v1/chats/[id]/custom-tools?action=run` — body `{ tool, parameters?, private?, asCharacterId? }` (the last disambiguates character-labeled variants). Executes server-side exactly as the tool handler does (share the execution core in `lib/pascal/custom-tools.ts` — one roll/evaluate/post code path for both entrances), returns the created messages.
- TanStack Query: add a `customTools` block to `lib/query/keys.ts`; fetch via `apiFetch` with signal forwarding; mutation invalidates the chat's messages and the roster key.

## qt-\* styling

The Pascal bubble renders the outcome with a state accent. Add semantic utilities (names indicative — match existing `qt-` naming conventions in the stylebook):

- `qt-pascal-result` (container), `qt-pascal-result--success`, `qt-pascal-result--partial` (warning treatment), `qt-pascal-result--failure` (danger treatment), `qt-pascal-result--info`.

Per the standing rule, propagate additions to the stylebook and `packages/theme-storybook` (which triggers the packages hard-stop: bump version, then **stop and ask the human to `npm publish`**), and check the six bundled themes render the four states legibly. Keep the additions minimal — accent border/badge, not a new layout system.

## Settings

One toggle in the Chat tab (`components/settings/tabs/ChatTabContent.tsx`), grouped under Pascal's existing area: **"Custom tools"** (default on). Off = `run_custom` never offered to models and the gutter button hidden. No further settings in v1 (per-tool configuration lives in the JSON files themselves).

## Error handling

Runtime failures (unknown tool name from UI race, `min > max` after substitution, non-finite values, dice parse regression, store read failure) post a **Prospero-authored error bubble** following the `carina-error` precedent: `systemSender: 'prospero'`, `systemKind: 'custom-tool-error'`, message naming the tool and the reason in one sentence. The LLM path additionally returns `{ success: false, error }` in the tool result. Never post a Pascal message for a failed run — Pascal only announces genuine outcomes.

Load-time validation failures do not error at run time; they simply keep the tool out of the roster (UI error badge + debug log).

## Security constraints

- **No expression evaluation anywhere.** Comparator objects and `$param` refs only. Reject on schema, don't sanitize.
- Roster caps: max 64 tools per resolved roster (excess dropped with a logged warning and UI notice — no silent truncation), max 8 parameters and 32 outcomes per tool, message ≤ 1000 chars, description ≤ 500 chars.
- Parameter values from the model/UI are validated against declared types and clamped to declared ranges before any use.
- Crypto-strength RNG (`node:crypto`), never `Math.random`.
- Template substitution is plain string replacement of the three known placeholder families; user text is never interpreted.

## Deferred to v2 (schema room reserved)

- **`persist` block** — `"persist": { "baseline": "{{value}}" }`: after each run, store the value as this chat's default for a parameter, backed by Pascal's existing state system (`lib/tools/state-tool.ts`). Enables self-ratcheting tools (each Hawking reading becomes the next floor) and counters ("third failed lockpick breaks the pick"). v1 ignores the key with a warning.
- Parameterized dice notation (`"{{params.n}}d6"`).
- Group-tier authoring UI (definitions are hand-authored JSON in v1; a form-based editor could come later).
- Per-run seeds / deterministic replay.

## New modules

- `lib/pascal/custom-tool.types.ts` — Zod schema + TS types.
- `lib/pascal/custom-tools.ts` — discovery (tier resolution + `Tools/*.tool.json` listing), roster cache, and the shared execution core (validate params → roll → transform → evaluate → render → post).
- `lib/pascal/dice.ts` — dice parser/roller extracted from `lib/tools/rng-tool.ts`; both consumers import it.
- `lib/services/pascal/writer.ts` — Pascal synthetic-message writer.
- `lib/tools/run-custom-tool.ts` + `lib/tools/handlers/run-custom-handler.ts`.
- `components/chat/CustomToolsDropdown.tsx`.
- `app/api/v1/chats/[id]/custom-tools/route.ts`.

## Engineering tasks

### Backend

- [ ] `QtapCustomToolSchema` + types; publish `public/schemas/qtap-custom-tool.schema.json`.
- [ ] Extract shared dice module from `rng-tool.ts`; keep `rng-tool` behavior byte-identical (its snapshot must not change).
- [ ] Discovery + tier shadowing + roster cache in `lib/pascal/custom-tools.ts`.
- [ ] Execution core: param validation/clamping, `$param` substitution, crypto roll, transform pipeline, ordered outcome evaluation, templating.
- [ ] `run_custom` tool (five-part pattern), `BuildToolsOptions.customTools` wiring with dynamic roster description, snapshot-test registration (`npx jest -u`).
- [ ] Handler + `delegatedDisplay` TOOL-content flag; verify tool-call threading intact in the Brahma Console and autonomous rooms.
- [ ] `systemSender: 'pascal'` enum + export schema + DDL.md + CLAUDE.md sender list.
- [ ] `pascalMeta` column migration + `PRETTY_LABELS` entry; export/import round-trip.
- [ ] Pascal writer; Prospero `custom-tool-error` path.
- [ ] SSE `pascalResult` encode/dispatch.
- [ ] `/api/v1/chats/[id]/custom-tools` route (GET roster, POST run) on the shared execution core.
- [ ] Whisper targeting for both paths; `systemSender` whispers always visible to the human user.
- [ ] Debug logging on every new path.

### Frontend

- [ ] `getMessageAvatar` Pascal branch.
- [ ] Pascal bubble rendering with `qt-pascal-result--*` state classes; whisper styling for private rolls.
- [ ] `ToolMessage.tsx` honors `delegatedDisplay`.
- [ ] Gutter button + `CustomToolsDropdown` (roster list, param forms, private toggle, error badges, character-labeled variants).
- [ ] `queryKeys.customTools` block; fetch/mutation wiring.
- [ ] Settings toggle in Chat tab.
- [ ] Stylebook + theme-storybook propagation; check bundled themes (packages hard-stop applies to theme-storybook publish).

### Documentation

- [ ] `help/custom-tools.md` — user-facing, steampunk voice, with `url` frontmatter and matching In-Chat Navigation `help_navigate` call; must cover the JSON format (with copy-paste examples), the `Tools/` folder convention, tier shadowing, `revealOdds` and its store-readability caveat, whispered rolls, and the composer popup.
- [ ] `docs/CHANGELOG.md` entry (plain American English).
- [ ] DDL.md, API.md (new route), CLAUDE.md glossary/sender updates as above.

### Testing

- [ ] Unit: schema validation matrix (all rejection rules incl. trailing-catch-all and unreachable-outcome checks), comparator evaluator, transform-pipeline order, templating (incl. unknown placeholders), param clamping/defaults, `$param` substitution errors, dice-module extraction parity with `rng-tool` fixtures.
- [ ] Unit: tier shadowing, `disabled` suppression, same-tier collision determinism, per-invoker perspective.
- [ ] Integration: roster freshness — a `.tool.json` added (or edited/deleted) after a chat has begun appears in (or vanishes from) the very next call's `run_custom` description and the next roster GET; a new chat's first turn includes the full roster.
- [ ] Unit: whisper filtering — private LLM roll invisible to other characters' contexts (`filterWhisperMessages`), visible to caller; private manual roll invisible to all characters.
- [ ] Snapshot: `run_custom` in `tool-definitions-snapshot.test.ts`.
- [ ] Integration: manual run posts USER + Pascal messages; LLM run posts TOOL (delegated) + Pascal message; error path posts Prospero bubble; export/import round-trips `pascalMeta` and the new sender.
- [ ] Follow Jest conventions (global `jest`, bare mock factories); any suite touching the real SQLCipher binding gets the `@jest-environment node` docblock.

## Design Decisions (Resolved)

1. **Structured comparators over expression strings.** The originally sketched `"test": "> 0.60"` form implies a parser and an injection/typo surface; AND-composed comparator objects plus ordered first-match outcomes express everything the examples need with zero evaluation.
2. **Trailing `when: true` is mandatory.** Coverage gaps become a load-time validation error instead of a runtime surprise.
3. **Dice notation is first-class** (user decision) and must reuse the existing dice system via extraction, not a second parser.
4. **Whispered rolls are first-class** (user decision), on `targetParticipantIds`, with the rule that `systemSender` whispers always render for the human operator.
5. **One `run_custom` tool, not per-definition dynamic tools.** Keeps the tool list stable for prompt caching, avoids snapshot churn, and matches the Zod-chokepoint rule; the roster rides in the description.
6. **Pascal synthetic message is the canonical display; the TOOL message is protocol-only** (`delegatedDisplay`), avoiding double bubbles while preserving tool-call threading.
7. **Rolls are persisted facts.** Raw roll, transform, and outcome live in `pascalMeta`; regeneration never re-rolls.
8. **Manual runs post a USER invocation message + Pascal outcome** so models attribute the action to the user, matching the requested "message from you saying you ran X."
9. **Per-invoker perspective for character-tier shadowing**; the composer popup surfaces character-labeled variants with `asCharacterId` disambiguation.
10. **`revealOdds` hides odds from the roster only**; file readability is governed by existing document-store policy, documented as a caveat rather than new machinery.
11. **`persist`/ratcheting deferred to v2**, with the schema tolerating the key today.
12. **Roster is resolved per call, never cached across turns.** New chats get the full roster on turn one with no initialization step; mid-chat definition changes take effect on the next LLM call and the next popup open. Mount-index invalidation was rejected because document edits inside a mount don't reliably touch the index; per-call listing is cheap enough.
