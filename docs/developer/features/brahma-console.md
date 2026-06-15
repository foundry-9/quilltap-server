# Brahma Console — Implementation Plan

> **Status:** Proposed (not started). This is a handoff spec for Claude Code.
> **Author of spec:** drafted from a mapping of the existing Help Chat subsystem.
> **One-line summary:** A floating, character-less generic-LLM chat that hovers over any page, persists, lets you revisit past conversations, and lets you change the model at any time. It can read and search every document store and use web/curl tools, but it forms **no persistent memories**, has **no memory access at all**, and is **not page-aware** (it neither knows nor tracks which screen you're on).

---

## 1. Intent and scope

The **Brahma Console** is a second floating chat surface, sibling to the Help Chat, reachable from a new icon **below** the Help icon in the left sidebar footer. Unlike the Help Chat — which is a *character* answering in-character with help-doc context — the Brahma Console is a **plain LLM**: you pick a connection profile (model), and you talk to that model directly.

It behaves like an ordinary chat in terms of *conversation context* (full history sent to the model each turn), but it is deliberately stripped down:

- **No character.** No identity, personality, wardrobe, avatar, pronouns, roleplay templates, scene state, or Concierge.
- **No persistent memory, no memory access.** It never runs memory extraction, and its tools never touch the memory store. It is a clean amnesiac surface: the only persistence is the chat transcript itself.
- **Tools it DOES have:** document-store search and **full document read/write** (the `doc_*` family), plus web search and `curl` — the latter two **gated by the selected connection profile** (web search only if the profile allows it; `curl` only if the curl plugin is installed/enabled).
- **Tools it does NOT have:** memory/scriptorium-*memory* search, email, annotations, terminal, RNG/state, image generation, wardrobe, Carina, help_* tools.
- **No page awareness.** Unlike the Help Chat, it does **not** track the current page URL, does not update context on navigation, and loads no help documentation. It does not know or care which screen you're on.
- **Model switching at any time** continues the **same chat** with the new model from that point forward.

The name is **"Brahma Console."** (Spelling note: the product is **Quilltap**, never "Quilttap" — applies to all strings, comments, docs.)

### Decisions locked in (from the product owner)

| Question | Decision |
|---|---|
| Memory **read** access (recall via search) | **None.** Exclude the memory source from the search tool entirely. The console never reads or writes memories. |
| Memory **write** (extraction) | **None.** Do not call `triggerTurnMemoryExtraction`. |
| Changing the model mid-conversation | **Continue the same chat**, new model applies from that point forward. |
| Web search + `curl` | **Respect connection-profile settings** (web search if profile allows; curl if plugin enabled). Do not force-enable. |
| Persona / system prompt | **Minimal neutral assistant.** No character. Knows it's inside Quilltap, has tools, no personality, **no page context**. Not user-editable in v1. |
| Document tools | **Search + full document read/write** (`doc_*` family enabled, including writes). |
| Other always-on help-chat tools (email, annotations, terminal, RNG/state) | **Stripped.** Knowledge + web only. |
| First-run model | **The user's default connection profile.** Switchable immediately. |
| Page awareness | **None.** No page-URL tracking, no `update-context` endpoint, no pathname effect, no `helpPageUrl`/new column for the console. |
| Export/backup inclusion | **Yes** — Brahma chats are real chats; include them in `.qtap` exports and backups (requires `chatType: 'brahma'` in `qtap-export.schema.json`). |
| Launcher behavior | **Open to a past-chats list** (like Help), with a "New conversation" affordance. |
| Default icon | **Tetra-radial console** mark (`public/images/icons/brahma-console.svg`, already created — final, do not regenerate). |
| Madman's Box theme | Ships its own Gallifreyan-style override (`themes/bundled/madmans-box/icons/brahma-console.svg`, already created — final). Requires a `theme.json` icons-map entry + version bump. |

> ⚠️ **Reviewer note for the implementer:** two of these are intentional tensions worth confirming you've honored exactly. (a) The console has **full document read/write** but **zero memory access** — both are deliberate. (b) Web/curl are **gated by profile**, *not* forced on, even though the console is "supposed to" have them — if the chosen profile disallows web search, the console silently lacks it. That is the desired behavior.

---

## 2. How the existing Help Chat is built (reference architecture to mirror)

The Brahma Console mirrors the Help Chat's window/persistence/streaming machinery and diverges on identity, tools, and memory. Key existing pieces:

**Persistence.** Help chats are plain rows in the `chats` table, distinguished by the **`chatType`** column (`'salon' | 'help' | 'autonomous'`, default `'salon'`; see `docs/developer/DDL.md` ~line 464, index `idx_chats_chatType`). Page context lives in **`helpPageUrl TEXT DEFAULT NULL`** (~DDL line 465). Messages use the shared `chat_messages` table via `repos.chats.addMessage` / `getMessages`. The enum is `ChatTypeEnum` in `lib/schemas/chat.types.ts:68`.

**API (action-dispatch).** Under `app/api/v1/help-chats/`:
- `route.ts` — `GET` (list, filters `chatType==='help'`), `GET ?action=eligibility`, `POST` (create).
- `[id]/route.ts` — `GET` (details), `PATCH` (rename), `PATCH ?action=update-context` (update `helpPageUrl` + inject a `[System: navigated…]` message), `DELETE`.
- `[id]/messages/route.ts` — `POST` (send message → SSE stream), `GET` (list messages).

**Orchestrator.** `lib/services/help-chat/orchestrator.service.ts` → `handleHelpChatMessage(repos, chatId, userId, options)` returns a `ReadableStream<Uint8Array>` (SSE). It: asserts `chatType==='help'`, saves the user message, selects LLM participants, resolves page docs, and per participant runs an agent loop (`maxAgentTurns = 10`) over `streamMessage(...)` from `lib/services/chat-message/streaming.service.ts`, detecting/executing tool calls. **The connection profile is per-participant** (`participant.connectionProfileId`), captured at chat-create time from the character's `defaultConnectionProfileId` — never changed afterward. **Help chat opts INTO memory extraction** via `triggerTurnMemoryExtraction` in `triggerAsyncTasks` (~lines 609–666); the Brahma path must omit that call.

**Tools.** Built via `buildTools(...)` in `streaming.service.ts`, dispatched through `lib/tools/plugin-tool-builder.ts`. Relevant gates:
- `helpToolsEnabled` → `help_search`, `help_settings`, `help_navigate` (we do NOT want these).
- Always-on in help: `search` (scriptorium), `send_mail`, `list_email`, `read_conversation`, `upsert_annotation`, `delete_annotation`, `terminal_*`, plus `rng`/`state` (we want to strip these down).
- `documentEditing` gate → `doc_read_file`, `doc_grep`, `doc_list_files`, `doc_open_document`, and the write/edit family (we WANT these on).
- Web search → `lib/tools/web-search-tool.ts`, gated by `connectionProfile.allowWebSearch`.
- `curl` → plugin `plugins/dist/qtap-plugin-curl/` (tool name `curl`), included via the plugin tool path when installed/enabled.

The `search` (scriptorium) tool (`lib/tools/search-scriptorium-tool.ts`) has a `sources` input including `memories`. **For Brahma, the search tool must be configured so `memories` is never a usable source** (see §5.3).

**UI shell.**
- Floating window: `components/ui/FloatingDialog.tsx` — generic draggable/resizable portal dialog, persists geometry to localStorage via `storageKey`. Directly reusable.
- Help dialog: `components/help-chat/HelpChatDialog.tsx` (tabs, composer, message list, streaming hook).
- Provider: `components/providers/help-chat-provider.tsx` — open/close state, `currentChatId` (localStorage `quilltap:help-chat-last-id`), eligibility query, **pathname tracking** that PATCHes `?action=update-context` on route change while open. Mounted in `components/layout/app-layout.tsx` (~line 77), with `<HelpChatDialog />` rendered inside (~line 92).
- Launcher button: `components/layout/left-sidebar/sidebar-footer.tsx` (~lines 147–157), renders `<Icon name="help" />`. Icon registry: `components/ui/icons/icon-registry.ts` maps names → `/images/icons/<name>.svg` (mask mode).
- Streaming hook shape: `components/help-chat/hooks/useHelpChatStreaming.ts`.

**Query keys.** `lib/query/keys.ts` (~lines 127–132):
```ts
helpChat: {
  all: ['help-chat'] as const,
  entity: (apiUrl: string) => ['help-chat', 'entity', apiUrl] as const,
  eligibility: ['help-chat', 'eligibility'] as const,
  pastChats: ['help-chat', 'past-chats'] as const,
},
```

---

## 3. Architecture decision: reuse vs. fork

**Do NOT try to retrofit the Help Chat to also serve Brahma.** The two diverge on identity (character vs. none), tools, model-switching, and memory. Forcing both through one path produces a tangle of `if (chatType === 'brahma')` branches in already-large files. Instead:

- **New `chatType` value:** `'brahma'`. Widen `ChatTypeEnum` and the `'salon' | 'help' | 'autonomous'` unions everywhere they appear (see §4.1 checklist).
- **New parallel modules** that mirror help-chat structure but stand alone:
  - `lib/services/brahma-console/orchestrator.service.ts`
  - `lib/brahma-console/system-prompt-builder.ts`
  - `app/api/v1/brahma-console/route.ts`, `[id]/route.ts`, `[id]/messages/route.ts`
  - `components/providers/brahma-console-provider.tsx`
  - `components/brahma-console/BrahmaConsoleDialog.tsx`, message list, composer, model picker, streaming hook
- **Share the genuinely generic pieces:** `FloatingDialog`, `streamMessage` + the agent-loop helpers in `streaming.service.ts`, `buildTools` (with Brahma-specific flags), SSE encoders, `repos.chats.*`, the connections query.

Because the console has **no character**, the help path's assumption that every participant has a `characterId` does not hold. Rather than fork `processHelpResponse` (which loads a character), the Brahma orchestrator builds its own minimal per-turn call: system prompt + history + tools + chosen connection profile, with no character plumbing. See §5.2.

---

## 4. Data model changes

### 4.1 `chatType` enum widening — exhaustive checklist

Add `'brahma'` to `ChatTypeEnum` (`lib/schemas/chat.types.ts:68`) and to every hardcoded union/string-literal list. Audit and update each of these (grep for `chatType`):

- `lib/schemas/chat.types.ts` — `ChatTypeEnum` (line 68); both `chatType: ChatTypeEnum.default('salon')` schema fields (~664, ~970).
- `lib/database/repositories/chats.repository.ts` — `findByType(userId, chatType: 'salon' | 'help')` signature (line 207) → widen to include `'brahma'`. **Crucially**, every `chatType: { $ne: 'help' }` exclusion that exists to keep help chats out of Salon/memory/title queries must ALSO exclude `'brahma'`. The cleanest fix is to change these from `$ne: 'help'` to `$in: ['salon']` (or `$nin: ['help','brahma','autonomous']`), so any new non-salon type is excluded by default. Known site: `findRecentSummarizedByCharacter` (~line 189). **Search for all `$ne: 'help'` and `chatType ===` / `chatType !==` occurrences and decide each.**
- `lib/chat-utils.ts` — `chatType?: 'salon' | 'help' | 'autonomous'` (line 44) and the derived flags (~line 73).
- `lib/services/chat-enrichment.service.ts` — union types (~212, ~591).
- `lib/chat/context-summary.ts` — branches on `'help'`/`'autonomous'` for titling/summarization (~127, 155, 250, 485, 638). **Brahma chats DO get auto-retitling** (nice UX for past-chat lists) but must be treated like help (not autonomous) for summarization, and must NOT trigger memory. Confirm each branch.
- `lib/background-jobs/handlers/title-update.ts` — `isHelpChat` (~57); decide Brahma's titling path (recommend: same as help).
- Any other `chatType` consumer surfaced by grep (memory-processor, cheap-llm-tasks, message-finalizer, autonomous-room services). For each: Brahma must behave like a **non-autonomous, non-memory** chat. Default-deny memory; allow titling/summary.

> **Single-source-of-truth tip:** consider adding a small helper `chatTypeForms(chatType)` or constants (`MEMORY_ENABLED_CHAT_TYPES`, `SALON_LIKE_CHAT_TYPES`) so these scattered checks become one lookup. Optional but reduces drift. Follow the repo's existing DRY/SoT conventions.

### 4.2 Page-URL column — NOT NEEDED

**Decision: the Brahma Console is not page-aware.** It does not track the current page. Therefore:
- Do **not** reuse `helpPageUrl` and do **not** add a `consolePageUrl` column.
- The provider has **no** pathname-tracking effect.
- There is **no** `?action=update-context` endpoint.
- The system prompt contains **no** "current page" line.

This removes a whole class of plumbing the Help Chat carries. Wherever this spec mentions page context for reference, treat it as *help-chat behavior we are deliberately omitting*.

### 4.3 Model persistence (the active connection profile)

The console must remember which model it's using and let you switch it, continuing the same chat. Options:

- **Recommended:** store the active profile at the **chat level** in a new nullable column `consoleConnectionProfileId TEXT DEFAULT NULL` on `chats` (a Brahma chat has exactly one model at a time). Switching the model PATCHes this column; the next turn reads it. This survives reload and is per-conversation, which matches "continue the same chat with the new model."
- Alternative (no migration): create a single synthetic participant row per Brahma chat and store the profile in `participant.connectionProfileId` (mirrors how help captures it), updating that participant on switch. This avoids schema change but means carrying a participant with no character, which fights the "no character" simplification.

**Recommendation:** the new column. It's cleaner and avoids a character-less participant. If you add it:
- Write a migration under `migrations/scripts/` (registered in `index.ts`), with a **pretty-label entry** in `lib/startup/prettify.ts` (steampunk-Wodehouse voice — e.g. "Wiring the Brahma Console's dial to its chosen engine…") and `reportProgress(...)` if it loops over rows (a pure `ALTER TABLE` won't).
- Update `docs/developer/DDL.md` to document the new column (must stay current).
- **Export/backup (decided: include Brahma chats).** Reflect the new column **and** the `chatType: 'brahma'` value in `.qtap`/SillyTavern export logic, `public/schemas/qtap-export.schema.json`, and any backup/restore mapping. Brahma chats export and restore like any other chat.

First-run default: when creating a Brahma chat with no profile chosen, seed `consoleConnectionProfileId` from the user's **default** connection profile (`repos.connections.*` — find the `isDefault`/default profile; reuse whatever the rest of the app uses to resolve the default).

---

## 5. Backend implementation

### 5.1 API routes — `app/api/v1/brahma-console/`

Mirror the help-chat routes, action-dispatch pattern, `createAuthenticatedHandler` / `getActionParam` / `isValidAction`, responses from `@/lib/api/responses`. All routes verify `chatType === 'brahma'`.

- **`route.ts`**
  - `GET` (no action) → `handleList`: chats where `chatType==='brahma'`, ordered by `lastMessageAt desc`, with title + message count for the past-chats list.
  - `POST` → `handleCreate`: body `{ connectionProfileId? }` (no `pageUrl` — console is not page-aware). Resolve `connectionProfileId` → default profile if omitted. Create `repos.chats.create({ chatType: 'brahma', consoleConnectionProfileId })`. Optionally seed a SYSTEM marker message. Return the new chat.
  - **No `eligibility` action.** Brahma's only precondition is "at least one connection profile exists." Expose that as a tiny `GET ?action=can-open` returning `{ canOpen: boolean, defaultProfileId }`, or just let the launcher check the connections query directly. **Recommendation:** check the connections query in the provider; skip a dedicated endpoint.
- **`[id]/route.ts`**
  - `GET` → details (chat + active profile). No page URL.
  - `PATCH` (no action) → `handleRename` (`{ title }`, set `isManuallyRenamed`).
  - `PATCH ?action=set-model` → `{ connectionProfileId }` → update `consoleConnectionProfileId`. Validates the profile belongs to the user. This is the "change the model at any time" endpoint; same chat continues.
  - `DELETE` → `repos.chats.delete`.
  - **No `update-context` action** — console is not page-aware.
- **`[id]/messages/route.ts`**
  - `POST` → `handleSendMessage`: `{ content, fileIds? }` → `handleBrahmaConsoleMessage(repos, chatId, userId, opts)` → `text/event-stream`.
  - `GET` → list messages.

### 5.2 Orchestrator — `lib/services/brahma-console/orchestrator.service.ts`

`handleBrahmaConsoleMessage(repos, chatId, userId, options): ReadableStream<Uint8Array>`. Adapt from the help orchestrator but **single-turn, character-less, memory-free**:

1. Load chat; assert `chat.chatType === 'brahma'` and `chat.userId === userId`.
2. Save the user message (`repos.chats.addMessage`).
3. Resolve the connection profile from `chat.consoleConnectionProfileId` (fallback default). Load the full `ConnectionProfile` (provides `allowWebSearch`, provider, model, etc.).
4. Build the system prompt via `buildBrahmaSystemPrompt({ profile })` (§5.4). No page context.
5. Load conversation history (full transcript) for context.
6. Build tools via `buildTools(...)` with Brahma flags (§5.3).
7. Run the same agent loop pattern as help (`maxAgentTurns = 10`, tool-call detection via `detectToolCallsInResponse` / `parseTextBlocksFromResponse`, execution via `processToolCalls` / `saveToolMessages`, stuck-loop guard `MAX_DUPLICATE_TOOL_CALLS`), streaming through `streamMessage(...)`. Reuse the SSE encoders from `streaming.service.ts` (`encodeContentChunk`, `encodeDoneEvent`, `encodeErrorEvent`, `safeEnqueue`, `safeClose`). **Single participant → no turn-start/turn-complete/chain-complete events** (those are for the multi-character help loop).
8. **`triggerAsyncTasks` equivalent:** fire `triggerContextSummaryCheck` (so past chats get auto-titles) and `trackMessageTokenUsage` / `estimateMessageCost` (cost tracking). **Do NOT call `triggerTurnMemoryExtraction`.** This is the load-bearing omission that satisfies "no persistent memories."

There is **no character load**, no `processHelpResponse`, and **no page resolution at all** (`resolveAllHelpContentForUrl` is not used). Nothing about the current page enters the prompt.

### 5.3 Tool wiring — Brahma flags for `buildTools`

Call `buildTools(...)` (or a thin `buildBrahmaTools` wrapper around it) with:

- `agentModeEnabled: true` (enables `submit_final_response` and the agent loop).
- `helpToolsEnabled: false` (NO `help_search` / `help_settings` / `help_navigate`).
- `documentEditing: true` (enables the `doc_*` read **and** write/edit family — full read/write per decision).
- `isMultiCharacter: false`.
- Image, project, requestFullContext, wardrobe, askCarina: `false`/`null`.
- Web search & `curl`: **do not force.** Let them flow from the connection profile / installed plugins exactly as the normal path does (`connectionProfile.allowWebSearch` gates web search; the curl plugin gates `curl`). Pass the real `connectionProfile` through so its `allowWebSearch` is honored.

**Critical divergence — strip the always-on help set.** In help, several tools (`send_mail`, `list_email`, `read_conversation`, `upsert_annotation`, `delete_annotation`, `terminal_*`, `rng`/`state`, and the scriptorium **memory** search) are added unconditionally in `plugin-tool-builder.ts`. Brahma must **not** get these. Two approaches:

- **Preferred:** introduce a tool-context flag (e.g. `surface: 'salon' | 'help' | 'brahma'` or a boolean bundle like `includeWorkspaceTools`, `includeMemorySearch`) threaded into `plugin-tool-builder.ts`, and guard the currently-unconditional `push`es behind it. This keeps the single-source-of-truth tool builder authoritative (per CLAUDE.md: don't bypass the tool-definition chokepoint). For Brahma set `includeWorkspaceTools: false`, `includeMemorySearch: false`.
- Avoid post-filtering the tool array after the fact — it's brittle and drifts from the builder. Gate at construction.

**Document search without memory.** The `search` (scriptorium) tool's input schema allows `sources: memories | conversations | documents | knowledge`. For Brahma, you want document/knowledge/conversation search but **no memory**. Implement by: (a) keeping the `search` tool enabled, but (b) constraining its allowed `sources` for the Brahma surface so `memories` is rejected/omitted — either via a surface-aware variant of the tool input schema (preferred, keeps the Zod schema as SoT per the tool chokepoint rule) or by the handler refusing `memories` when invoked from a Brahma chat. Document this in the tool's `.describe()` so the model knows memory isn't searchable here.

> **Net tool set for Brahma:** `search` (documents/knowledge/conversations, **no memories**), the `doc_*` read/write family, web search (if profile allows), `curl` (if plugin enabled), and `submit_final_response`. Nothing else.

Every new/touched backend path must fire debug logs via the built-in logger (CLAUDE.md convention), e.g. a `logger.child({ context: 'BrahmaConsole' })`.

### 5.4 System prompt — `lib/brahma-console/system-prompt-builder.ts`

`buildBrahmaSystemPrompt({ profile })` → a short, neutral assistant prompt. No `{{char}}`/`{{user}}` templating, no character identity, no personality, **no page context**. Roughly:

> You are the Brahma Console, a direct line to a large language model inside **Quilltap**, a self-hosted AI workspace for writers and worldbuilders. You are a capable, concise, neutral assistant with no assigned persona. You can search and read the user's document stores and knowledge folders, and (when available) search the web and fetch URLs. You do not have access to the user's memories, and nothing said here is remembered after this conversation beyond the visible transcript. When you use a tool, you actually call it — you do not merely describe calling it.

Keep it minimal. Do **not** seed Ariadne or any character. Not user-editable in v1 (note as a possible future setting).

---

## 6. Frontend implementation

### 6.1 Provider — `components/brahma-console-provider.tsx`

Mirror `help-chat-provider.tsx`:
- `isOpen`, `openConsole()`, `closeConsole()`.
- `currentChatId` persisted in localStorage key `quilltap:brahma-console-last-id` (use the same plain-string storage approach the help provider settled on — store the raw id, not JSON-stringified).
- `activeConnectionProfileId` state, initialized from the current chat's `consoleConnectionProfileId` (or default profile). `setModel(profileId)` calls `PATCH …?action=set-model` and updates local state — **same chat continues**.
- **No pathname tracking.** The console is not page-aware; omit the help provider's `usePathname` effect entirely.
- Connections query (TanStack) to populate the model picker and resolve the default. New query-keys block in `lib/query/keys.ts`:
  ```ts
  brahmaConsole: {
    all: ['brahma-console'] as const,
    entity: (apiUrl: string) => ['brahma-console', 'entity', apiUrl] as const,
    pastChats: ['brahma-console', 'past-chats'] as const,
  },
  ```
  (No `eligibility` key — gate on "≥1 connection profile" via the existing connections query.)
- Mount `<BrahmaConsoleProvider>` alongside `<HelpChatProvider>` in `components/layout/app-layout.tsx`, and render `<BrahmaConsoleDialog />` inside it.

### 6.2 Dialog — `components/brahma-console/BrahmaConsoleDialog.tsx`

- Wrap `FloatingDialog` with a **distinct `storageKey`** (e.g. `quilltap:brahma-console-geometry`) so its window position is independent of the Help window. Both can be open and positioned separately.
- Header: title "Brahma Console", a **model picker** in `headerActions` (so you can switch models at any time without leaving the chat), and a "past chats / new chat" affordance like the help launcher (opening the console shows past Brahma chats; selecting one resumes it; "New" starts a fresh one).
- Body: a single conversation pane (no character tabs, no guide tab). Reuse/adapt `HelpChatMessageList` → `BrahmaConsoleMessageList` and `HelpChatComposer` → `BrahmaConsoleComposer`, and a streaming hook adapted from `useHelpChatStreaming` (single-stream, no turn/chain events).
- Past-chats list comes from `GET /api/v1/brahma-console` (the `pastChats` query). Each row: title (auto-generated), last-message time; click to resume, with a delete affordance.

### 6.3 Model picker — `components/brahma-console/ModelPicker.tsx`

There is **no existing always-inline connection-profile dropdown** to reuse directly. Closest references: `components/chat/SelectLLMProfileDialog.tsx` (modal) and `components/characters/ai-wizard/steps/ProfileSelectionStep.tsx`. Build a small inline dropdown over the connections query (`GET /api/v1/connections` / `repos.connections.findByUserId`) listing `{ id, name, provider, modelName }`, current selection checked. On select → `setModel(id)` (PATCH `set-model`). Place it in the dialog header. Show provider + model so the user knows what engine they're on.

### 6.4 Launcher icon — sidebar footer

- Add a new icon **below** the Help icon in `components/layout/left-sidebar/sidebar-footer.tsx`. Use `useBrahmaConsoleOptional()`; `onClick={console.openConsole}`; disabled only if there are zero connection profiles (with a tooltip explaining you need a connection profile first).
> **Both icon SVGs already exist in the repo and are final. DO NOT regenerate, redraw, or "improve" them. Use the committed files exactly as-is.** Your only icon tasks are (a) register the default in the icon registry and (b) add the Madman's Box override entry to that theme's `theme.json`. The SVG source for each is reproduced verbatim below so you can verify the files match — if a file's contents differ from what's shown here, trust the file on disk, do not overwrite it.

#### (a) Default icon — already at `public/images/icons/brahma-console.svg`

A **tetra-radial console** mark: a ring with four nodes wired to a central hub (evokes Brahma's fourfold symmetry *and* a console/switchboard). Authored to the exact convention of the other default footer icons (`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, **round** caps/joins) so it renders correctly as a `mask`-mode icon and tints to the theme. Verified legible at 24px. Verbatim source:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="3.4" r="1.6"/>
  <circle cx="12" cy="20.6" r="1.6"/>
  <circle cx="3.4" cy="12" r="1.6"/>
  <circle cx="20.6" cy="12" r="1.6"/>
  <path d="M12 5.4v3.1M12 18.6v-3.1M5.4 12h3.1M18.6 12h-3.1"/>
  <circle cx="12" cy="12" r="3"/>
</svg>
```

**Register it** in `components/ui/icons/icon-registry.ts`, in the registry object, alongside the other nav/domain icons (it sits next to `'help'`):

```ts
'brahma-console': { defaultFile: '/images/icons/brahma-console.svg', defaultMode: 'mask' },
```

The icon-name union type is *derived from* the registry object (`satisfies Record<string, IconDefinition>` → the `IconName` union is `keyof typeof ICON_REGISTRY`), so adding the entry above automatically widens the type — no separate union edit needed. Just make sure you add it to the registry object itself, not a copy.

#### (b) Madman's Box theme override — already at `themes/bundled/madmans-box/icons/brahma-console.svg`

Madman's Box ships its own icon set in `themes/bundled/madmans-box/icons/` in a distinct house style (call it the theme's "Gallifreyan-adjacent" grammar). The defining differences from the default icons are: **`stroke-linecap="butt"` and `stroke-linejoin="miter"`** (sharp, not round — this is the tell), a thin `stroke-width="1.25"` for secondary strokes, small filled `currentColor` dots as accents, concentric rings, and faint low-opacity inner arcs. The Brahma Console override speaks that grammar.

**Design rationale (so you understand it, not so you redraw it):** the theme's existing `settings.svg` is *also* a concentric-ring mark, but with eight straight **radial spokes** (a dial/gear). To stay visually distinct from settings in the same sidebar, the Brahma override deliberately uses **four cardinal dots** (Brahma's four faces) instead of spokes, plus two faint `0.6`-opacity orbital arcs. The four-dot accent also echoes the theme's own `database.svg` / `themes.svg` dot motif, so it reads as native to the set. Plain `currentColor` throughout (no hardcoded accent) — every Madman's Box override does this and inherits the theme's icon tint. Verbatim source:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter">
  <circle cx="12" cy="12" r="8.5" stroke-width="1.25"/>
  <circle cx="12" cy="12" r="4"/>
  <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>
  <circle cx="12" cy="3.5" r="1.4" fill="currentColor" stroke="none"/>
  <circle cx="20.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>
  <circle cx="12" cy="20.5" r="1.4" fill="currentColor" stroke="none"/>
  <circle cx="3.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>
  <path d="M12 7.2 A4.8 4.8 0 0 1 16.8 12" stroke-width="1.25" stroke-opacity="0.6"/>
  <path d="M12 16.8 A4.8 4.8 0 0 1 7.2 12" stroke-width="1.25" stroke-opacity="0.6"/>
</svg>
```

**Wire up the override** in `themes/bundled/madmans-box/theme.json`. The theme declares per-icon overrides in its `"icons": { ... }` map (around line 188). Add the `brahma-console` entry next to the existing `"help"` / `"settings"` entries (near line 264–267):

```json
    "settings": "icons/settings.svg",
    "themes": "icons/themes.svg",
    "wardrobe": "icons/wardrobe.svg",
    "help": "icons/help.svg",
    "brahma-console": "icons/brahma-console.svg",
```

(Insert the `"brahma-console"` line into the existing map — don't reorder the others. JSON: ensure the preceding line keeps its trailing comma and yours has one if it isn't last.)

**Version bump (required by the theme/bundle rules).** A bundled theme changed, so bump `themes/bundled/madmans-box/theme.json`'s `"version"` (currently `1.1.3` → `1.1.4` patch) and run `npm run build:plugins` before staging, per CLAUDE.md's plugin/bundle hard-stop. No other bundled theme gets an override — every theme except Madman's Box inherits the default mask and tints it. (If the stylebook / theme-storybook enumerate icon names, add `brahma-console` there too so the new icon shows up in theme previews.)

### 6.5 Voice / copy

All user-facing strings (window chrome, tooltips, empty states, the "New conversation" affordance, migration loading labels) use the project's **steampunk + Roaring 20s + Gatsby + Wodehouse + Lemony Snicket** voice. The system prompt itself (§5.4) is plain/neutral — it's the model's instruction, not user-facing chrome.

---

## 7. Documentation, tests, and commit hygiene (required by CLAUDE.md)

- **`help/*.md`:** add a help doc for the Brahma Console (it's a user-visible feature). Include the `url` frontmatter field and an "In-Chat Navigation" section whose `help_navigate(url: "...")` matches that `url`. (Yes — the *Help Chat* documents the *Brahma Console*; the console itself has no help_* tools.) Update the docs list in `.claude/commands/update-documentation.md` if you add new docs there.
- **`docs/CHANGELOG.md`:** add a terse, plain-English entry (no steampunk voice) on commit.
- **`docs/developer/DDL.md`:** update if you add `consoleConnectionProfileId` (and note the `chatType: 'brahma'` value).
- **`public/schemas/qtap-export.schema.json`:** add the `chatType: 'brahma'` value and the `consoleConnectionProfileId` field — Brahma chats are exported (decided).
- **Tool snapshot test:** if you alter `plugin-tool-builder.ts` gating or add a surface flag, register/refresh `lib/tools/__tests__/tool-definitions-snapshot.test.ts` (`npx jest -u`).
- **Tests:** unit-test the orchestrator's memory omission (assert `triggerTurnMemoryExtraction` is NOT called for `chatType:'brahma'`), the search tool's memory exclusion, model-switch continuing the same chat, and the `chatType` exclusion fixes (Brahma chats don't appear in Salon/memory/title queries). Use `renderWithQuery` / `createQueryWrapper` for any component tests.
- **Type-check** with `npx tsc` (not `npm run build`).
- Migrations (if any) follow the migration rules: pretty-label + `reportProgress`.

---

## 8. Suggested build order

1. **Schema/enum first:** widen `ChatTypeEnum` to include `'brahma'`; fix every `$ne: 'help'` / `chatType` exclusion to also exclude Brahma (prefer an allow-list helper). Add `consoleConnectionProfileId` column + migration + DDL update. Type-check.
2. **Tool gating:** add the Brahma surface flag(s) to `plugin-tool-builder.ts`; gate the workspace/memory tools; constrain `search` sources to exclude memories for Brahma. Refresh the tool snapshot test.
3. **Orchestrator + system prompt:** `lib/brahma-console/system-prompt-builder.ts` and `lib/services/brahma-console/orchestrator.service.ts` (single-turn, no character, no memory extraction).
4. **API routes:** `app/api/v1/brahma-console/{route,[id]/route,[id]/messages/route}.ts`.
5. **Query keys + provider:** add `brahmaConsole` keys; build `brahma-console-provider.tsx`; mount in `app-layout.tsx`.
6. **UI:** `BrahmaConsoleDialog`, message list, composer, streaming hook, `ModelPicker`; wire the past-chats list.
7. **Icon + launcher:** both icon SVGs already exist (do not regenerate — see §6.4). Register the default in `icon-registry.ts`; add the `brahma-console` entry to Madman's Box `theme.json` + bump its version + `npm run build:plugins`; add the sidebar-footer button below Help.
8. **Docs + tests + changelog;** `npx tsc`; run the relevant Jest suites; then `/commit`.

---

## 9. Open items — all resolved

All previously-open items are now decided (see the decision table in §1):

1. **Export/backup inclusion** — **Yes**, Brahma chats are included in exports/backups. `qtap-export.schema.json` and backup/restore mapping must carry `chatType: 'brahma'` and `consoleConnectionProfileId`.
2. **Page-URL column** — **Not needed.** The console is not page-aware (§4.2). No column reuse, no new column, no `update-context` endpoint, no pathname effect.
3. **Icon design** — **Decided and built.** Both SVGs exist and are final: default `public/images/icons/brahma-console.svg` and Madman's Box override `themes/bundled/madmans-box/icons/brahma-console.svg`. Claude Code only registers them (§6.4) — it must not regenerate them.
4. **Past-chats UX parity** — **Match Help.** The launcher opens to a past-chats list with a "New conversation" affordance.

> Nothing here blocks implementation. One soft item for the implementer's judgment remains in §5.3: whether to gate the stripped-down tool set via a new `surface`/flag in `plugin-tool-builder.ts` (preferred) versus another mechanism — but the preferred approach is specified.
