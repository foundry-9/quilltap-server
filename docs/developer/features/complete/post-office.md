# Feature Spec: The Post Office (inter-character mail)

> **Status:** Draft spec, ready to hand to Claude Code.
> **Author voice reminder:** all *user-facing* strings (tool descriptions surfaced to characters, the Salon whisper, help docs, error text a character reads) are in the house style — steampunk + Roaring 20s + Gatsby + Wodehouse + Lemony Snicket. `docs/CHANGELOG.md` stays plain. Spelling is **Quilltap**, never "Quilttap".

## 1. Summary

A mail system that lets characters send Markdown letters to one another. Letters are delivered by **Suparṇā**, a new personified feature ("Staff member"). A delivered letter lands as a Markdown file in the recipient's character vault under a root-level `Mail/` folder, with delivery metadata stored in the file's frontmatter. When the Commonplace Book next whispers to a character, the Post Office also checks that character's mailbox; any letters that have not yet been announced trigger a separate **Suparṇā** whisper that reports and reads each new letter aloud, names the sender and the date, and reminds the character how to read, delete, or reply.

Two tools are exposed to characters:

- **`send_mail`** — send a letter to another character.
- **`list_email`** — list the letters in *your own* mailbox and explain how to read each one.

Reading and deleting letters reuse the existing `doc_*` tools (`doc_read_file`, `doc_delete_file`) — the Post Office does **not** add its own read/delete tools.

### Decisions already made (do not re-litigate)

| Question | Decision |
|---|---|
| Who may send, and to whom | **Any character may send to any character.** No capability gate, no same-chat restriction. |
| Sent copies | **Recipient only.** No "Sent" folder in the sender's vault. |
| Read-state tracking | **Single `alerted` flag** in frontmatter. No separate "read" flag (we can't reliably observe `doc_read_file`). |
| When `alerted` flips | **Immediately after the Suparṇā whisper reports the letter** (account for the parent-vs-child write path — see §6.3). |
| Who authors the in-Salon alert | **Suparṇā authors her own whisper** (new `systemSender: 'suparna'`), posted right after the Commonplace Book whisper. |
| `in_reply_to` resolution scope | **Sender's own mailbox only.** The quoted document must be a file in the sender's `Mail/` folder. |
| Agent-facing message ID | **The vault file path** (e.g. `Mail/1718370000000-from-ariadne.md`), so it works directly with `doc_read_file` / `doc_delete_file`. |
| Suparṇā avatar | Charlie supplies `public/images/avatars/suparna-avatar.webp` (WebP, per the `cwebp -q 82 -m 6 -mt` convention). Code wires the path. |

## 2. Grounding: how the relevant subsystems already work

This section records what was verified in the codebase so the implementer doesn't have to re-discover it.

### 2.1 Character vaults are database-backed document stores

- A character's vault is a `DocMountPoint` row (`mountType: 'database'`, `storeType: 'character'`), provisioned idempotently by `ensureCharacterVault(character)` in `lib/mount-index/character-vault.ts`. The vault id is stored on `characters.characterDocumentMountPointId`.
- Files are addressed by **`(mountPointId, relativePath)`**. The stable per-file row is `doc_mount_file_links` (its `id` is a UUID — the internal "document id"), but **the agent-facing identifier in this feature is the `relativePath`** (see decision above).
- Underlying service helpers (in `lib/mount-index/`):
  - `ensureFolderPath(mountPointId, folderPath)` — `mkdir -p` semantics; `''` = root. (`folder-paths.ts`)
  - `writeDatabaseDocument(mountPointId, relativePath, content, expectedMtime?)` — ensures parent folders, dedups content by SHA-256, creates/updates the link. (`database-store.ts`)
  - `readDatabaseDocument(mountPointId, relativePath)` → `{ content, mtime, size }`. (`database-store.ts`)
  - `listDatabaseFiles(mountPointId, { folder })` → entries `{ relativePath, fileName, fileType, lastModified, … }`. (`database-store.ts`)
  - `deleteDatabaseDocument(mountPointId, relativePath)` — link deletion goes through the GC-aware path (`deleteWithGC`). **Note the memory of `deleteWithGC` running parent-side only** — folder/link GC must not run in the forked child.
- Frontmatter helpers in `lib/doc-edit/markdown-parser.ts`:
  - `parseFrontmatter(content)` → `{ data, bodyStartLine, bodyStartOffset }`. Body text is `content.slice(bodyStartOffset)`.
  - `serializeFrontmatter(data)` and `updateFrontmatterInContent(content, updates, replaceAll?)`.

> The mail layer should call these **service helpers directly** (not the `doc_*` tool handlers), because `send_mail` and the Commonplace hook run server-side without the tool-dispatch context. Reuse, don't reinvent: write a thin `lib/post-office/` module that wraps these.

### 2.2 The `doc_read_file` / `doc_delete_file` tools characters will use

- `doc_read_file` (`lib/tools/doc-read-file-tool.ts`) takes `{ scope, mount_point, path, offset?, limit? }`. For a character's own vault: `scope: 'document_store'`, `mount_point: '<the character's own vault>'` (the resolver already grants a character its own vault via `context.characterId`), `path: 'Mail/<file>.md'`.
- `list_email` output must spell out exactly this call for each letter so the character can read it. Confirm the precise `mount_point` token the resolver accepts for "my own vault" (see `buildReadResolutionContext` in `lib/tools/handlers/doc-edit/shared.ts`) and use that literal in the generated instructions, so the guidance we hand the character actually works.

### 2.3 The Commonplace Book whisper — the hook point

- The whisper is posted inside `buildContext()` in **`lib/chat/context-manager.ts`**, in the Commonplace Book block (≈ lines 1686–1776 at time of writing — re-locate by the `postCommonplaceWhisper` call, don't trust the line number).
- It runs **once per responding character per turn, before the character's LLM call**, *after* the Aurora "core" whisper. Ordering is deliberate (identity grounds before recall). **Suparṇā's mail whisper must come *after* the Commonplace Book whisper.**
- Available context at that point: `character.id`, `character.name`, `respondingParticipant?.id`, `chat.id`, `userId`, `getRepositories()`.
- Writers follow a pattern under `lib/services/<staff>-notifications/writer.ts` (e.g. `commonplace-notifications/writer.ts`, `carina/writer.ts`). `postCommonplaceWhisper(...)` builds a `MessageEvent` with `systemSender`, `systemKind`, `targetParticipantIds`, `role: 'ASSISTANT'`, `participantId: null`, and persists via `repos.chats.addMessage(chatId, message)`. **Mirror this for Suparṇā.**
- Targeting: multi-character chats target `respondingParticipant.id` (private whisper); single-character chats pass `null`. Mail is private — always target the responding participant when there is one.
- The Commonplace block sweeps its own stale prior whispers (snapshot semantics). Suparṇā's mail whisper is **event-like, not a snapshot** — it should *not* sweep prior mail whispers; each new-mail announcement is a distinct event.

### 2.4 `systemSender` is mirrored in five places

Adding `'suparna'` means editing **all** of these (the authoritative list is the Zod enum):

1. `lib/schemas/chat.types.ts` — the `systemSender: z.enum([...])` on `MessageEventSchema` → add `'suparna'`.
2. `public/schemas/qtap-export.schema.json` — the `systemSender.enum` array **and** its description (add the `'suparna' = …` clause).
3. `app/salon/[id]/types.ts` — the `systemSender?: '…' | null` union.
4. `app/salon/[id]/page.tsx` — add a `getMessageAvatar` branch returning `{ name: 'Suparṇā', avatarUrl: '/images/avatars/suparna-avatar.webp' }`.
5. `app/salon/[id]/components/system-message-labels.ts` — add `suparna: 'Suparṇā'` to `SENDER_DISPLAY_NAMES`, and any relevant `KIND_DISPLAY_OVERRIDES` for the mail `systemKind` (e.g. `'mail-delivery': 'mail delivery'`).

Also check the `chat_messages` SQLite column / any CHECK constraint on `systemSender` and the DDL (`docs/developer/DDL.md`) — extend if the column constrains the value set.

### 2.5 Suparṇā must NOT be opaque

There is an `opaqueContent` mechanism: when a chat has any non-user character with `systemTransparency !== true`, the context-builder swaps each Staff message's `content` → `opaqueContent ?? content` in every character's LLM context, so Staff names never leak to opaque characters. **Charlie's requirement: Suparṇā is openly visible to characters** ("she has an image in the avatars for her announcements that aren't opaque"). Therefore:

- When Suparṇā posts her whisper, set **`opaqueContent` equal to `content`** (or leave it null and confirm null falls through to `content` — verify the swap's null-handling; the schema says legacy null "falls through to `content`", so setting them equal is the safe, explicit choice).
- The point is that the character *should* see "Suparṇā delivered a letter from X" verbatim. Do not author a persona-stripped opaque variant that hides her.

## 3. Vault layout for mail

Recipient's vault, root-level folder `Mail/` (auto-created on first delivery; no error if it already exists or never existed when listing). One file per letter:

```
Mail/<epochMillis>-from-<sender-slug>.md
```

- `<epochMillis>` — delivery timestamp in ms (sortable, unique-enough; if a collision is possible, append a short random suffix).
- `<sender-slug>` — the sender character's name, slugified (lowercase, non-alphanumerics → `-`).

File contents — frontmatter (written by the delivery system) then the body:

```markdown
---
from: "Ariadne"
fromCharacterId: "f1e2…"      # sender's workspace character id
sentAt: "2026-06-14T18:22:05.123Z"   # ISO 8601
alerted: false                # flips true once Suparṇā announces it
inReplyTo: "Mail/1718300000000-from-bertie.md"   # null when not a reply
---

<the message body the sender passed, verbatim Markdown>
```

- **Frontmatter is owned by the delivery system**, not the sender. `send_mail`'s `message` parameter is *body only*; the sender never writes frontmatter (matches requirement 6).
- `alerted` is the single read-state flag (requirement 5 + decision). No `readAt`.

## 4. Tool: `send_mail`

New tool, following the **mandatory tool-definition convention** (CLAUDE.md): the Zod schema is the single source of truth; export `sendMailToolInputSchema`, derive `parameters` via `zodToOpenAISchema(...)`, make `validateSendMailInput` a one-line `safeParse(...).success`. Register it in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` and run `npx jest -u`.

**Files:** `lib/tools/send-mail-tool.ts` (definition) + `lib/tools/handlers/send-mail-handler.ts` (handler) + registration in `lib/tools/registry.ts`.

### 4.1 Input schema

```ts
export const sendMailToolInputSchema = z.object({
  character: z.string().min(1).describe(
    'The name or ID of the character you are writing to.'
  ),
  message: z.string().min(1).describe(
    'The body of your letter, as Markdown. Do not include any frontmatter — the Post Office stamps the envelope for you.'
  ),
  in_reply_to: z.string().min(1).optional().describe(
    'Optional. The message ID (the Mail/… path) of a letter in YOUR OWN mailbox you are replying to. ' +
    'When given, your letter is prefaced with a quoted copy of that letter.'
  ),
});
```

(The user-facing `description` strings should be rewritten in the house voice during implementation; the above conveys the required semantics.)

### 4.2 Handler behaviour

Context available to the handler: `userId`, `chatId`, the **sending** character (its id + name + its own vault `mountPointId`), and the sending participant id.

1. **Resolve the recipient.** Accept name *or* id. The name-resolution logic already exists inside `runCarinaQuery` (`lib/services/carina/carina.service.ts`): it loads `repos.characters.findByUserId(userId)`, lower-cases and trims, matches on `name`, and prefers the oldest match. **Reuse that exact matching** — but **drop Carina's reachability gate** (`canBeCarina` / "asker opens the line"), since mail is ungated (any character → any character). Extract a shared `resolveCharacterByNameOrId(userId, token)` helper (id match first, then the case-insensitive oldest-name match) rather than duplicating the loop. On no match → return a clear, in-voice error ("No soul by that name keeps a postbox here.") and do not throw.
2. **If `in_reply_to` is provided:**
   - It must be a `Mail/…` path resolvable **in the sender's own vault**. Read it via `readDatabaseDocument(senderVaultId, in_reply_to)`. If it isn't found in the sender's mailbox → in-voice error ("That letter isn't in your own postbox, so there's nothing to reply to."). Do not allow arbitrary document ids.
   - Parse its frontmatter for `sentAt`; parse its body via `parseFrontmatter().bodyStartOffset`.
   - Build the reply preface: a blockquote of `In reply to your email of {humanDate(sentAt)}:` followed by the **quoted original body** (each line prefixed `> `). The quoted block is **body only** — never include the original's frontmatter (requirement 2).
   - Final delivered body = preface + blank line + the sender's `message`.
   - **`humanDate`**: format `sentAt` to a readable date (in the instance's locale/timezone if available; otherwise a plain ISO date). Confirm whether the repo has a date-formatting util before adding one.
3. **Compose frontmatter** (§3): `from`, `fromCharacterId`, `sentAt = now`, `alerted: false`, `inReplyTo = in_reply_to ?? null`.
4. **Deliver into the recipient's vault:**
   - `ensureFolderPath(recipientVaultId, 'Mail')` (idempotent; auto-create).
   - `writeDatabaseDocument(recipientVaultId, 'Mail/<epochMillis>-from-<senderSlug>.md', serializeFrontmatter(fm) + body)`.
5. **Return** to the calling LLM a short in-voice success string naming the recipient (e.g. "Suparṇā has the letter in hand and is already winging it to {recipient}."). Include the delivered path so the sender could reference it if needed, but it lives in the recipient's box.
6. **Logging:** debug logs on entry/resolution/delivery per the logging convention.

> **Important — no `Sent` copy.** Per decision, do not write anything into the sender's vault. Consequence: `in_reply_to` on a *future* turn works because the sender is replying to letters *they received* (which sit in *their* `Mail/`), not to letters they sent.

## 5. Tool: `list_email`

Same tool-definition convention. **Files:** `lib/tools/list-email-tool.ts` + `lib/tools/handlers/list-email-handler.ts` + registry.

### 5.1 Input schema

No parameters (it only ever lists the caller's own mailbox). Use an empty Zod object: `z.object({})`. Still register in the snapshot test.

### 5.2 Handler behaviour

1. Resolve the **calling** character's own vault id from context. (It only works for your own mailbox — requirement 3.)
2. `listDatabaseFiles(myVaultId, { folder: 'Mail' })`. If the folder doesn't exist, return "Your postbox stands empty." with no error (requirement 4: no failure when the folder is absent).
3. For each letter, read its frontmatter (`from`, `sentAt`, `alerted`, `inReplyTo`) — batch-read the files (or read frontmatter only) and present, newest first:
   - The **message ID = the `Mail/…` path**.
   - Sender (`from`) and date (`sentAt`, humanized).
   - Whether it's already been announced (`alerted`).
   - The exact **`doc_read_file` call** to read it (see §2.2 — use the verified own-vault `mount_point` token and the file's path), and a note that it can be deleted with `doc_delete_file` or replied to with `send_mail`'s `in_reply_to` set to this path.
4. Output is a human-readable, in-voice listing (it's read by the character's LLM, so prose + the literal tool-call snippets).

## 6. The Commonplace-Book-time mail check + Suparṇā whisper

### 6.1 New writer module

Create `lib/services/suparna-notifications/writer.ts` mirroring `commonplace-notifications/writer.ts`:

- `export type SuparnaWhisperKind = 'mail-delivery';`
- `buildSuparnaMailWhisper(letters: DeliveredLetterSummary[]): string` — in-voice text that, for each new letter, names the **sender** and **when** it arrived, **reads the letter** (its body) to the character, and closes with the reminder: it can be re-read with `doc_read_file`, removed with `doc_delete_file`, or answered with `send_mail` using `in_reply_to: "<that letter's Mail/… path>"`.
- `postSuparnaMailWhisper({ chatId, targetParticipantId, content })` — builds a `MessageEvent` with:
  - `systemSender: 'suparna'`, `systemKind: 'mail-delivery'`,
  - `role: 'ASSISTANT'`, `participantId: null`,
  - `targetParticipantIds: targetParticipantId ? [targetParticipantId] : null`,
  - **`opaqueContent: content`** (so Suparṇā is non-opaque — §2.5),
  - persisted via `repos.chats.addMessage(chatId, message)`.
- Follow the Commonplace writer's try/catch + warn-only error handling: **a mail-check failure must never break the turn.**

### 6.2 The mail-check itself

Add `lib/post-office/check-mailbox.ts` (or similar):

```ts
async function collectUnalertedMail(vaultId: string): Promise<DeliveredLetterSummary[]>
```

- `listDatabaseFiles(vaultId, { folder: 'Mail' })` (empty/missing → `[]`).
- For each, read frontmatter; keep those with `alerted !== true`.
- For each kept letter, also read its body (for "read it to you").
- Return summaries `{ path, from, sentAt, body }`, newest first.

### 6.3 Wiring into `buildContext` and flipping `alerted`

In `lib/chat/context-manager.ts`, **immediately after** the Commonplace Book whisper block:

1. Resolve the responding character's own vault id (`character.characterDocumentMountPointId`; if absent, skip — no vault, no mail).
2. `collectUnalertedMail(vaultId)`.
3. If non-empty:
   - Build + post the Suparṇā whisper (`buildSuparnaMailWhisper` → `postSuparnaMailWhisper`), targeting `respondingParticipant?.id` in multi-character chats else `null`.
   - Also inject a plain LLM-context line into the trailing-context sections the way the Commonplace block injects `llmRecallText` (so the model reliably *acts* on it, not just sees a Salon bubble).
   - **Flip `alerted` → true** on each reported letter via `updateFrontmatterInContent` + `writeDatabaseDocument(vaultId, path, updated)`.

**Parent-vs-child write boundary (decided: flip immediately).** `buildContext` runs in both the parent (HTTP) and the forked background-jobs child. In the child, `getRepositories()` writes *buffer over IPC and commit parent-side after the job* — and the memory note **`deletewithgc-must-run-parent`** flags that link/folder GC can't run in the child. The `alerted` flip is a **content update to an existing file** (no link/folder deletion, no GC), so:

- Prefer routing the flip through the same repo/`writeDatabaseDocument` path used elsewhere, and **verify it is replayed correctly when buffered in the child** (write a test that runs the hook under the child's `AsyncLocalStorage` write-buffer context).
- If buffered writes to the mount-index store turn out *not* to be supported from the child (mount-index is a separate DB partition), fall back to: in the child path, post the whisper but **defer the `alerted` flip to a parent-side scheduler tick** (mirror `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`). Re-announcing once on the rare child turn is acceptable; double-writes/GC from the child are not.
- The implementer must confirm which of these holds **before** shipping, and document the chosen path in a code comment. This is the one genuinely tricky spot in the feature.

## 7. Edge cases & rules

- **Self-mail:** allowed (a character may write itself a note); falls out naturally.
- **Recipient has no vault yet:** call `ensureCharacterVault(recipient)` before delivering (it's idempotent).
- **Unknown recipient name:** in-voice failure, no throw.
- **`in_reply_to` not in sender's own mailbox:** in-voice failure, no throw.
- **Empty/whitespace body:** rejected by `.min(1)`; the handler surfaces a clean error.
- **Mail folder absent on list/check:** treat as empty, never error (requirement 4).
- **Concurrency:** two letters delivered in the same millisecond — append a short random suffix to the filename to avoid clobber.
- **Opaque characters present:** Suparṇā stays visible (§2.5). The *letter's sender name* inside her whisper is real content the recipient is meant to see.
- **No new read/delete tools** — characters use `doc_read_file` / `doc_delete_file`. `list_email` must hand them the exact calls.

## 8. Tests (per the repo's testing posture)

- **Tool-definition snapshot:** add `send_mail` and `list_email` to `lib/tools/__tests__/tool-definitions-snapshot.test.ts`; `npx jest -u`.
- **`send_mail` handler:** delivers into recipient vault with correct frontmatter; name *and* id resolution; reply preface quotes body only (never frontmatter) and uses the humanized `sentAt`; `in_reply_to` outside sender's mailbox fails; unknown recipient fails gracefully; no sender-side file written.
- **`list_email` handler:** own-mailbox only; newest-first; emits a working `doc_read_file` snippet per letter; empty/missing folder → empty, no error.
- **Mail check + whisper:** unalerted letters are reported once and then flip to `alerted`; already-alerted letters are not re-reported; whisper carries `systemSender: 'suparna'`, `opaqueContent === content`, correct targeting; **a forced read/write failure does not break `buildContext`.**
- **Child-process path:** a turn run under the forked-child write-buffer either flips `alerted` correctly via buffered replay, or defers per §6.3 — assert no double-announce across two consecutive parent turns.
- **Opaqueness:** with an opaque character in the chat, Suparṇā's content still reaches the responding character's LLM context (not persona-stripped).
- Type-check with **`npx tsc`** (not `npm run build`).

## 9. Standing-rules deliverables (don't skip — the commit skill enforces these)

- **`docs/CHANGELOG.md`** — reverse-chronological, **plain** voice: "Added the Post Office: characters can send and receive Markdown mail via `send_mail` and `list_email`; delivered by Suparṇā, stored in each character's `Mail/` vault folder, announced at memory-recall time."
- **`help/post-office.md`** — user-visible help in house voice. Needs a `url:` frontmatter field and an **"In-Chat Navigation"** section whose `help_navigate(url: "…")` matches that `url`. Cover: what the Post Office is, who Suparṇā is, the two tools, where mail lives (`Mail/` in the vault), how to read/delete/reply with `doc_*` + `in_reply_to`.
- **`docs/developer/` upkeep:** ensure this feature file is linked where features are tracked; move to `features/complete/` when shipped. Update the docs listed in `/.claude/commands/update-documentation.md` if applicable.
- **Schema/DDL:** `public/schemas/qtap-export.schema.json` (`systemSender` enum + description), and `docs/developer/DDL.md` if the `chat_messages.systemSender` column is constrained. Confirm `.qtap`/SillyTavern export & backup paths don't need the new mail files described (they're ordinary vault documents, so likely already covered — verify).
- **Avatar:** Charlie provides `public/images/avatars/suparna-avatar.webp`. The code references `/images/avatars/suparna-avatar.webp`. (Per CLAUDE.md: always WebP; if a PNG is ever produced, convert with `cwebp -q 82 -m 6 -mt` and delete the PNG.)

## 10. Suggested implementation order

1. Add `'suparna'` to the `systemSender` enum and all five mirror sites (§2.4); add the avatar branch + display name. Type-check.
2. `lib/post-office/` core: filename/frontmatter helpers, `collectUnalertedMail`, deliver helper (wrapping the mount-index service functions).
3. `send_mail` tool + handler (+ shared `resolveCharacterByNameOrId` extracted from the Carina path).
4. `list_email` tool + handler.
5. `lib/services/suparna-notifications/writer.ts`.
6. Hook into `buildContext` after the Commonplace block; resolve and test the parent-vs-child `alerted` flip (§6.3).
7. Snapshot test update (`npx jest -u`), unit tests (§8), `npx tsc`.
8. CHANGELOG, `help/post-office.md`, schema/DDL, feature-doc upkeep.
9. Drop in the real `suparna-avatar.webp`.

## 11. Open items for the implementer to confirm against live code

- Exact `mount_point` token the doc resolver accepts for "my own vault," so `list_email`'s generated `doc_read_file` instructions actually work.
- Whether the mount-index DB partition supports buffered writes from the forked child, which decides the §6.3 path.
- Whether a date-formatting/locale util already exists for `humanDate(sentAt)`.
- Whether `chat_messages.systemSender` has a CHECK constraint or enum to extend in a migration (if so, add a migration with a pretty-label entry per the migration rules).
