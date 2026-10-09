# Bug 196 — the Almanack's per-profile image spend omits wardrobe item pictures

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | Low (broken diagnostic) — the image-profile table under-reports by every wardrobe picture generated |
| **Who it bites** | anyone reading the Almanack's image-profile usage to see what a profile costs |
| **Provenance** | Original to v4. Wardrobe pictures introduced a new log type (`WARDROBE_ITEM_IMAGE`) after the Almanack's image filter was written |
| **Defect site** | `lib/tools/almanack/phase6-wire-records.ts:139` (`getStatsByProfile(imageGroupBy, { type: 'IMAGE_GENERATION' })`); `lib/wardrobe/item-image-generation.ts:233,249` log `type: 'WARDROBE_ITEM_IMAGE'` |
| **Fix site** | proposed: decided once in the shared image-attempt helper (Phase E of the plan) — either wardrobe logs `IMAGE_GENERATION` with a purpose field, or the Almanack filter takes every image type |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

A profile used only for wardrobe pictures shows zero image calls in the
Almanack. A profile used for both shows only its avatar and Lantern calls.

## Root cause

The LLM log types for image work diverged (`IMAGE_GENERATION` for avatars,
story backgrounds and the images route; `WARDROBE_ITEM_IMAGE` for wardrobe),
and the one aggregation filters on the first.

## Why it survived

The number is plausible, just low.

## Fix (proposed)

When the four copies of the logged image attempt collapse into one helper,
the helper owns the log type. Prefer a single `IMAGE_GENERATION` type with a
`purpose` in the metadata, so every future image path is counted without
touching the Almanack; otherwise widen the filter to the set of image types.

## How to verify

Generate one wardrobe picture on a profile and read the Almanack: the
profile's image count must increase by one.
