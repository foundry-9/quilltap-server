# Brahma Console — Writing Assistant mode and attachments

> **Status:** Implemented 4.13-dev (2026-11-12). The §14 live check in V4test is outstanding. See *As built* at the end.
> **Builds on:** [brahma-console.md](brahma-console.md), [brahma-sql-access.md](brahma-sql-access.md).
> **One-line summary:** Two additions to the Brahma Console. (1) A per-conversation **Writing Assistant** mode, off by default, chosen in the header beside the model picker: the operator names a context (conversations, projects, document stores, Quilltap General), and every answer is one Markdown piece meant to be copied, downloaded or saved — never a remark to the operator. (2) In **both** modes, files and images can be attached or pasted; they are stored under `Brahma/` in Quilltap General and reach the model the way Salon attachments do.

The two parts are independent and can land as separate commits. Part B (attachments) has no dependency on Part A.

---

## 1. Decisions

### 1.1 Settled with the product owner

| Question | Decision |
|---|---|
| Default | Off. The launcher always opens with the switch off; it is not a remembered preference. |
| Scope of the mode | **Per conversation, fixed at start.** Chosen on the launcher; a conversation stays in the mode it began in. There is no mid-conversation switch. |
| What context does | **A manifest, not a pre-read and not a fence.** The prompt lists the chosen sources. The model is not told to read them all first; they inform its research, and it searches, greps and reads what is relevant. Its reach is unchanged — it is still the whole Console and may look elsewhere. |
| Characters of a context conversation | Their **character vaults join the list of sources** automatically. No memory access; the Console's no-memory rule stands. |
| Tools in Writing Assistant | **Read-only.** Search, document reads, SQL, lookups, web search and curl stay as the profile and plugins allow. Document write/edit/delete tools are withheld. |
| Output | Thinking may be shown. The deliverable is **one Markdown message at the end of each turn**. It is conversational — the operator can ask for refinements — but each answer is the complete piece: no comments to the requester, no account of where it looked, no offers of further help. |
| Revisions | **Every turn is its own output.** Each answer is a complete, standalone output card with its own controls. Earlier outputs stay in the transcript unchanged. The model rewrites the whole piece, never a diff. |
| Output controls | **Copy**, **Download** (`.md`) and **Save to store** (store and folder picker). |
| Attachments, both modes | Attach or paste files and images. Same accepted types and same processing as the Salon. |
| Attachment storage | Flat: `Brahma/<filename>` at the root of Quilltap General. |
| Attachment lifetime | **Deleted with the conversation.** |

### 1.2 Decided by this spec (reasonable defaults; change here if wrong)

| Question | Decision | Why |
|---|---|---|
| Is the context list editable after the conversation starts? | **Yes**, at any time; a change applies from the next turn. Only the *mode* is fixed. | Refinement often means "also look at this other chat." |
| Which conversations can be context | Salon and autonomous chats. Not help chats, not other Brahma chats. | Matches "find conversations … and the characters that are in those conversations." |
| Does a context conversation bring its project? | No. Only its characters' vaults are automatic. The operator adds the project explicitly. | The request names characters only. |
| Archived characters | Listed by name in the manifest, marked archived, with **no vault source** (the vault is a tombstone). | CLAUDE.md "Archived characters are tombstones." |
| A context item that no longer exists | Dropped from the manifest with a `warn`; the UI chip shows it struck through with a remove control. Never an error. | A deleted chat must not wedge the conversation. |
| The model wants to ask a clarifying question | It may not. It makes the most reasonable choice and writes the piece. | "The output is always what it thinks you should put in." |
| A file the operator moved out of `Brahma/` | Survives the conversation's deletion. Only links still under `Brahma/` in General are removed. | Moving it is the operator claiming it. |
| `@Brahma` inline queries and the one-shot service | Unchanged. No Writing Assistant mode, no attachments. | Out of scope. |
| The read-only guarantee | `effectCeiling: 'read'` on the tool context, in addition to offering `docToolsMode: 'read'`. | The offer is advice; the ceiling is the guarantee (`resolveToolPermit`). |

### 1.3 Consequences worth knowing

- **`Brahma/` is in Quilltap General, so it is in every character's General tier.** Attachments are indexed and embedded like any General document and can surface in a character's search. This follows from the chosen location. If that is unwanted for a file, the per-document policy frontmatter does not apply to binaries; the remedy is to move the file.
- **`curl` under a read ceiling.** The curl plugin must declare an effect of `read` (or `none`) to survive the ceiling; an undeclared plugin tool is `write` and will be refused in Writing Assistant mode. Check the plugin's declared effect. If it is undeclared, declare it (plugin patch bump, `npm run build:plugins`) rather than special-casing the Console.

---

## Part A — Writing Assistant mode

## 2. Data model

Two new nullable columns on `chats`, both meaningful only when `chatType = 'brahma'`:

```sql
"consoleMode"    TEXT DEFAULT NULL,  -- 'writing' | NULL (NULL reads as the ordinary Console)
"consoleContext" TEXT DEFAULT NULL   -- JSON array of context refs; NULL or [] = none
```

`consoleContext` is an ordered array of:

```ts
// lib/schemas/chat.types.ts
export const ConsoleContextRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'),    id: UUIDSchema }),
  z.object({ kind: z.literal('project'), id: UUIDSchema }),
  z.object({ kind: z.literal('store'),   id: UUIDSchema }),   // doc_mount_points.id
  z.object({ kind: z.literal('general') }),
])
export const ConsoleModeEnum = z.enum(['writing'])
```

Derived character vaults are **never stored** — they are computed from the chat refs at read time, so a cast change in a context conversation is picked up on the next turn.

Follow `consoleConnectionProfileId` for every touchpoint; it is the precedent and each of these already has a line for it:

- `lib/schemas/chat.types.ts` — both chat schemas (near lines 1177 and 1577).
- Migration `migrations/scripts/add-console-writing-assistant-fields.ts`, registered in `index.ts` (all three lists). Pure `ALTER TABLE`, so no `reportProgress`. Pretty label in `lib/startup/prettify.ts`, house voice, e.g. *"Fitting the Console with a writing desk and a shelf for its references…"*.
- `docs/developer/DDL.md`.
- `public/schemas/qtap-export.schema.json`.
- `lib/backup/id-fields.ts` — `consoleContext[].id` is polymorphic (target kind depends on `kind`), so it needs a `bespoke` entry and a small remap routine: remap by `kind` (`chat` → chat, `project` → project, `store` → mount point), and **drop the entry** when the target is missing. `id-fields-guard.test.ts` will fail until this is listed.
- Export, import and backup carry both columns.

`consoleMode` is written only at creation. No route accepts a change to it.

## 3. Context resolution

New module `lib/brahma-console/writing-context.ts`, the one place a stored context becomes something usable. Server only.

```ts
export interface ResolvedConsoleContext {
  conversations: Array<{
    ref: { kind: 'chat'; id: string }
    title: string
    chatType: 'salon' | 'autonomous'
    messageCount: number
    firstMessageAt: string | null
    lastMessageAt: string | null
    cast: Array<{ characterId: string; name: string; archived: boolean; vaultStoreName: string | null }>
  }>
  projects: Array<{ ref; name: string; storeNames: string[] }>   // every linked store, official first
  stores:   Array<{ ref; name: string }>
  general:  { storeName: string } | null
  /** Character vaults derived from the conversations, de-duplicated by character. */
  characterVaults: Array<{ characterId: string; name: string; storeName: string; via: string[] /* chat titles */ }>
  /** Refs whose target no longer exists. */
  missing: ConsoleContextRef[]
}

export async function resolveConsoleContext(repos, userId, refs): Promise<ResolvedConsoleContext>
export function renderConsoleContextManifest(resolved: ResolvedConsoleContext): string  // '' when empty
```

Rules:

- **Cast names** come from `resolveSpeakerNames` (`lib/chat/speaker-names.ts`) — raw reads, every seat including removed ones, so a broken vault costs a label and not a throw.
- **Stores are resolved through `lib/mount-index/reach.ts`**, never by hand: a project's stores via `resolveProjectMountPointIds`, a character's vault via `resolveOwnerStore` with no `ensure` (a read probe never provisions), General via the `general` scope. An archived character resolves to null and gets `vaultStoreName: null`.
- **Store names in the manifest are the real store names**, since a name is a `qtap://` address. Never `self` (bug 256).
- A store named both directly and through a project or a character appears once.
- Empty is absent: with no refs, or none that resolve, `renderConsoleContextManifest` returns `''` and the prompt gains nothing.
- Log at `debug` what was resolved (counts per kind) and at `warn` each missing ref.

## 4. The prompt

`buildBrahmaSystemPrompt` gains two options, `writingAssistant?: boolean` and `contextManifest?: string`. Model instructions stay in plain English.

Order of sections in Writing Assistant mode:

1. A **Writing Assistant brief** that *replaces* the ordinary base brief (the ordinary brief says "write to them" and "speak helpfully in your own voice," both wrong here).
2. The context manifest, when non-empty.
3. `BRAHMA_SQL_PROMPT` (unchanged).
4. Tool instructions and agent-mode instructions (unchanged mechanics; see §5.3).

### 4.1 The brief (draft text — tune in live evaluation)

> You are the Brahma Console in Writing Assistant mode, inside **Quilltap**, a self-hosted AI workspace for writers and worldbuilders. The operator will describe a piece of text they need. Your final answer is that text and nothing else: it will be copied or saved to a file exactly as you give it.
>
> Rules for the final answer:
> - It is the finished piece, in Markdown, complete on its own.
> - No greeting, no preamble, no closing remark, no notes to the operator, no questions, no offers.
> - Do not say where you looked, what you read, or what else you could do. Do not mention tools, sources, or this conversation.
> - Do not wrap the whole piece in a code fence unless the piece itself is a code block.
> - If the request leaves something open, choose the most fitting option and write it. Do not ask.
> - When the operator asks for a change, give the whole revised piece again, not a description of the change and not only the changed part.
>
> Before answering you may research freely with your tools: search and read the operator's document stores, read conversations, look up characters, query the database read-only, and (when the chosen model allows it) search the web and fetch URLs. You cannot write to any store. You have no access to the operator's memories. Research is for you; none of it appears in the answer.

### 4.2 The manifest

Rendered by `renderConsoleContextManifest`. Shape:

```
## Sources for this piece

The operator has named these sources. They are where the piece's facts, voices and
conventions come from. You need not read them all: search, grep and read what the
request calls for. You may look elsewhere when these do not answer the question.

### Conversations (read with read_messages / lookup_messages by chat id)
- "The Night Train" — id 3f2a…  · 212 messages · 2026-09-02 to 2026-10-19
  Cast: Vivienne Hale, Marcus Oyelaran, Tobias (archived)

### Character vaults
- Vivienne Hale — store "Vivienne Hale Character Vault"
- Marcus Oyelaran — store "Marcus Oyelaran Character Vault"

### Projects
- "Ashfall" — stores: "Ashfall", "Ashfall Research"

### Document stores
- "House Style"

### Quilltap General
- store "Quilltap General"
```

Sections with nothing in them are omitted. Full chat ids are printed (the tools need them). The manifest carries **no content** from any source — titles, ids, names and counts only.

The manifest is rebuilt each turn from the stored refs. It is stable across turns unless the operator edits the context, so the prompt-cache prefix survives.

## 5. The orchestrator

All changes are in `lib/services/brahma-console/orchestrator.service.ts`, keyed on `chat.consoleMode === 'writing'`. Keep one loop; do not fork a second orchestrator. If the branches grow past a handful, lift the mode-dependent values into a small `ConsoleTurnPlan` object built once at the top of `processBrahmaResponse` (tool options, effect ceiling, prompt options, agent-instruction kind) so the loop itself never tests the mode.

### 5.1 Tools

| | Console | Writing Assistant |
|---|---|---|
| `docToolsMode` | `'full'` | `'read'` |
| `effectCeiling` on `ToolExecutionContext` | unset | `'read'` |
| `sqlAccess`, `excludeMemorySearch`, `includeWorkspaceTools: false`, wardrobe/inventory/Carina off | unchanged | unchanged |
| `operatorSurface: true` | yes | yes — the context is a manifest, not a mount pool |

Do not pass a `mountPool`; the executor refuses a context carrying both, and the decision is that reach is unchanged.

### 5.2 Context

Per turn, when in Writing Assistant mode: `resolveConsoleContext` → `renderConsoleContextManifest` → `buildBrahmaSystemPrompt({ writingAssistant: true, contextManifest })`.

### 5.3 The single output

The run already ends with one final assistant message (via `submit_final_response`, the raw-JSON fallback, or a final turn with no tool calls). Writing Assistant mode adds three things:

1. **Mark the output.** The final assistant message of a successful run is saved with `systemKind: 'writing-output'` (the field exists on messages; `systemSender` stays unset). This is the only thing the client reads to decide what is an output card. Do not derive it from position.
2. **Intermediate prose is not output.** Text a model emits alongside tool calls is still saved on the tool-call assistant message as today, without the marker. The client renders it as working notes (§7.3).
3. **Failures are not output.** The budget-exhaustion salvage message (bug 47 path) and the stuck-loop fallback are saved **without** the marker, and in Writing Assistant mode the salvage text must not include the raw tool-result digest as if it were the piece. The client shows an unmarked final message as a notice, with no Copy / Download / Save.

Agent-mode instructions: `buildAgentModeInstructions(maxAgentTurns, 'research')` and `buildForceFinalMessage('research')` tell the model to summarise its findings. Add a `'writing'` kind to both (in `agent-mode-resolver.service.ts`) whose wording is "call `submit_final_response` with the finished piece and nothing else." The stuck-loop nudge in the orchestrator gets the same wording in this mode.

Light post-processing of a marked output, in one pure function `normalizeWritingOutput(text)` (`lib/brahma-console/writing-output.ts`), applied before saving:

- trim;
- if the whole text is a single ```` ```markdown ```` / ```` ```md ```` fence, unwrap it.

Nothing else. No heuristic stripping of "Here is…" lines — that is the prompt's job, and a stripper will eventually eat a real first line.

Reasoning stays display-only and is saved as today. `triggerAsyncTasks` is unchanged: context-summary check for auto-titling (through `applyAutoTitle`), never memory extraction.

### 5.4 Stream

The Console's client still reads the legacy frame shape through `legacyFrameEncoder`. No new frame is needed: add `systemKind` to the `done` payload so the client can settle the streamed text as an output card or a notice without waiting for the reload.

## 6. API

All under `/api/v1/brahma-console`, action-dispatch, strict Zod bodies.

| Route | Change |
|---|---|
| `POST /` | Body gains `mode?: 'writing'` and `context?: ConsoleContextRef[]` (context only with `mode: 'writing'`, else 400). Validates each ref exists and belongs to the user; a `chat` ref must be `salon` or `autonomous`. |
| `GET /` | Each row gains `consoleMode`. |
| `GET /[id]` | Gains `consoleMode` and `context: ResolvedConsoleContext` (so the client renders chips from one read and never resolves names itself). |
| `PATCH /[id]?action=set-context` | New. Body `{ context: ConsoleContextRef[] }` — whole-list replace. 400 on a chat that is not in Writing Assistant mode. Returns the resolved context. |
| `POST /[id]?action=save-output` | New. Body `{ messageId, mountPointId, folderPath, filename, onConflict?: 'fail' \| 'overwrite' }`. See §8.3. |

Convert `[id]/route.ts`'s PATCH and POST to `dispatchAction` / `withActionDispatch` where they are not already; an unknown action is a 400.

A conversation picker needs a searchable list of Salon and autonomous chats with cast. Use the existing chats list endpoint and `useCharactersList`-style shared hooks; if no existing read returns title + cast + last activity filtered by a title query, add it as a query option on `GET /api/v1/chats`, not as a Brahma route.

## 7. UI

Components live in `components/brahma-console/`. Both surfaces (floating dialog and workspace tab) render `BrahmaConsolePanel`, so everything here is built once.

### 7.1 Header

`headerActions` order: **[Writing Assistant control] [ModelPicker] [past] [new]**.

- **On the launcher** (no `currentChatId`): a switch, `role="switch"`, `aria-checked`, visible label "Writing Assistant" (collapsing to an icon with `aria-label` when the header is narrow). Off every time the launcher is shown.
- **In a conversation:** the switch is replaced by a static badge "Writing Assistant" when the chat is in that mode, and by nothing otherwise. Tooltip, house voice: the mode is settled when a conversation opens.

`useBrahmaConsoleSession` gains `pendingMode` and `pendingContext` for the launcher; they are sent with `POST /` on the first message and cleared by `handleShowLauncher`.

### 7.2 Context bar

Shown beneath the header whenever Writing Assistant is on (launcher with the switch on; any Writing Assistant conversation).

- A wrapping row of chips, one per context ref, each with its kind icon, name and a remove button (`aria-label="Remove <name> from the context"`).
- Under a conversation chip, its derived character vaults as smaller, non-removable chips ("Vivienne Hale — vault"). Archived characters show the name with an archived mark.
- A missing ref renders struck through, removable.
- An **Add to context** button opens `ConsoleContextDialog` — a `BaseModal`, never a hand-built overlay — with four sections:
  - **Conversations:** title search, results showing title, cast and last activity; multi-select.
  - **Projects:** from `use-projects.ts`.
  - **Document stores:** from `use-document-stores.ts`.
  - **Quilltap General:** a single checkbox.
- With no context chosen the bar shows one line of house-voice hint and the Add button. An empty context is allowed; the mode works without one.

On the launcher, edits are local state. In a conversation, each edit PATCHes `?action=set-context` (optimistic, rollback on error) and is disabled while a reply is streaming.

Lists come from the existing shared read hooks; no second inline `queryFn` for an endpoint that already has a hook. New query keys go through `lib/query/keys.ts` (`queryKeys.brahmaConsole.detail(id)` if the detail read moves to `useQuery`; the current panel uses bare `fetch` for messages and detail — moving those two reads to TanStack Query is welcome but not required).

### 7.3 Transcript

`BrahmaConsoleMessageList`, in a Writing Assistant conversation:

- **Operator messages:** as today.
- **Thinking and tool cards:** as today.
- **Intermediate assistant prose** (assistant message with content, no marker, followed by tool activity): rendered small and muted as working notes, no copy control.
- **Output** (`systemKind: 'writing-output'`): an **output card** — rendered Markdown inside a distinct frame, with a toolbar: **Copy**, **Download**, **Save to store**, and a **Rendered / Source** toggle so the operator can see the exact Markdown that will be copied. Each output in the conversation gets its own card and toolbar.
- **Unmarked final message** (salvage, error): a notice, no toolbar.
- **While streaming:** text streams into a provisional card labelled as a draft. If a tool call follows, that text is demoted to working notes. On `done`, the card settles according to `systemKind`.

The ordinary Console's transcript is unchanged apart from attachments (Part B).

New visual treatments are `qt-*` classes in `app/styles/qt-components/` (e.g. `qt-console-output`, `qt-console-output-toolbar`, `qt-console-notes`, `qt-console-context-chip`), state forms written out by hand, then `npm run generate:storybook-css` and a patch bump of `packages/theme-storybook`. No variant-prefixed `qt-*` tokens.

### 7.4 Past conversations

Rows for Writing Assistant conversations carry a small quill mark with `aria-label`. Deleting a conversation that has attachments asks first (§11.4).

## 8. Output controls

### 8.1 Copy

Copies the stored message content verbatim (the raw Markdown), reusing the existing `CopyMarkdownButton` behaviour.

### 8.2 Download

Client-side: a `text/markdown;charset=utf-8` Blob. Filename `<slug of conversation title>.md`; a second or later output in the same conversation is `<slug>-2.md`, `<slug>-3.md` by its ordinal among outputs. Slug: lowercased, non-alphanumerics to hyphens, trimmed, capped at 80 characters, `console-output` when empty.

### 8.3 Save to store

Opens the existing `components/document-browser/DocumentDestinationDialog.tsx` (store, folder, filename; default filename as in §8.2). Extend that dialog if it lacks something; do not build a second picker.

`POST /[id]?action=save-output`:

1. `verifyBrahmaChat`; load the message; require `systemKind === 'writing-output'` and that it belongs to this chat. The **server reads the content from the stored message** — the client never sends the text.
2. Resolve the destination through the operator document layer's resolver; the path is built with `resolveInside`, never string checks. Ensure a `.md` extension.
3. Write through `lib/documents/core/` only: `ensureDocument` for a new file, `writeDocument` for an overwrite, then `afterDocumentWrite`. An existing file with `onConflict` absent or `'fail'` returns 409 with the existing path; the dialog then offers overwrite or a new name.
4. Respond with the published address (`qtap://<Store Name>/<path>`, store named, never `self`) and show a toast linking to the document.

This is an operator action, not a tool call, so the read ceiling does not apply to it. It posts no Librarian announcement (there is no Salon chat to post into).

---

## Part B — Attachments (both modes)

## 9. Storage

Attachments are documents in Quilltap General under `Brahma/`.

New module `lib/brahma-console/attachments.ts`:

```ts
export const BRAHMA_ATTACHMENT_FOLDER = 'Brahma'

/** Store uploaded bytes at Brahma/<free name> in General. Returns the mount-file link. */
export async function storeConsoleAttachment(input: { bytes: Buffer; filename: string; mimeType: string }): Promise<ConsoleAttachment>

/** Delete one attachment if its link still lives under Brahma/ in General. */
export async function discardConsoleAttachment(linkId: string): Promise<'deleted' | 'kept-moved' | 'missing'>

/** Delete every attachment of a chat's messages that still lives under Brahma/. */
export async function deleteConsoleAttachmentsForChat(repos, chatId): Promise<{ deleted: number; kept: number }>
```

Rules:

- General is resolved through `resolveOwnerStore` (`general` scope) with `ensure: true` — this is a writer.
- Bytes go in through the store-file bridge (`storeMountFile`, `lib/mount-index/store-file.ts`). Images are normalised by `linkBlobContent` as for every other blob; do not transcode at the call site. A transcode can change the extension (`photo.png` → `photo.webp`); the stored name follows the stored bytes, and the link keeps `originalFileName`.
- **Flat, de-duplicated by name:** `Brahma/<name>`, then `<stem>-2.<ext>`, `-3`, … compared case-insensitively. A pasted image with no name is `pasted-YYYYMMDD-HHMMSS.<ext>` on the instance calendar.
- Filenames are sanitised to a single path segment (no separators, no leading dots) and the final path resolved with `resolveInside`.
- Size limit: the Salon's `MAX_FILE_SIZE` (`validateChatFile`). No type restriction, as in the Salon.
- Deletion goes through `deleteDocument` (`lib/documents/core/`).
- The mount-file **link id** is the attachment's id everywhere (message `attachments[]`, the composer chips, the API). `loadChatFilesForLLM` already falls through from the legacy `files` table to `doc_mount_files` by id, so no legacy `files` row is created.
- Every path logs at `debug`; failures at `warn`/`error`.

## 10. API

| Route | Purpose |
|---|---|
| `POST /api/v1/brahma-console?action=upload` | FormData `file`. Not bound to a chat (a launcher upload happens before the chat exists). Returns `{ id, filename, mimeType, size, path, isImage }`. |
| `POST /api/v1/brahma-console?action=discard-upload` | Body `{ fileId }`. Removes an upload the operator dropped from the composer before sending. |
| `POST /[id]/messages` | Already accepts `fileIds`; now honoured (§11). Each id must resolve to a link under `Brahma/` in General, else 400. `content` may be empty when `fileIds` is non-empty. |
| `DELETE /[id]` | Calls `deleteConsoleAttachmentsForChat` before deleting the chat; the response reports how many files went. |
| `GET /[id]/messages` | Each message's attachments resolved to `{ id, filename, mimeType, isImage, path, missing }` for rendering. |

Convert the collection route's POST to `withCollectionActionDispatch` (no action → create).

Attachment bytes are displayed through the existing mount-file byte route (which already goes through `serveStoredBytes`). Do not add a byte route.

An upload abandoned without sending or discarding (window closed mid-compose) is left in `Brahma/`. That is acceptable: it is an ordinary General document the operator can see and remove in the Scriptorium. No sweeper.

## 11. Getting attachments to the model

### 11.1 Recording

`handleBrahmaConsoleMessage` saves the USER message with `attachments: options.fileIds ?? []` (today it hard-codes `[]`).

### 11.2 Loading and the transport budget

Reuse the Salon's path; do not re-derive it.

1. Load with `loadChatFilesForLLM(ids, { provider })`, tagging each attachment with `tagForTransport` — this turn's as uploads, earlier turns' as re-hydrated — exactly as the Salon's context builder does. If the Salon's attach-and-rehydrate step is embedded in `context-builder.service.ts`, extract it into a function both callers use rather than copying it.
2. Run **`applyImageTransportBudget`** (`lib/chat/image-transport-budget.ts`) on the final message array for the profile about to be called. It is the one place capability, the profile's image cap and the total byte budget are decided, and it is what turns an image the model cannot see into a description through `processFileAttachmentFallback` (the Image Description profile, cheap-first vision fallback, the Concierge's uncensored describer where the policy allows) or omits it with `IMAGE_OMITTED_NOTE`. No capability, count or byte check beside it.
3. Text files become inline text; PDFs and other documents follow the Salon's native-transport-or-extracted-text rule. Same code.
4. Because the profile is read per turn and the pass runs per call, switching to a model that cannot see images mid-conversation just works: earlier images arrive as descriptions.

Stored files are never altered by any of this.

### 11.3 Telling the model where the file is

For each attachment on the current turn, append one model-facing line to that user message (not stored in `content`):

```
[Attached: qtap://Quilltap General/Brahma/<filename>]
```

so the model can address the file with its document tools. The address is built by the URI producers (`lib/doc-edit/uri-producers.ts`) and names the store.

### 11.4 Deletion

`DELETE /[id]` → `deleteConsoleAttachmentsForChat`:

- collect link ids from every message's `attachments[]`;
- for each, delete only if the link still exists **and** its path is still directly under `Brahma/` in General; otherwise count it as kept;
- failures are logged and do not block the chat's deletion.

The client's delete control currently deletes on one click. When the conversation has attachments (the list row needs an `attachmentCount`), it first shows a `BaseModal` `role="alertdialog"` naming the number of files that will be removed with it. Conversations without attachments delete as today.

Other paths that delete chats (bulk delete, data deletion, a restore that replaces a chat) must be checked: any that can remove a `brahma` chat calls `deleteConsoleAttachmentsForChat` too. If `repos.chats.delete` is the common point and already has a pre-delete seam, put the call there instead of in the route.

### 11.5 Export, import, backup

- The files are General documents and travel with General under the existing rules; nothing new.
- Message `attachments[]` is already in `ID_FIELDS` with target `file`. Mount-link ids are already carried there by the Salon's `attach-mount-file` path; confirm the remap covers a link id in a `brahma` chat and add a regression test. A missing target keeps the id; the transcript then shows the attachment as missing.

## 12. Composer

`HelpChatComposer` is shared with the Help Chat. Add an opt-in `attachments` prop (absent → today's behaviour, Help Chat untouched):

- an attach button (icon-only, `aria-label`), a hidden multi-file input;
- paste of files and images from the clipboard;
- drag and drop onto the composer;
- a row of pending chips above the input: thumbnail for images, name, upload progress or error, remove button (which calls `discard-upload`);
- Send is disabled while any upload is in flight; a message with attachments and no text may be sent.

A new hook `components/brahma-console/hooks/useConsoleAttachments.ts` owns the pending list and the upload/discard calls (`useMutation`). `handleSend` passes `fileIds` to the existing `sendMessage(content, fileIds, chatId)` — the parameter is already there and unused.

In the transcript, an operator message shows its attachments: image thumbnails that open the standard image viewer, and name chips for other files linking to the document. A missing file shows a struck-through chip.

---

## 13. What does not change

- No memory access, no memory extraction, in either mode.
- No page awareness.
- The ordinary Console's prompt, tools and write access.
- `@Brahma` inline answers and `one-shot.service.ts`.
- The stream stays on `legacyFrameEncoder`.
- Model switching mid-conversation, in both modes.
- The turn budget setting applies to both modes.

## 14. Tests

Unit:

- `writing-context`: resolution per kind; de-duplication; archived character → no vault; missing refs reported; manifest empty-is-absent; manifest never contains `self`; manifest carries no source content.
- `system-prompt-builder`: writing brief replaces the base brief; section order; ordinary prompt byte-identical to today when the mode is off (golden).
- `writing-output`: `normalizeWritingOutput` unwraps a whole-text markdown fence, leaves a real code-block piece and interior fences alone.
- Orchestrator: Writing Assistant passes `docToolsMode: 'read'` and `effectCeiling: 'read'`; final message is marked; intermediate prose and salvage are not; a `doc_write` call under the ceiling is refused; ordinary mode unchanged.
- Agent-mode resolver: the `'writing'` kind.
- Routes: create with mode and context (validation, wrong chat type, foreign ids); `set-context` refused on an ordinary chat; `save-output` (not an output message, conflict 409, overwrite, path escape refused); `upload` / `discard-upload`; messages route rejects a `fileId` outside `Brahma/`; delete removes attachments and spares moved ones.
- `attachments`: name de-duplication, pasted naming, sanitising, `kept-moved`.
- Backup: `consoleContext` remap by kind, missing target dropped; `id-fields-guard` passes.
- Migration: columns added, idempotent.
- Components (with `renderWithQuery`): switch on the launcher only, badge in a conversation; context dialog; output card toolbar; composer attachments with the Help Chat composer unchanged when the prop is absent.

Live check in **V4test** (never Friday): one piece of each of the three motivating kinds — a custom tool's response text, a line a character would say (with their conversation as context), and the output of a terminal session — on a native-tools model and a text-block model, each followed by one refinement turn. Confirm the output has no preamble or notes. Attach an image on a vision model, then switch to a non-vision model and confirm the description path.

## 15. Documentation

- `help/brahma-console.md` — new sections for Writing Assistant (the switch, the context, the output card and its three controls) and for attachments (attach, paste, where they are kept, that they leave with the conversation). House voice. Keep the `url` frontmatter and the In-Chat Navigation `help_navigate` call in agreement.
- `docs/CHANGELOG.md` — plain voice.
- `docs/developer/DDL.md`, `docs/developer/API.md`, `public/schemas/qtap-export.schema.json`.
- CLAUDE.md glossary row for Brahma: mention the mode and `lib/brahma-console/attachments.ts`.
- The Almanack's Brahma persona text (`lib/tools/almanack/phase5-personae.ts`) if it enumerates the Console's abilities.
- Move this file to `features/complete/` when done.

## 16. Suggested order of work

1. Part B storage, routes and orchestrator loading (§9–§11), with tests.
2. Part B composer and transcript (§12).
3. Part A data model, migration, backup remap (§2).
4. Part A context resolution, prompt, orchestrator (§3–§5).
5. Part A routes and UI (§6–§8).
6. Styles, storybook CSS, help doc, changelog.
7. Live check in V4test.


---

## As built (2026-11-12)

Where the implementation differs from, or settles, the text above:

- **`curl` (§1.3).** The plugin already declares `curl: 'write'`, on purpose: a static effect map cannot tell a GET from a DELETE. It was left as it is, so `curl` is unavailable in Writing Assistant mode (the ceiling withholds it from the tool list and the executor refuses it). Web search, being a profile capability, is unaffected. Letting `curl` in would need a computed effect for plugin tools (GET/HEAD → `read`), which plugins cannot declare today.
- **The ceiling on the offer, too (§5.1).** `buildTools` receives `effectCeiling: 'read'` as well as the tool context, so write tools are not offered at all; the executor's check stays the guarantee.
- **`[Attached: …]` lines (§11.3).** Added to every operator message that carries attachments, not only the current turn's, so the history (and the prompt-cache prefix) is the same from turn to turn. Built per request; never stored.
- **Shared attachment step (§11.2).** The per-file part of the Salon's `loadAndProcessFiles` is now `prepareTurnAttachments` (`context-builder.service.ts`, with an `origin` option); the Console's `lib/services/brahma-console/turn-attachments.ts` calls it per message. `rehydrateUserAttachments` keeps its own loop.
- **Deletion seam (§11.4).** `ChatsRepository.delete`'s pre-delete read now sweeps a `brahma` chat's attachments when `syncVaults` is on (every user-facing delete path). Restore and import overwrite pass `syncVaults: false` and are left to manage stores wholesale. The `DELETE` route runs the sweep first so it can report the counts.
- **Import of message attachments (§11.5).** New-account restore remaps a Console message's link ids like any id the backup carries (regression test `restore-brahma-attachments.test.ts`). `.qtap` import keeps message attachment ids as they are, as it already does for the Salon's mount-link attachments; a re-minted General link then shows as missing.
- **Context resolution.** `ResolvedConsoleContext.stores` keeps a directly named store that is already listed through a vault or a project, flagged `listedElsewhere`, so its chip has a name; the manifest lists it once. `GET /[id]` also returns `contextRefs` (the stored order) beside the resolved `context`. A store ref naming Quilltap General resolves as General.
- **Conversation picker (§6).** `GET /api/v1/chats` gained `?q=` (case-insensitive title match); the dialog reads it with `includeAutonomous=true`.
- **Save to store (§8.3).** `DestinationPickerDialog` gained a `save` mode (starts at the store's top) and `submitBlocked`; `DocumentDestinationDialog` an optional `source`, a children slot (the filename field), `note` and `initialStoreId`. The saved address is shown on the card (as an in-app `qtap://` link) and in a success toast; toasts carry no links.
- **Header narrowness (§7.1).** The switch's label hides below 640px viewport width (still read aloud); there is no container query.
- **Migration.** `add-console-writing-assistant-fields-v1` (`addColumnIfMissing` per column, so a half-applied run finishes).
- **Modal layer.** The floating Console rides above every portal modal, so a modal it opens (context dialog, Save, delete confirmation, image viewer) would land beneath it. They take `qt-console-modal-layer` (`calc(var(--qt-floating-layer-z) + 10)`).
- **Deleting an attachment.** `discardConsoleAttachment` resolves the path with `scope: 'document_store'` and the General store's *name*. The doc resolver's `general` scope is the legacy on-disk `_general` folder, not the Quilltap General store; using it found nothing and left the file behind (caught in the live check).
- **Live check (V4test, 2026-11-12, GPT-5).** Done: launcher switch → context of a Salon chat + General (derived vault chip shown) → a line in a character's voice, with no preamble; Save to store (address names the store); a refinement turn with a pasted text attachment the model used; an ordinary-Console turn with a pasted image (vision answer correct, thumbnail shown); deleting a conversation removes its `Brahma/` file. Outstanding: a text-block (non-native-tools) model, a non-vision model's description path, and the budget-salvage notice.
