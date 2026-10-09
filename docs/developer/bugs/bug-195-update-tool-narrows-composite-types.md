# Bug 195 — `wardrobe_update` narrows a composite's slots to the plain component union

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | Low — only composites with designated slots beyond their parts are affected (the "Naked" pattern the create tool documents) |
| **Who it bites** | a character whose model edits such a composite's component list without restating `types` |
| **Provenance** | Original to v4. Create and update were written separately and disagree |
| **Defect site** | `lib/tools/handlers/wardrobe-update-handler.ts:115-119` (`patch.types = unionTypes(comps)`, replacing); compare `lib/tools/handlers/wardrobe-create-handler.ts:238-249` (union **plus** any designated types). Also `:113-119` does not validate that the new `component_item_ids` are reachable, which create does at `:116-123` |
| **Fix site** | proposed: one `buildCompositeTypes(components, designated)` in `lib/wardrobe/item-mutations.ts` (widen, never narrow) used by create, update and the item routes |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

`wardrobe-create-tool.ts:53-56` documents a "Naked" composite: `replace: true`,
`types: [top, bottom, footwear, accessories]`, components empty or a single
"nothing" item. A later `wardrobe_update` that sets `component_item_ids` to,
say, one bracelet (accessories) without restating `types` rewrites the
composite's `types` to `["accessories"]`. Wearing it then clears one slot
instead of four.

## Root cause

Create computes `types` as the union of component types widened by whatever
`types` the caller listed. Update, when components change and `types` is not
supplied, assigns the plain union, discarding the item's existing designated
slots.

## Why it survived

Designated-extra composites are rare; the model usually restates `types`.

## Fix (proposed)

`buildCompositeTypes(components, designated = item.types)` returns the union
of the two; update passes the existing `types` as `designated`. Update also
runs the same reachability check on `component_item_ids` that create does.

## How to verify

Unit test on the update handler: a composite with `types` broader than its
parts, updated with a narrower component list and no `types`, keeps its
original `types`.
