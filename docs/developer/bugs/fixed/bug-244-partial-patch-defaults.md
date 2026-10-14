# Bug 244 — A one-field settings write resets every other field to its default

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, by code reading during memory refactor Phase G (moving the `*-config` actions onto the façade's schemas), confirmed by parsing the schemas directly |
| **Fixed** | 2026-10-13 |
| **Severity** | Medium — a saved setting silently undoes the operator's other settings: switching Consolidation on clears its connection profile, thresholds, sizes, watermark and archive retention; any edit on the Extraction Grain card resets the other two grain knobs; toggling one maintenance phase re-enables the others; a text-replacement PATCH resets `caseSensitive`, `enabled` and `sortOrder` |
| **Who it bites** | anyone saving the Consolidation or Extraction Grain cards (each sends one field per save), a `maintain` run whose `settings.consolidation` names one knob (the run then carries every other knob at its default, `enabled: false` included), and any partial text-replacement PATCH |
| **Provenance** | Original to v4. The schemas' `.partial()` predates the move to Zod 4 (`d585480`, consolidation; the text-replacement patch schema); Zod 4's `.partial()` keeps each field's `.default()`, where Zod 3's dropped it on `undefined` input |
| **Defect site** | `app/api/v1/memories/route.ts` — `consolidationConfigSchema = MemoryConsolidationSettingsSchema.partial()`, `extractionModeConfigSchema = MemoryExtractionModeSettingsSchema.partial()`, `maintainSchema.settings.consolidation`, `maintenanceConfigSchema.phases`; `lib/schemas/text-replacement.types.ts` — `TextReplacementRulePatchSchema = TextReplacementRuleInputSchema.partial()` |
| **Fix site** | `lib/schemas/patch-schema.ts` (`patchSchemaOf`: strip `.default()` / `.prefault()`, then make each key optional); the five sites above, plus `extraction-limits-config` and `recall-config`, which now validate through the façade's schemas the same way |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** Every partial write schema is now `patchSchemaOf(Schema)`, which
removes each field's default before making it optional, so a key the caller did not send stays
absent and the stored value survives the merge. Bounds, enums, nullability and field refinements
are kept. Test: `lib/schemas/__tests__/patch-schema.test.ts` (pins that `.partial()` *does* fill
defaults, so the trap stays visible, and that the patch schemas do not).

## Symptom

`POST /api/v1/memories?action=consolidation-config` with `{ "enabled": true }` answered 200 with
consolidation switched on — and `connectionProfileId: null`, `clusterThreshold: 0.72`,
`coldRetentionDays: null` and every other field back at its default, whatever had been stored. The
Consolidation card saves one field per change, so the operator saw their profile choice vanish the
moment they ticked the master switch, or their retention window cleared when they changed the
watermark.

## Root cause

In Zod 4, `z.object({ a: z.boolean().default(false) }).partial().parse({})` returns
`{ a: false }`: `.partial()` wraps each field in `ZodOptional`, but the inner `ZodDefault` still
fills `undefined`. The route then dropped only `undefined` keys before merging the patch over the
stored settings, so every defaulted key was written. The same shape served `extraction-mode-config`,
`maintain`'s run overrides (a dry run with one threshold override ran with `enabled: false`,
`maxClustersPerRun: 40` and the other knobs at default) and the maintenance phase toggles (merged
over the stored toggles, re-enabling the ones not sent), and the text-replacement PATCH.

## Why it survived

The tests posted whole objects or checked only the field they sent, and a reset to default looks
like a plausible stored value.

## Verify

`npx jest lib/schemas/__tests__/patch-schema.test.ts`. Live: on the Commonplace Book tab, choose a
consolidation profile, then tick the master switch; reload — the profile is still chosen.
