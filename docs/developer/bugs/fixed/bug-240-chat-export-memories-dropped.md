# Bug 240 — Memories in a chats-only export are dropped on import

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, live on `V4test` while verifying the bug 228 fix |
| **Fixed** | 2026-10-13 |
| **Severity** | Medium — every memory in the bundle is skipped with "Memory references non-existent character", although the characters exist |
| **Who it bites** | anyone importing a chats export made with **Include Memories** |
| **Provenance** | Original to v4 — `importMemories` resolved characters only through `idMaps.characters`, which holds only characters carried in the same bundle |
| **Defect site** | `lib/import/quilltap-import/import-entities.ts` (`importMemories`) |
| **Fix site** | `lib/import/quilltap-import/import-entities.ts` (`resolveMemoryCharacter`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** A memory's `characterId` and `aboutCharacterId` resolve through the
bundle's mapping first, then to the instance's own character of that id (a raw read, once per
character per import, so a broken vault still owns its rows), as wardrobe-wear import already did.
An archived character is a tombstone and is not given new rows: its memories are skipped with the
same warning. Test:
`__tests__/unit/lib/import/quilltap-import/import-memories-local-characters.test.ts`.

## Symptom

Exporting one chat (`type: "chats"`, `includeMemories: true`) and importing it back with **Create
New** reported `imported.memories: 0`, `skipped.memories: 10`, with ten warnings
`Memory references non-existent character 026d6d31-…` — Lorian, very much present.

## Root cause

A chats export carries the chat and its memories but not the characters. `idMaps.characters` is
filled only by character import, so every lookup missed.

## Why it survived

Import tests built bundles with their characters.

## Fix

As above.

## Verify

Re-import a chats-only export with memories: they land on the existing characters, re-pointed at
the copy's chat and messages.
