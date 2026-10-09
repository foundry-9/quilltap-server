# Bug 188 — `wardrobe_archive` re-stamps the archive date on an already-archived item

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | High — the archive date is the wear ledger's and the UI's record of when a garment was retired; a model that archives twice rewrites history |
| **Who it bites** | any character whose model calls `wardrobe_archive` on an item it already archived (the tool resolves archived items by id, so nothing stops it) |
| **Provenance** | Original to v4. The idempotent rule (`archivedPatch`) was added for the four REST item routes; the tool kept calling the repository's older `archive()` |
| **Defect site** | `lib/database/repositories/wardrobe.repository.ts:328-335` (`archive` writes `archivedAt: now` unconditionally); `lib/tools/handlers/wardrobe-archive-handler.ts:85`; `lib/tools/handlers/wardrobe-handler-shared.ts:47` (`resolveWardrobeItemAcrossTiers` → `findByIdForCharacter`, which includes archived items by design) |
| **Fix site** | `lib/tools/handlers/wardrobe-archive-handler.ts` (archives through `archivedPatch`; an already-archived item is a no-op reported as `already_archived`); `WardrobeRepository.archive` / `unarchive` deleted |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** `wardrobe_archive` now stamps the item through `archivedPatch`, the same
idempotent rule the four item routes use, and writes through `repos.wardrobe.update`. When the item is
already archived nothing is written, no outfit-change effects fire, and the tool reports success with
`already_archived: true` ("was already archived; nothing changed"). `WardrobeRepository.archive` and
`unarchive`, the only non-idempotent paths, are deleted. The proposed `lib/wardrobe/archive-item.ts`
wrapper was not needed: the routes already share `applyArchiveFlag`, and the tool now calls the same
`archivedPatch`. Regression test in `wardrobe-handlers.test.ts`.

## Symptom

A character archives her winter coat on 1 September. On 9 October the model,
tidying up, calls `wardrobe_archive` on it again. The item's `archivedAt` is
now 9 October.

## Root cause

`lib/wardrobe/archived-patch.ts` is documented as "the one place" the
`archived` boolean becomes an `archivedAt` stamp, and it is idempotent:
re-archiving keeps the original date. The four item routes go through it. The
`wardrobe_archive` tool goes through `WardrobeRepository.archive`, which
predates it and always writes the current time. The tool's item lookup
includes archived items, so the second call reaches the write.

## Why it survived

The tool reports success either way, and the UI shows "archived" either way.
Only the date moves.

## Fix (as proposed at filing)

One `archiveItem(location, item)` in `lib/wardrobe/archive-item.ts` that
applies `archivedPatch` and fires the outfit-change effects when the item was
equipped. The tool and the routes both call it. `WardrobeRepository.archive`
and `unarchive` (which has no callers) are deleted.

## How to verify

Archive an item through the tool, note `archivedAt`, archive it again through
the tool: the date must not change. The existing route behaviour (idempotent)
must be unchanged.
