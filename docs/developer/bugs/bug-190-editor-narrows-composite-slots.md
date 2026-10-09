# Bug 190 — the item editor narrows a composite's slots when its parts are group-shared or archived

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | Medium — saving any field of such a composite silently rewrites its `types`, and its component chips vanish from the editor |
| **Who it bites** | anyone editing, in the wardrobe dialog, a composite whose components hang in a group store (or are archived) |
| **Provenance** | Original to v4. The editor's candidate list predates the group tier |
| **Defect site** | `components/wardrobe/wardrobe-item-editor.tsx:193-259` (candidates: the container, the project tier, Quilltap General; no group tier, no archived items), `:296-300` (`unionTypes(components)` over that list), `:418-425` (sends the result as `types`). The REST routes trust the client's `types`; only the tool handlers recompute the union server-side |
| **Fix site** | proposed: the editor's candidate list reuses the merged wearable-pool query (Phase F of the plan), and the item routes recompute a composite's `types` server-side through the shared `buildCompositeTypes` (Phase C) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

A character's "Sunday best" composite is a group-shared frock (`top`,
`bottom`) plus her own shoes (`footwear`). She opens it in the editor to fix a
typo in the description. The frock chip is missing. She saves. The composite's
`types` is now `["footwear"]`, and the frock is gone from its component list
on the next read as well (bug 187 compounds this).

## Root cause

The editor computes a composite's slot coverage client-side as the union of
its components' `types`, looked up in a candidate list it fetches itself. That
list is the container's items, the chat project's items and Quilltap
General's; the group tier is not fetched, and archived items are excluded. A
component it cannot find contributes nothing to the union and has no chip.
The PUT body carries the narrowed `types`, and the character, General and
mount-tier routes all store what they are given.

## Why it survived

The group tier is the newest; most composites are built from same-tier
parts; and the drop is only visible by inspecting `types` afterwards.

## Fix (proposed)

- The editor's candidates come from the same merged pool the rest of the
  dialog reads (`useCharacterWardrobeItems`, once it is a set of per-tier
  queries), with archived items included for resolution.
- The item routes compute a composite's `types` server-side via the shared
  `buildCompositeTypes(components, designated)` and widen, never narrow.

## How to verify

Build the composite above on V4test, edit its description, save, and read it
back: `types` must still be `["top", "bottom", "footwear"]` and both chips
must be present in the editor.
