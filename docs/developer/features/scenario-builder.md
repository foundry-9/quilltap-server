# Feature: Scenario Builder — The Host researches and drafts a starting scene

**Status:** Proposed (not started). Handoff spec for Claude Code.
**Owner subsystems:** The Host (persona and voice), The Salon (both surfaces), The Scriptorium (the stores it reads).
**Implementation note:** This spec is written to be executed by Claude Code. Follow the CLAUDE.md standing rules throughout: changelog entry, help docs with `url` + In-Chat Navigation, debug logging on every touched backend path, Zod-first tool definitions, `qt-*` classes not raw Tailwind, `npx tsc` not `npm run build`. The decisions in §2 were settled with the operator before this spec was written. **Do not reopen them.**

---

## 1. The feature in one paragraph

Beside the custom scenario text box — on the New Chat form and on the Salon sidebar's in-chat **Change scenario** control — a button asks **The Host** to set the scene. A dialog collects four things: whether the place is **real** or **in-world**, the **location**, the **time**, and any **further details**. The user picks which connection profile does the work (the default chat profile is preselected). The Host then runs an agentic, tool-using LLM loop in the Brahma Console's manner: in real mode it searches the web and fetches pages to establish the place and the moment, and reads the same stores an in-world run would; in in-world mode it reads only the document stores this chat can see — the cast's character vaults, their groups' stores, the project's stores, and Quilltap General — hierarchically, and never the web. The result is a stage-setting paragraph or two, **assuming nothing about who is present**, shown in an editable editor with a **Revise** box for further instructions. The user can **use** it (it lands in the custom text box; Create Chat or the sidebar's Save persists it as today) and/or **save** it as a named scenario file in General, the project, a group, or one cast character's `Scenarios/` folder.

## 2. Decisions of record

| Question | Decision |
|---|---|
| Surfaces | **Both.** The New Chat form (`components/new-chat/NewChatForm.tsx`, also rendered by `NewChatModal.tsx` in the workspace) **and** the Salon sidebar's in-chat control (`components/chat/ChatScenarioControl.tsx`). |
| Persona | **The Host.** No new `systemSender`, no new avatar: `host` already exists in `SystemSenderEnum` with `/images/avatars/host-avatar.webp`. The dialog wears the Host's avatar and voice. The chat-side announcement stays exactly what it is today (`postHostScenarioAnnouncement` / `postHostScenarioRevisionAnnouncement`). |
| Real mode sources | **Web + stores.** `search_web` and `curl` (when available) **plus** the same hierarchical store set the in-world run gets. |
| In-world mode sources | **Visible stores only.** `search` (documents + knowledge, never memories or conversations) and the read-only `doc_*` family over the hierarchical mount pool. **No web, no `run_sql`.** |
| Cast-agnostic output | **Both modes.** The scene never names, counts, or characterises the participants. Vaults are read for *world* knowledge (lore, places, history, `Knowledge/`), not for who the characters are. This is what keeps a saved scenario reusable in General or a project. |
| Placeholders | **None.** No `{{char}}` / `{{user}}`. Present tense, addressed to no one — the same register as the character wizard's scenario prompt (`FIELD_PROMPTS.scenarios`, `lib/services/character-wizard.service.ts:179`). |
| Length | **Target 1,000 tokens or fewer.** Stated in the system prompt; the builder does not truncate. |
| Dialog inputs | **Exactly four:** mode (real / in-world), location, time, details. Tone or length wishes go in details. |
| Iteration | **Edit + Revise.** The draft is a `MarkdownLexicalEditor`; a Revise box re-runs the builder with the current draft and the instruction as extra context. Nothing about a run is persisted between runs. |
| Model | A dropdown of every connection profile, preselected to the user's **default** profile (`isDefault`), else the first. Profiles with `allowToolUse === false` are listed but disabled with a hint — the builder is a tool loop. |
| Persistence of the run | **Ephemeral.** No chat row, no messages, no participant. The only durable trace is the LLM log rows `streamMessage` already writes, typed `SCENARIO_BUILDER`. |
| Where the run executes | **Parent process, inside the API route**, streamed over SSE — the Brahma pattern. Never a background job (no client SSE from the child). |
| Web unavailable in real mode | **Warn, don't block.** If the chosen profile has `allowWebSearch: false` or `isWebSearchConfigured()` is false, the dialog shows a Host-voiced warning and the system prompt tells the model the web is out of reach and to say plainly where it is unsure. |
| Saving | POSTs to the existing per-tier create endpoints. No new storage. After a save, the surface switches its picker to the saved preset when that tier is offered there; otherwise the text stays as custom. |
| Engine | Generalise the Brahma **one-shot** loop (`lib/services/brahma-console/one-shot.service.ts`) into a shared non-persisting tool loop that both `runBrahmaQuery` and the builder call. The streaming Brahma orchestrator is untouched. |

## 3. Vocabulary

- **Builder run** — one request → tool loop → one scene. Stateless on the server.
- **Mode** — `real` or `in-world`. Decides the tool slate and the system prompt's research instructions.
- **Mount pool** — the `TieredMountPool` (`lib/mount-index/tiered-mount-pool.ts:40–70`) the run may read: cast vaults as participants, the union of every cast member's group stores, the project's stores, Quilltap General.
- **Cast** — the characters selected on the New Chat form, or the chat's non-removed CHARACTER participants in-chat. Used only to compute the mount pool and the save targets, never handed to the model.
- **Draft** — the scene text currently in the review editor. Sent back on Revise.
- **Save target** — `general` · `project:<id>` · `group:<id>` · `character:<id>`.

## 4. What already exists (read before building)

- **Scenario tiers and files.** All four tiers are Markdown files in a `Scenarios/` folder of a database-type store: General (`lib/mount-index/general-scenarios.ts`, store id from `getGeneralMountPointId()`), project (`project-scenarios.ts`, the project's official store), group (`group-scenarios.ts`), character (vault `Scenarios/*.md`, projected as `character.scenarios`; `vault-overlay/schema.ts:114`). Frontmatter and helpers: `lib/mount-index/scenarios-common.ts` (`createScenarioSchema` at :55, `buildScenarioFileContent` at :366). Create endpoints: `POST /api/v1/scenarios`, `POST /api/v1/projects/[id]/scenarios`, `POST /api/v1/groups/[id]/scenarios` (all `createScenarioSchema`), `POST /api/v1/characters/[id]/scenarios` (`{title, content, archived?}`).
- **The custom text box.** New Chat: `NewChatForm.tsx:625–686` — label "Starting Scenario (Optional)", `<ScenarioSelect>`, preset preview, then `MarkdownLexicalEditor` bound to `state.scenario`. In-chat: `ChatScenarioControl.tsx:271–280`, a `qt-textarea` shown only for "Custom…", saved by `handleSave` (:216) via `POST /api/v1/chats/[id]?action=scenario`.
- **Editor gotcha.** `MarkdownLexicalEditor` reads `value` only at mount (`components/chat/lexical/plugins/MarkdownBridgePlugin.tsx:201–215`) and afterwards only reacts to a clear (:244–263). Programmatic fills **must bump `remountKey`** (`components/markdown-editor/MarkdownLexicalEditor.tsx:52`). `NewChatForm` passes none today.
- **Selection state.** `NewChatFormState` (`components/new-chat/types.ts:146–182`): `scenario`, `scenarioId`, `projectScenarioPath`, `generalScenarioPath`, `groupScenarioPath`, `groupScenarioGroupId`. `useNewChat` (`components/new-chat/hooks/useNewChat.ts`) fetches the tiers with plain `fetch` (:218–251) and never touches `queryKeys.scenarios`; `ChatScenarioControl` uses TanStack with `queryKeys.scenarios.*` (`lib/query/keys.ts:77–88`).
- **The Brahma one-shot loop.** `runBrahmaQuery({repos, userId, chatId, question})` (`one-shot.service.ts:92`): the full agent loop with a sink controller, no persistence, hard-wired to the default profile and the Brahma prompt. `buildTools` is called with 18 positional flags (`:112–131`). Tool execution is `processToolCalls(...)` (`lib/services/chat-message/tool-execution.service.ts:82`), which `controller.enqueue`s `toolsDetected` / `status` / `toolResult` events directly.
- **Tool scoping today.** `ToolExecutionContext` (`lib/chat/tool-executor.ts:184`) carries `characterId`, `characterIds`, `projectId`, `operatorSurface`. The `search` handler resolves its pool from `characterId` + `projectId` only (`search-scriptorium-handler.ts:142`) or, on the operator surface, **every** enabled store. The doc path resolver does the same through `collectAccessibleMountPointIds` (`lib/doc-edit/path-resolver.ts:314`), whose group tier is keyed on the single `characterId` (`tiered-mount-pool.ts:282`). `doc_grep` and `doc_list_files` refuse without a `projectId` (`text-handlers.ts:591`, `:893`). None of this can express "these N characters' vaults and all their groups, no operator override" — §5.2 adds that.
- **Web search.** `search_web` is a tool (`lib/tools/web-search-tool.ts:69`) backed by a search-provider plugin or the legacy `SERPER_API_KEY` (`lib/tools/handlers/web-search-handler.ts:80`, `isWebSearchConfigured()`); gated per profile by `allowWebSearch` (`plugin-tool-builder.ts:370`). `curl` is a plugin tool that appears only when `qtap-plugin-curl` has a non-empty `allowedUrlPatterns`.
- **Generate → review → accept precedent.** `components/chat/VoiceRewriteReviewPanel.tsx` (editable proposal, Regenerate, never traps a draft when the provider dies) and the AI wizard's `ProfileSelectionStep` (`<select className="qt-select">`, "(Default)" suffix).

## 5. Backend

### 5.1 Route — `app/api/v1/scenario-builder/route.ts`

Collection route, `createContextHandler` + `withCollectionActionDispatch({ build: handleBuild })`. No item routes.

**`POST /api/v1/scenario-builder?action=build`** → `text/event-stream`.

```ts
export const scenarioBuildRequestSchema = z.object({
  mode: z.enum(['real', 'in-world']),
  location: z.string().trim().min(1).max(500),
  time: z.string().trim().min(1).max(200),
  details: z.string().trim().max(4000).default(''),
  connectionProfileId: UUIDSchema,
  projectId: UUIDSchema.nullish(),
  /** Cast character ids: New Chat selection, or the chat's participants. */
  characterIds: z.array(UUIDSchema).max(32).default([]),
  /** Present when launched from the in-chat control. Adds the chat's own context (§5.4). */
  chatId: UUIDSchema.nullish(),
  /** Revise: the draft as currently edited, and the instruction. Both or neither. */
  priorDraft: z.string().max(20_000).nullish(),
  revision: z.string().trim().max(2000).nullish(),
}).refine(r => (r.priorDraft == null) === (r.revision == null), { message: 'priorDraft and revision travel together' });
```

Handler: validate → verify the profile belongs to the user (`repos.connections.findById`) and `allowToolUse !== false` → resolve the API key with `resolveConnectionProfileApiKey` / `describeProfileApiKeyFailure` (`lib/services/api-key.service.ts:67,86`) → drop cast ids the user cannot read (`repos.characters.findById`, as `app/api/v1/groups/scenarios/route.ts` does) → if `chatId`, assert ownership and `chatType === 'salon' | 'autonomous'` → `runScenarioBuilder(...)` inside a `ReadableStream.start`, forwarding `request.signal` so a closed tab stops the loop. Wrap `processToolCalls`'s controller in a `safeEnqueue` adapter — it enqueues directly and throws on a cancelled stream.

SSE events (existing encoders from `streaming.service.ts`): `status` (`tool_executing`, "Running search_web…"), `toolsDetected`/`toolNames`/`toolArguments`, `toolResult`, `reasoning` (cumulative, replace-not-append, as Brahma), `error`, and a terminal `done` carrying `{ scenario: string, provider, modelName, usage, toolsExecuted, webAvailable: boolean }`. No `content` chunks: the scene arrives whole via `submit_final_response`, so the dialog never shows a half-written draft.

Debug log every stage under `logger.child({ context: 'ScenarioBuilder' })`: request summary (mode, cast count, pool sizes, profile), each tool turn, final length in characters, and the reason for any early exit.

### 5.2 Scoping the tools to "what this chat could see" — `lib/scenario-builder/mount-pool.ts`

```ts
export async function resolveScenarioBuilderMountPool(opts: {
  userId: string; projectId?: string | null; characterIds: string[];
}): Promise<TieredMountPool>
```

Builds the pool by hand in precedence order, mirroring `handleAccessibleStores` (`app/api/v1/chats/[id]/actions/documents.ts:240`) but keyed on ids so it runs before a chat exists:

1. `participantMountPointIds` ← every non-archived cast character's `characterDocumentMountPointId` (raw read; an archived character is a tombstone and contributes nothing — never call `ensureCharacterVault` here).
2. `groupMountPointIds` ← the union of `resolveGroupMountPointIdsForCharacter(id)` (`tiered-mount-pool.ts:190`) over the whole cast — the one thing `resolveTieredMountPool` cannot do, since its group tier reads a single `characterId`.
3. `projectMountPointIds` ← `resolveProjectMountPointIds(projectId)` (:169) when a project is set.
4. `globalMountPointId` ← `getGeneralMountPointId()`.
5. `characterMountPointId` ← `null`. There is no acting character.

Dedupe with the same precedence `dedupeTierTriple` uses (:118). Any tier whose lookup fails is dropped with a `warn`, never thrown.

**Threading the pool into the tools.** Add one optional field, `mountPool?: TieredMountPool`, to three context types, and honour it in three places:

- `ToolExecutionContext` (`tool-executor.ts:184`) → copied onto the search context (:1005) and the doc-edit context (:1115).
- `SearchScriptoriumToolContext` (`search-scriptorium-handler.ts:39`): when `mountPool` is present, **use it instead of resolving** (`:142`) and skip the `operatorWide` branch. `documents` pool = `flattenTierPool(pool, {scope, includeParticipants: true})`; `knowledge` tiers = participants (boost as the character tier), group, project, global. The "Search requires a character context" guard (`tool-executor.ts:996`) also passes when `mountPool` is set.
- `DocEditToolContext` (`doc-edit/shared.ts:110`) → `PathResolutionContext` (`path-resolver.ts:103`): `collectAccessibleMountPointIds` returns `flattenTierPool(context.mountPool, {includeParticipants: true, includeCharacterTier: false})` when set. `buildReadResolutionContext` forwards it. `handleGrep` / `handleListFiles` accept `mountPool` as an alternative to `projectId` (a General-only chat has no project and must still be able to list `Knowledge/`).

`mountPool` and `operatorSurface` are mutually exclusive; the executor refuses a context that sets both (log + error result). The builder never sets `operatorSurface`.

### 5.3 The tool slate

`buildTools` (`streaming.service.ts:138`) gains two options, gated at construction per the CLAUDE.md tool chokepoint rule (never post-filter):

- `docToolsMode: 'off' | 'read' | 'full'` replacing the boolean `documentEditingEnabled` (`plugin-tool-builder.ts:505–530`). `'read'` pushes only `doc_read_file`, `doc_grep`, `doc_list_files`, `doc_read_frontmatter`, `doc_read_heading` — no writes, no document-UI tools (`doc_open_document` et al. need a real chat row), no photo tools. Existing callers pass `'full'`/`'off'` for `true`/`false`; behaviour is unchanged for them.
- `pluginToolAllowlist?: string[]` applied at `plugin-tool-builder.ts:533–540`: when present, only plugin tools whose name is listed are added. The builder passes `['curl']` in real mode and `[]` in in-world mode.

The builder's call: agent mode on, help tools off, multi-character off, wardrobe off, Carina off, workspace tools off, memory search excluded (the Brahma `search` variant, `search-scriptorium-tool.ts:174`, further narrowed by a builder variant whose `sources` enum is `documents | knowledge` only), `sqlAccess: false`, `docToolsMode: 'read'`, `webSearch: mode === 'real' && profile.allowWebSearch && isWebSearchConfigured()`, `pluginToolAllowlist` as above. `useNativeWebSearch: false` in `streamMessage`, as Brahma.

**Net slate:** `search` (documents/knowledge), five read-only `doc_*` tools, `submit_final_response`; plus `search_web` and `curl` in real mode when available. Register any new tool variant in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` and run `npx jest -u` on it.

### 5.4 The engine — generalise the one-shot loop

Move the loop body of `one-shot.service.ts` into `lib/services/agent-loop/one-shot-loop.ts`:

```ts
export async function runOneShotToolLoop(opts: {
  repos; userId: string; chatId: string;            // chatId scopes tools; may be synthetic
  connectionProfile: ConnectionProfile; apiKey: string;
  systemPrompt: string; userMessage: string;
  tools: BuiltTools;                                 // the buildTools result
  toolContext: ToolExecutionContext;
  maxAgentTurns: number;
  controller?: StreamController;                     // sink when omitted
  signal?: AbortSignal;
  logType?: LLMLogType;                              // default 'CHAT_MESSAGE'
  statusContext?: { characterName: string; characterId: string };
}): Promise<{ ok: true; answer: string; toolsExecuted: number; usage } | { ok: false; detail: string }>
```

Keeps the duplicate/stale guard (`MAX_DUPLICATE_TOOL_CALLS`, `normalizeToolCallSignature`), the forced final turn, `extractSubmitFinalResponseFromText`, and the budget-exhaustion salvage. Adds `signal` (checked between turns; aborts the in-flight `streamMessage` when the provider supports it) and `logType` — `streamMessage` currently hard-codes `CHAT_MESSAGE`; add an optional `logType` to its options and add `'SCENARIO_BUILDER'` to `LLMLogTypeEnum` (`lib/schemas/llm-log.types.ts:17`). Check whether `qtap-export.schema.json` or backups enumerate log types; update if so.

`runBrahmaQuery` becomes a thin caller (Brahma prompt, default profile, Brahma slate, sink controller) — same behaviour, covered by its existing tests. The streaming orchestrator (`orchestrator.service.ts`) is not touched.

**`lib/services/scenario-builder/scenario-builder.service.ts`** — `runScenarioBuilder(opts, controller, signal)`:

1. `chatId` = the real chat id in-chat, else a fresh `randomUUID()` (tools only need it for scoping; nothing reads or writes a chat row with it — the read-only slate posts no Librarian announcements).
2. Resolve the mount pool (§5.2); build tools (§5.3); build the tool context `{ chatId, userId, projectId, embeddingProfileId: default, mountPool }`.
3. Build the prompt (§5.5) and the user message (§5.6).
4. `runOneShotToolLoop({ …, maxAgentTurns: SCENARIO_BUILDER_MAX_AGENT_TURNS /* 25 */, logType: 'SCENARIO_BUILDER', statusContext: { characterName: 'The Host', characterId: '' } })`.
5. Emit `done` with the trimmed answer; on `ok: false` emit `error` in the Host's voice, never a stack trace.

### 5.5 System prompt — `lib/scenario-builder/system-prompt.ts`

`buildScenarioBuilderSystemPrompt({ mode, webAvailable, toolInstructions, now })`. Plain, short, deliberately not steampunk (it is for a model, not a person):

- You are The Host of Quilltap, setting the opening scene for a conversation. Produce **only** the scene, as Markdown, via `submit_final_response`.
- **Cast-agnostic, non-negotiable:** never name, count, or describe the people who will be present; do not use `{{char}}` / `{{user}}` or any placeholder; write in present tense, addressed to no one; describe place, time, weather, light, sound, what is happening around, what has just happened, what is about to. The stores you read may describe characters — use them for the world only, and leave the people out of the scene.
- **Length:** aim for 1,000 tokens or fewer.
- `real` mode: "The location is a real place. Use `search_web` / `curl` to establish what it is actually like, its geography, its period details for the given time, and anything the details ask for. Cite nothing; write the scene." When `webAvailable` is false: "The web is unavailable in this run. Rely on what you know; where you are unsure of a fact, keep the scene general rather than invent specifics."
- `in-world` mode: "The location is fictional and belongs to the user's world. Everything you need is in the document stores: use `search` (documents and knowledge) and the `doc_*` read tools to find the place, its history, its customs, and what the time means there. Do not invent lore that contradicts what you find; where the stores are silent, stay consistent with their tone."
- `now` — the server's current date-time, ISO with offset, offered as the reference for "now"/"tonight"/"this morning".
- Then `toolInstructions` (native or text-block, plus `buildAgentModeInstructions(maxAgentTurns)`), exactly as Brahma composes them.

The prompt is not user-editable in v1.

### 5.6 The user message

```
Mode: real | in-world
Location: <location>
Time: <time>
Details: <details or "(none)">
```

In-chat (`chatId` set): append `Current scene (being replaced):` with `chat.scenarioText`, and `Where the conversation stands:` with `chat.contextSummary` when present — the chat itself has no store, so this is the "chat" rung of the hierarchy. Cast-agnostic still holds: the prompt tells the model the summary may name people and the new scene must not.

Revise (`priorDraft` + `revision` set): append `Current draft:` + the draft and `Revision requested:` + the instruction, with "Return the whole revised scene."

## 6. Frontend

### 6.1 Entry points

- **New Chat** (`NewChatForm.tsx:626`): a `qt-button qt-button-secondary` with the Host's avatar (16 px) and the label **"Ask the Host to set the scene"**, right-aligned on the "Starting Scenario (Optional)" label row. Disabled while `creating` or when `profiles.length === 0`. Passes `mode` defaults, `projectId: selectedProjectId`, `characterIds` = every selected character (LLM- and user-controlled alike; the user's persona has a vault too), `profiles`.
- **In-chat** (`ChatScenarioControl.tsx`, below the "Show archived" row): the same button, passing `chatId`, `projectId`, `characterIds: llmCharacterIds` **plus** the user-controlled participant's id (add a `castCharacterIds` prop from `ChatSidebar.tsx:1198`, derived from the non-removed CHARACTER participants).

### 6.2 `components/scenario-builder/ScenarioBuilderDialog.tsx`

A `BaseModal` (`maxWidth: '2xl'`) with three panes, switched by state (no step indicator — the AI wizard's numbered circles are overkill for one form):

1. **Inputs.** Mode as a two-option `qt-select` or radio pair (**In-world** default when the cast is non-empty; **Real** otherwise); Location (`qt-input`, required); Time (`qt-input`, required, placeholder "an autumn evening, 1927 · now · the third day of the siege"); Details (`MarkdownLexicalEditor`, `namespace="ScenarioBuilder.details"`, optional); Model (`<select className="qt-select">` over `/api/v1/connection-profiles` via `useConnectionProfiles`-style query but **keeping `isDefault`** — the Brahma hook drops it; write a small `useConnectionProfilesFull` or extend the existing hook's mapping; default `isDefault` else first; `allowToolUse === false` rows `disabled` with "(no tools)"). A Host-voiced warning line when real mode is chosen and the selected profile lacks web search or `GET /api/v1/scenario-builder?action=capabilities` (tiny endpoint returning `{ webSearchConfigured, curlConfigured }`) says the web is unreachable. Footer: Cancel · **Set the scene**.
2. **Running.** `QuillAnimation` with "The Host is out making enquiries…"; beneath it an activity list fed by the stream — one row per tool call, in Host voice by tool name (`search_web` → "Consulting the wider world about …", `curl` → "Reading …", `search` → "Leafing through the stores for …", `doc_read_file` → "Opening …", with the argument's `query`/`url`/`path` in the row), each settling to a check or a cross on its `toolResult`. A `ThinkingBlock` for reasoning when present. Footer: **Stop** (aborts the fetch; returns to Inputs with values intact).
3. **Review.** The draft in a `MarkdownLexicalEditor` (`namespace="ScenarioBuilder.draft"`, `remountKey` bumped per run). Beneath: a Revise `qt-input` + **Revise** button (re-runs with `priorDraft` = the editor's current text). Footer: **Save as scenario…** (§6.4) · Cancel · **Use this scene** (primary). A failed revise keeps the draft and shows the error; Use and Save are never disabled by a dead provider (the `VoiceRewriteReviewPanel` rule).

`useEscapeKey` disabled while running. All copy in the steampunk/Wodehouse voice, spoken as the Host.

### 6.3 Streaming hook — `components/scenario-builder/hooks/useScenarioBuilderRun.ts`

Extract the `data:`-line parser and the tool-call batching logic of `useBrahmaConsoleStreaming.ts` into a pure `components/agent-stream/parse-agent-stream.ts` (`parseAgentSseLine`, `applyAgentStreamEvent(state, event)`), and have both hooks use it. The builder hook exposes `{ run(input), stop(), phase, toolCalls, reasoning, scenario, error }`. `done.scenario` sets `scenario` and moves the dialog to Review.

### 6.4 Applying and saving

**Use this scene.**
- New Chat: `setState(prev => ({ ...prev, scenario: draft, scenarioId: null, projectScenarioPath: null, generalScenarioPath: null, groupScenarioPath: null, groupScenarioGroupId: null }))` and bump a new `scenarioEditorKey` in the form passed as the editor's `remountKey`. Create Chat then sends it as `scenario` exactly as a hand-typed custom scene.
- In-chat: `setSelection({ kind: 'custom' })`, `setCustomText(draft)`. The control's existing **Save** button persists it through `?action=scenario`, so the Host's revision announcement fires as today.

**Save as scenario…** — `components/scenario-builder/SaveScenarioDialog.tsx`, a nested `BaseModal` (`maxWidth: 'md'`): Name (required; prefilled `"<Location> — <Time>"`), Description (optional, ≤500), Location (`qt-select`): **General**; **Project: <name>** when a project is set; **Group: <name>** for each group any cast member belongs to (from `GET /api/v1/groups/scenarios?characterIds=…`'s group list, or a lighter `GET /api/v1/groups?characterIds=` if one exists); **<Character name>'s scenarios** for each non-archived cast character. Filename derives from the name through the tier's own sanitiser (the create endpoints already do this). POST per target:

| Target | Endpoint | Body |
|---|---|---|
| General | `POST /api/v1/scenarios` | `{ filename, name, description?, body }` |
| Project | `POST /api/v1/projects/[id]/scenarios` | same |
| Group | `POST /api/v1/groups/[id]/scenarios` | same |
| Character | `POST /api/v1/characters/[id]/scenarios` | `{ title, content }` (description folded into the `# title` file by the existing route) |

On 400 filename collision, surface the message and keep the dialog open. On success: toast; invalidate `queryKeys.scenarios.all`; in New Chat, call a new `refetchScenarioTiers()` exposed by `useNewChat` (its plain-`fetch` lists don't ride TanStack); then, if the saved tier is offered by the picker on that surface (project / general / group always; character only in the single-LLM case), select it and clear the custom text, else leave the custom text in place. Saving does not close the builder dialog; **Use this scene** does.

### 6.5 Query keys and realtime

No new entity. Saves invalidate `queryKeys.scenarios.all`; if `REALTIME_TOPICS` already carries a scenarios topic, publish it from the create endpoints (check `lib/realtime/topic-map.ts`; add nothing new unless a topic exists to hang it on — this is not a polling site).

## 7. Documentation

- **`help/scenario-builder.md`** — `url: /salon/new`, Host-voiced: what the four fields mean, real vs in-world (and that real still reads the stores), the cast-agnostic rule and why (reusability), the 1,000-token aim, Revise, Use vs Save, the four save homes, what "the web is out of reach" means and how to fix it (a search-provider plugin + `Allow web search` on the profile). "In-Chat Navigation" with `help_navigate(url: "/salon/new")`. Related Pages: general-scenarios, project-scenarios, groups, chats, brahma-console.
- `help/chats.md` (the Starting Scenario paragraph near :114 and the in-chat Scenario section near :328), `help/general-scenarios.md`, `help/project-scenarios.md`: one paragraph each pointing at the builder.
- `.claude/commands/update-documentation.md`: entries for `help/scenario-builder.md` and this spec.
- `docs/developer/API.md`: `POST /api/v1/scenario-builder?action=build` (SSE) and `GET ?action=capabilities`.
- `docs/developer/features/ROADMAP.md`: `- [ ] Scenario Builder — The Host researches and drafts a starting scene (design: [scenario-builder.md](scenario-builder.md))` under Chat & Conversation (The Salon).
- CLAUDE.md glossary: extend the **The Host** row with "and the Scenario Builder (`/salon/new`)". Add a chokepoint bullet: *"A tool loop that must see 'what this chat could see' before the chat exists passes a `mountPool` built by `resolveScenarioBuilderMountPool`, never `operatorSurface`."*
- `docs/CHANGELOG.md`, plain voice, under 4.10-dev: `#### Added: Scenario Builder — …`.
- `docs/developer/PROMPT_ARCHITECTURE.md`: a short section for the builder prompt (it never enters a chat's system prompt; the scene enters exactly as a custom scenario does today).

## 8. Tests

- `lib/scenario-builder/__tests__/mount-pool.test.ts` — cast of two in different groups yields both groups' stores; archived character contributes nothing; no project → no project tier; General missing → `globalMountPointId: null`, no throw.
- `lib/tools/handlers/__tests__/search-scriptorium-handler.mountpool.test.ts` — with `mountPool`, `documents` searches exactly the flattened pool and `knowledge` tiers are participants/group/project/global; `memories`/`conversations` rejected by the builder variant's schema.
- `lib/doc-edit/__tests__/path-resolver.mountpool.test.ts` — `mountPool` admits a cast vault and a group store, refuses an unrelated store with the "exists, out of scope" message, and `doc_list_files` works with no `projectId`.
- `lib/tools/__tests__/tool-definitions-snapshot.test.ts` — the builder `search` variant registered.
- `lib/services/agent-loop/__tests__/one-shot-loop.test.ts` — port the existing `runBrahmaQuery` tests to the generalised loop; add abort-between-turns and `logType` passthrough. `runBrahmaQuery`'s own tests keep passing unchanged.
- `lib/services/scenario-builder/__tests__/scenario-builder.service.test.ts` — real mode with `allowWebSearch: false` builds no `search_web` and the prompt says the web is unavailable; in-world never builds `search_web`/`curl`; `docToolsMode: 'read'` yields no write tools; Revise appends the draft block; in-chat appends `scenarioText`/`contextSummary`.
- `app/api/v1/scenario-builder/__tests__/route.test.ts` — schema refinements (priorDraft/revision pairing), foreign profile → 404, `allowToolUse: false` → 400, cast ids the user can't read are dropped, client abort stops the loop.
- `components/scenario-builder/__tests__/ScenarioBuilderDialog.test.tsx` (`renderWithQuery`) — default profile preselected; disabled no-tools profile; warning shown for real mode without web; `done` moves to Review; Use fills the form state and clears every preset pointer; Save posts to the right endpoint per target and selects the preset when offered.
- `components/new-chat/__tests__/NewChatForm.test.tsx` — the editor remounts when `scenarioEditorKey` changes and shows the filled text.

## 9. Engineering tasks (phased; delegate the mechanical ones)

### Phase 0 — scoping plumbing (delegable, pure)
- [ ] `resolveScenarioBuilderMountPool` + tests.
- [ ] `mountPool` on the three context types; search handler, path resolver, grep/list-files guards; mutual exclusion with `operatorSurface`.
- [ ] Builder `search` variant (documents/knowledge); snapshot test updated.

### Phase 1 — engine (not delegable: touches Brahma)
- [ ] `runOneShotToolLoop` extracted; `runBrahmaQuery` re-pointed; existing Brahma tests green.
- [ ] `buildTools` `docToolsMode` + `pluginToolAllowlist`; every existing caller mapped to the old behaviour.
- [ ] `streamMessage` `logType`; `SCENARIO_BUILDER` log type; export-schema check.
- [ ] `runScenarioBuilder`, system prompt, user message builder + tests.

### Phase 2 — route (delegable)
- [ ] `POST ?action=build` SSE with abort; `GET ?action=capabilities`; route tests; API.md.

### Phase 3 — dialog (delegable once §6 is read in full)
- [ ] Shared SSE parser extracted from the Brahma hook; Brahma hook re-pointed and its tests green.
- [ ] `ScenarioBuilderDialog`, `SaveScenarioDialog`, `useScenarioBuilderRun`; `qt-*` only.

### Phase 4 — wiring (not delegable)
- [ ] New Chat button, `scenarioEditorKey` remount, `refetchScenarioTiers`, preset selection after save.
- [ ] In-chat button, `castCharacterIds` prop from `ChatSidebar`, custom-text fill.

### Phase 5 — docs + CHANGELOG
- [ ] Everything in §7. `npm run lint` (spelling sweep and `qt-*` gate), `npx tsc`, `npm run test:unit`.

## 10. Verification (live, on the V4test instance — never Friday)

1. New Chat, one character in a group, in a project. In-world, location from that group's `Knowledge/`, time "the night before the festival". Watch the activity list read the group store and the vault; confirm the draft names no one and uses no placeholders.
2. Revise: "make it raining and move it two hours later". Draft changes accordingly; nothing else in the form moved.
3. Use this scene → the editor shows it; Create Chat → the Host's scene announcement carries it verbatim.
4. Real mode on a profile with web search, location "Gare du Nord, Paris", time "a March morning in 1926". Activity list shows `search_web` rows; the scene has period-true detail; still cast-agnostic.
5. Real mode on a profile without web search → the warning line; the run still completes.
6. Save as scenario… → General; the picker now offers it under General Scenarios and it is selected, custom text cleared. Save the same name again → 400 surfaced, dialog stays open.
7. Save to a character's scenarios with two LLM characters selected → saved, but the form keeps the custom text (character tier not offered).
8. In an open chat: sidebar → Change scenario → the Host button → build → Use → Save. The Host posts the revision announcement; `chat.scenarioText` updated.
9. Close the tab mid-run; `logs/combined.log` shows the abort within one turn, and no further provider calls.
10. `npx quilltap logs` shows the run's rows typed `SCENARIO_BUILDER`; no chat rows were created for a New Chat run.

## 11. Deferred

- An instance setting for the builder's turn budget (constant 25 in v1; Brahma's setting is the model if wanted).
- Provider-native web search (`useNativeWebSearch`) for the builder; Brahma doesn't use it either.
- Editable builder system prompt.
- Reading the current chat's transcript by tool (`read_conversation`) rather than passing `contextSummary`.
- A "Generate a few" mode producing two or three alternative scenes to choose from.
- Extracting the *streaming* Brahma orchestrator onto the shared loop.
