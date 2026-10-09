# Bug 196 — the Almanack's per-profile image spend omits wardrobe item pictures

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Low (broken diagnostic) — the image-profile table under-reports by every wardrobe picture generated |
| **Who it bites** | anyone reading the Almanack's image-profile usage to see what a profile costs |
| **Provenance** | Original to v4. Wardrobe pictures introduced a new log type (`WARDROBE_ITEM_IMAGE`) after the Almanack's image filter was written |
| **Defect site** | `lib/tools/almanack/phase6-wire-records.ts:139` (`getStatsByProfile(imageGroupBy, { type: 'IMAGE_GENERATION' })`); `lib/wardrobe/item-image-generation.ts:233,249` log `type: 'WARDROBE_ITEM_IMAGE'` |
| **Fix site** | `lib/schemas/llm-log.types.ts` (`IMAGE_SPEND_LOG_TYPES`); `lib/image-gen/image-attempt.ts` (`makeLoggedImageAttempt` accepts only those types); `lib/tools/almanack/phase6-wire-records.ts` (filters on the list); `lib/database/repositories/llm-logs.repository.ts` (`getStatsByProfile` takes one type or several) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** Decided the other way from the proposal: wardrobe pictures keep their own
`WARDROBE_ITEM_IMAGE` log type, so the LLM Inspector can still tell a garment's picture from an avatar or a
backdrop, and the Almanack counts every image type. `IMAGE_SPEND_LOG_TYPES`
(`['IMAGE_GENERATION', 'WARDROBE_ITEM_IMAGE']`, `lib/schemas/llm-log.types.ts`) is the list; the
per-image-profile roll-up filters on it (`getStatsByProfile` now takes one type or an array, rendered as
`"type" IN (…)`), and `makeLoggedImageAttempt` — the one logged attempt every image path now uses — types
its `logType` as a member of it, so a future image log type cannot be written without joining the spend.
Tests in `__tests__/unit/lib/database/llm-logs-repository.test.ts` and
`__tests__/unit/lib/image-gen/image-attempt.test.ts`.

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
