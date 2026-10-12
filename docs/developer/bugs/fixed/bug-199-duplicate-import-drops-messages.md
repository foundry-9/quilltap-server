# Bug 199 — Importing a chat with "Create New" drops every message

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, live on `V4test`: one chat exported (`POST /api/v1/system/tools?action=export`, `{type:"chats",scope:"selected",selectedIds:[id]}`) and re-imported (`?action=import-execute`, `conflictStrategy: "duplicate"`) reported `imported.chats: 1`, `messages: 0`, and 11 `UNIQUE constraint failed: chat_messages.id` warnings |
| **Fixed** | 2026-10-12, v4.10-dev |
| **Severity** | High — the copy lands as an empty chat; the import reports success with one warning per lost message |
| **Who it bites** | anyone who imports a `.qtap` chat with **Create New** while the original is still present, and anyone who imports the same bundle twice with the default strategy (no `preserveIds`) |
| **Provenance** | Original to v4 — the duplicate branch of `importChats` reused the bundle's message ids from the start |
| **Defect site** | `lib/import/quilltap-import/import-entities.ts` (`importChats`, both the `duplicate` branch and the fresh-id insert path) |
| **Fix site** | `lib/import/quilltap-import/message-id-remap.ts` (new), `import-entities.ts`, `types.ts` (`IdMappingState.messages`), `execute.ts`, `reconcile.ts` (`remapChatInform`), `import-files.ts` (`remapLinkedTo`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** A chat created under a fresh id now gets fresh message ids, minted by
`remintChatMessageIds` (`lib/import/quilltap-import/message-id-remap.ts`), and every reference to a
message follows through one per-chat old → new map: `swipeGroupId`, `summaryAnchorMessageIds`,
`otherExtractionWatermarkMessageId`, `courierCheckpoints[*].lastResolvedMessageId` inside the chat,
and — through the new `idMaps.messages` — inform `recordMessageId` / `consumedByMessageId`,
annotation `sourceMessageId`, memory `sourceMessageId` and file `linkedTo`. A `preserveIds` import
keeps its source ids, as before. Test:
`__tests__/unit/lib/import/quilltap-import/duplicate-chat-message-ids.test.ts`.

## Symptom

On `V4test`, a single-chat export re-imported with `conflictStrategy: "duplicate"` produced a chat
titled "… (imported)" with no messages. The result said `imported.chats: 1`, `messages: 0`, and
carried 11 warnings, one per message: `Failed to import message in chat "…": UNIQUE constraint
failed: chat_messages.id`.

## Root cause

`importChats` (`lib/import/quilltap-import/import-entities.ts`, the `duplicate` branch, formerly
around lines 345–370) created the copy under a new chat id and then called
`repos.chats.addMessage(newChat.id, message)` with each message exactly as the bundle carried it,
original `id` included. `chat_messages.id` is the table's primary key — global, not per chat — and
the original chat and its messages were still there, so every insert hit the unique constraint and
was swallowed into a warning.

The fresh-id insert path below it (any import without `preserveIds`, which is the default) did the
same thing. It only escapes when the source messages are absent from this instance; import the same
bundle twice and the first copy holds the ids, so the second copy lands empty.

A second defect rode in the same branch: it recorded `idMaps.chats.set(chat.id, randomUUID())` and
then let `chats.create` mint a *different* id. Every sidecar remapped through `idMaps.chats` —
informs, annotations, chat documents, memories, file links — pointed at a chat that did not exist.
It now records the id the created chat actually has.

## Why it survived

Every import test stubbed `addMessage` as a resolved no-op, so no test enforced message-id
uniqueness, and the import reports success whatever its warnings say. The common real-world path is
a bundle moving to a different instance, where the ids are free.

## Fix

Only a chat that keeps its source id keeps its message ids. Anywhere `importChats` creates the chat
under a fresh id (the `duplicate` branch, and the non-`preserveIds` insert), it calls
`remintChatMessageIds` before `chats.create`:

- every message gets a new id;
- `swipeGroupId` of the form `swipe-<messageId>` (what regenerate-swipe writes) or a bare message id
  is rewritten; an opaque key such as SillyTavern's `swipe-<index>` is kept, since group keys are only
  compared within one chat;
- `summaryAnchorMessageIds` is mapped, dropping anchors that name no message in the bundle;
- `otherExtractionWatermarkMessageId` is mapped or nulled (the next fold-grain pass catches up);
- `courierCheckpoints` entries are mapped, and dropped when their message is gone (the next Courier
  turn sends full context).

The map is recorded in `idMaps.messages`, which the sidecar importers read: `remapChatInform` maps
both message pointers before checking them against the destination chat, conversation annotations
and memories map `sourceMessageId`, and `remapLinkedTo` keeps a reminted message id in a file's
`linkedTo`. Each chat's message import logs at debug (count, whether ids were reminted, how many
references were dropped), and each failed message insert logs a warning.

## Verify

Export one chat from Tools → Export (selected chats), then import the file with **Create New**. The
import reports the chat's full message count and no warnings, and the "… (imported)" chat shows the
whole transcript, swipes included, beside the untouched original. Import the same file a second time
with the default strategy: both copies have every message.
