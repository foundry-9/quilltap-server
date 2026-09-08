/**
 * Character progressions — the schema.
 *
 * A **progression** is a named, bounded span of time carried by a character: a
 * start instant, an end instant, and the rules for how — and how often — its
 * state is reported back to that character at the top of a turn. A pregnancy
 * that began on 1 August and is due 1 May; a ship's cannon that takes ten
 * minutes to recharge; a fermentation that finishes in three weeks.
 *
 * ## Where they live
 *
 * Under **one reserved top-level key, `progressions`**, in the character
 * vault's `metadata.json`. That file is Pascal's one character-scoped store —
 * its snapshot is hydrated at run start, its effects commit through a single
 * whole-object replace, and its `.qtap` round trip is already done — and the
 * whole point of progressions is that Pascal's custom tools can read and
 * change them. A second file would need a second hydration path, a second
 * write path and a second export path for no gain.
 *
 * This amends the metadata spec's "no reserved keys": `progressions` is
 * reserved and its shape is validated. Every other key stays freeform.
 *
 * ## Fail-soft at the point of use
 *
 * The `metadata` parser stays shape-agnostic; nothing validates at hydration.
 * Validation happens where the data is read — `parseProgressions` drops an
 * entry that fails this schema, with a `warn` naming the character, the id and
 * the issue, and keeps the rest. A broken entry must never hollow a character
 * or fail a turn.
 *
 * CLIENT-SAFE: Zod and nothing else. No logging, no I/O, no server imports —
 * the Aurora editor and Pascal's Workbench both run this in the browser.
 */

import { z } from 'zod';

/**
 * The identifier rule for a progression id — the same shape a custom tool's
 * name takes. Pascal addresses a progression by id in a tool file written
 * before the character exists (`progress.cannon.complete`), so the id has to
 * be a stable, typeable token, decoupled from the display `name` the user is
 * free to edit.
 */
export const PROGRESSION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** The unit a report *speaks in*. It never affects computation, only phrasing. */
export const TimeIncrementSchema = z.enum(['second', 'minute', 'hour', 'day', 'week', 'month', 'year']);

export type TimeIncrement = z.infer<typeof TimeIncrementSchema>;

/**
 * The cadence grammar — a small closed set, not free text and not cron:
 *
 * - `turn` — every prompted turn.
 * - `increment` — only when the whole-unit count of `timeIncrement` has ticked
 *   over since the character last spoke (week 20 → week 21).
 * - `<n><unit>` where unit is `s`/`m`/`h`/`d`/`w` — only when the wall-clock
 *   bucket of that period has changed (`1h`: at most once per clock hour).
 */
export const REPORT_FREQUENCY_PATTERN = /^(turn|increment|[1-9]\d{0,4}[smhdw])$/;

/**
 * What happens once `endTime` has passed.
 *
 * - `keep` — the completed state keeps being reported on the same cadence
 *   ("complete; 3 days past due").
 * - `once` — the completion is reported exactly on the first turn after it
 *   happened, then the progression goes silent. It stays in the file, still
 *   readable by Pascal, until a user or a tool removes it.
 */
export const OnCompleteSchema = z.enum(['keep', 'once']);

export type OnComplete = z.infer<typeof OnCompleteSchema>;

/** A ceiling, not a design constraint — a character carrying 32 timed conditions is already an outlier. */
export const MAX_PROGRESSIONS_PER_CHARACTER = 32;

export const MAX_REPORT_TEMPLATE_LENGTH = 500;
export const MAX_PROGRESSION_NAME_LENGTH = 80;
export const MAX_PROGRESSION_DESCRIPTION_LENGTH = 500;
export const MAX_QUANTITY_UNIT_LENGTH = 16;

/**
 * An ISO-8601 instant with an offset or `Z`. Deliberately stricter than
 * `new Date(x)`, which happily takes `"2026"` and a good deal of prose: a
 * progression's whole value is that its arithmetic is deterministic, and a
 * timestamp with no zone is not an instant.
 */
export const IsoDateTimeSchema = z
  .string()
  .refine((value) => Number.isFinite(parseIsoInstant(value)), {
    message: 'must be an ISO-8601 date-time with an offset or Z (e.g. 2026-08-01T00:00:00Z)',
  });

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Parse an ISO-8601 instant to epoch milliseconds, or `NaN`. The one parser —
 * the schema's refinement and the engine's derivation share it, so "what
 * counts as a timestamp" is decided exactly once.
 */
export function parseIsoInstant(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const trimmed = value.trim();
  if (!ISO_INSTANT_PATTERN.test(trimmed)) return NaN;
  return Date.parse(trimmed);
}

/**
 * An optional scalar the span fills, so a recharge can be reported in
 * megajoules rather than only in percent. `current` is derived —
 * `total × clamp(percent) / 100` — never stored.
 */
export const ProgressionQuantitySchema = z.strictObject({
  total: z.number().finite().positive(),
  unit: z.string().min(1).max(MAX_QUANTITY_UNIT_LENGTH),
  precision: z.number().int().min(0).max(6).default(1),
});

export type ProgressionQuantity = z.infer<typeof ProgressionQuantitySchema>;

export const ProgressionSchema = z
  .strictObject({
    /** The display name. Free to change; the id is what tool files address. */
    name: z.string().min(1).max(MAX_PROGRESSION_NAME_LENGTH),
    /** Second person, in the user's own words. Rendered by `{{description}}`. */
    description: z.string().max(MAX_PROGRESSION_DESCRIPTION_LENGTH).optional(),
    startTime: IsoDateTimeSchema,
    endTime: IsoDateTimeSchema,
    timeIncrement: TimeIncrementSchema,
    /** Whether the DEFAULT report includes ", 45% complete". `{{percent}}` ignores it. */
    percentageReport: z.boolean().default(true),
    reportFrequency: z.string().regex(REPORT_FREQUENCY_PATTERN).default('turn'),
    quantity: ProgressionQuantitySchema.optional(),
    /** Overrides the in-progress wording only. Plain substitution, no logic. */
    reportTemplate: z.string().min(1).max(MAX_REPORT_TEMPLATE_LENGTH).optional(),
    onComplete: OnCompleteSchema.default('keep'),
    /**
     * Stamped by every writer Quilltap controls (the Aurora editor, Pascal's
     * applier). An entry whose `updatedAt` is later than the character's last
     * turn reports regardless of cadence — a re-armed cannon is announced
     * immediately. A hand edit through the file manager may omit it; then the
     * next report simply waits for the cadence.
     */
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .superRefine((progression, ctx) => {
    const start = parseIsoInstant(progression.startTime);
    const end = parseIsoInstant(progression.endTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'must be strictly after startTime',
      });
    }
  });

export type Progression = z.infer<typeof ProgressionSchema>;

/** The shape of the reserved `progressions` key: a record keyed by identifier. */
export const ProgressionsSchema = z
  .record(z.string().regex(PROGRESSION_ID_PATTERN), ProgressionSchema)
  .refine((record) => Object.keys(record).length <= MAX_PROGRESSIONS_PER_CHARACTER, {
    message: `a character may carry at most ${MAX_PROGRESSIONS_PER_CHARACTER} progressions`,
  });

export type Progressions = z.infer<typeof ProgressionsSchema>;

/** The reserved key itself, so no reader has to spell it. */
export const PROGRESSIONS_METADATA_KEY = 'progressions';

/**
 * Split a `"<id>.<field>"` progress key into its halves, or say why it is not
 * one. The single parser for that shape: Pascal's read schema
 * (`ProgressKeySchema`), the Workbench's condition validator, and anything
 * that follows all come through here, so the identifier rule lives in exactly
 * one place and cannot drift between them.
 *
 * The `<field>` half is checked for shape only, deliberately — which derived
 * fields exist is the engine's business, and an unknown one fails soft at run
 * time exactly as an absent metadata key does. What IS worth catching at load
 * time is a key that names no id or no field at all.
 */
export function parseProgressKey(
  key: string,
): { ok: true; id: string; field: string } | { ok: false; reason: string } {
  const dot = key.indexOf('.');
  if (dot < 0) {
    return { ok: false, reason: `"${key}" names no field — write "<progression id>.<field>", e.g. "cannon.complete"` };
  }
  const id = key.slice(0, dot);
  const field = key.slice(dot + 1);
  if (!PROGRESSION_ID_PATTERN.test(id)) {
    return {
      ok: false,
      reason: `"${id}" is not a progression id — lowercase, starting with a letter, then letters, digits, _ or - (at most 64)`,
    };
  }
  if (!/^[a-zA-Z]+$/.test(field)) {
    return { ok: false, reason: `"${field}" is not a progression field name` };
  }
  return { ok: true, id, field };
}

/**
 * The fields a Pascal effect may write, plus the `remove` pseudo-field. Kept
 * here beside the schema so the writable set and the schema can never drift.
 */
export const WRITABLE_PROGRESSION_FIELDS = [
  'name',
  'description',
  'startTime',
  'endTime',
  'timeIncrement',
  'percentageReport',
  'reportFrequency',
  'onComplete',
  'reportTemplate',
  'quantity.total',
  'quantity.unit',
  'quantity.precision',
  'remove',
] as const;

export type WritableProgressionField = (typeof WRITABLE_PROGRESSION_FIELDS)[number];

export function isWritableProgressionField(field: string): field is WritableProgressionField {
  return (WRITABLE_PROGRESSION_FIELDS as readonly string[]).includes(field);
}
