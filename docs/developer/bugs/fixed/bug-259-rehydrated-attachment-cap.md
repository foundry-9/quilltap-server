# Bug 259 — a later speaker silently loses an attachment over the 80,000-character re-hydration cap

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-23, reported by the operator on `Friday` (chat `772f89bf-0158-47ca-a214-41711d8437f0`) |
| **Fixed** | 2026-10-23 |
| **Severity** | Medium. Nothing is lost from disk, but a character answers without a document the operator gave it, and nothing in its prompt says the document is missing |
| **Who it bites** | anyone who attaches large text files (over ~80,000 characters together) in a multi-character chat; every character after the first to answer |
| **Provenance** | Introduced with the bug 121 fix (`e288ae2ec`, 2026-09-04), which added `REHYDRATED_ATTACHMENT_CHAR_BUDGET` to the re-hydration path only |
| **Fix site** | `lib/services/chat-message/context-builder.service.ts` (`rehydrateUserAttachments`), `help/chat-multi-character.md` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-23).** `rehydrateUserAttachments` no longer has a size cap. Every
character gets every upload it has not yet seen, whole, on its first turn after the upload,
the same as the first responder gets from `loadAndProcessFiles`. `buildContext` budgets the
result like any other message body. The "once per character" rule
(`collectUnseenUserAttachmentsForCharacter` stops at the character's own previous turn) is
unchanged and still keeps an upload from being re-sent on every turn. Test:
`rehydrateUserAttachments (bug 259)` in
`__tests__/unit/lib/services/chat-message/context-builder.service.test.ts`.

## Symptom

The operator attached two files to one message: `4.11.0.md` (35,848 bytes) and
`CHANGELOG.md` (108,266 bytes). Both are on the row (`ad40dfe7…`, `attachments` lists both
file ids). Amy answered first and discussed both. Friday answered second and saw only the
release notes. Friday's prompt (LLM logs `8edc65ad…`, `1d7505ac…`) contains
`[User attached text file: 4.11.0.md]` and then the operator's words "Here's the most recent
change log, too", with no changelog anywhere.

## Root cause

The first responder's request carries the upload's `fileIds`, and `loadAndProcessFiles`
inlines every text file with no size limit. Every later character is a new request with no
`fileIds`; since bug 121 it re-derives the uploads from history in `rehydrateUserAttachments`.
That function spent a fixed `REHYDRATED_ATTACHMENT_CHAR_BUDGET = 80_000` oldest-first and
`continue`d past any file that did not fit. The 36k release notes fit; the ~108k changelog
alone exceeded the cap and was dropped whole. The only trace was a server-log warning
(`Re-hydrated attachments exceeded the per-turn budget; some were not re-sent`,
`skippedForBudget: 1`, 2026-10-23T16:03:13Z, Friday's participant).

## Why it survived

The cap was meant to stop a novel-sized upload from swamping a turn, but the first responder
was never capped, so the two paths disagreed. The bug 121 tests covered which uploads are
collected (`collectUnseenUserAttachmentsForCharacter`), not what the re-hydration does with
them, and there was no test of a file over the cap. The model is told nothing, so it carries on
as if the file was never sent.

## The fix

Removed the constant, the budget check and the warning from `rehydrateUserAttachments`. It
still logs `charactersUsed` at debug. The operator's chosen behaviour: every character in a
multi-character chat gets every attachment on its first turn after the upload.

## How to verify

In a multi-character chat, attach a text file over 80,000 characters and let two characters
answer. The second character's `CHAT_MESSAGE` LLM log should contain
`[User attached text file: <name>]` for it, and no `exceeded the per-turn budget` warning
should appear in the server log.
