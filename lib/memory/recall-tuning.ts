/**
 * Recall tuning — the knobs the recall multiplier retuning (R1–R6) adds to the
 * ranking, resolved into one object the ranking code reads.
 *
 * Every knob defaults to the values the retuning chose
 * ({@link RECALL_TUNING_DEFAULTS} in `recall-tags.ts`, the single source), so
 * {@link DEFAULT_RECALL_TUNING} and "no tuning at all" rank identically. The
 * pre-retuning ranking is reachable as a tuning input: both gate terms 0,
 * `boostCap` 4, fresh 1.6 / 1.35, `specificAnchors` false.
 *
 * The `recall-replay` harness accepts a {@link RecallTuningInput} on its new
 * path (R7), so each constant can be tried against the probe set without a code
 * change; its saved-signals input ({@link RecallReplaySignalsSchema}) lives here
 * too, so the route can validate both without loading the replay engine. Design of record:
 * docs/developer/features/recall-multiplier-retuning.md.
 *
 * Pure + I/O-free, like `recall-tags.ts`, so it is safe in the job child.
 */

import { z } from 'zod'
import { CONTEXT_VALUES, RECALL_MULTIPLIERS, RECALL_TUNING_DEFAULTS, TEMPORAL_VALUES, type BoostGate } from './recall-tags'

export type { BoostGate } from './recall-tags'

export type RecallMultiplierKey = keyof typeof RECALL_MULTIPLIERS
export type RecallMultiplierTable = Record<RecallMultiplierKey, number>

export type AnchorOrder = 'rarest' | 'distiller'

/** The resolved tuning the ranking code reads. */
export interface ResolvedRecallTuning {
  multipliers: RecallMultiplierTable
  /** R1 — null when the gate is off. */
  boostGate: BoostGate | null
  /** R2 — cap on the product of boosts (before R1 scales it). */
  boostCap: number
  /**
   * R1 variant — the fresh-event boost applies in full whatever the gate says;
   * only the other boosts are gated. Its job is to rescue a cross-chat memory
   * the query embeds weakly, which is exactly what a relevance gate would
   * strip. The R2 cap still bounds the total.
   */
  freshBypassesGate: boolean
  /**
   * R1 variant — the time-window boost applies in full whatever the gate says.
   * Like the fresh boost, it marks a memory as being from the time the turn
   * asks about, which the query's cosine does not measure.
   */
  windowBypassesGate: boolean
  /** R4 — choose entity anchors by specificity instead of the first three. */
  specificAnchors: boolean
  /** R4 — names in fewer memories than this are not anchors (1 drops only zero-hit names). */
  anchorMinHits: number
  /**
   * R4 — order among the eligible names: `rarest` (fewest memories first) or
   * `distiller` (the distiller's own order, which leads with the turn's subject).
   */
  anchorOrder: AnchorOrder
  /**
   * R6 — fraction of the head reserved for out-of-window candidates that clear
   * the R1 gate at full strength, when the time window is a hard filter. 0 = off.
   * Inert while the gate is off (the gate defines "clears").
   */
  backgroundReserve: number
}

export const DEFAULT_RECALL_TUNING: ResolvedRecallTuning = Object.freeze({
  multipliers: Object.freeze({ ...RECALL_MULTIPLIERS }) as RecallMultiplierTable,
  ...RECALL_TUNING_DEFAULTS,
})

const multiplierOverrideShape = Object.fromEntries(
  (Object.keys(RECALL_MULTIPLIERS) as RecallMultiplierKey[]).map(key => [
    key,
    z.number().min(0).max(10).optional().describe(`Override for RECALL_MULTIPLIERS.${key}`),
  ]),
) as Record<RecallMultiplierKey, z.ZodOptional<z.ZodNumber>>

const gateConstant = z.number().min(0).max(1).nullable().optional()

/**
 * The `tuning` body field of `POST /api/v1/chats/[id]?action=recall-replay`.
 * Every field is optional; unknown keys are rejected so a typo cannot silently
 * run the baseline.
 */
export const RecallTuningInputSchema = z
  .object({
    boostGateAbs: gateConstant.describe('R1 absolute gate floor (cosine). 0 or null leaves this term out.'),
    boostGateMargin: gateConstant.describe('R1 margin below the best cosine. 0 or null leaves this term out.'),
    boostGateRamp: gateConstant.describe('R1 fade width below the gate. 0 or null makes the gate a hard step.'),
    boostCap: z.number().min(1).max(10).optional().describe('R2 cap on the product of boosts.'),
    freshBypassesGate: z.boolean().optional().describe('R1 variant: the fresh-event boost is not gated.'),
    windowBypassesGate: z.boolean().optional().describe('R1 variant: the time-window boost is not gated.'),
    multipliers: z.object(multiplierOverrideShape).strict().optional().describe('RECALL_MULTIPLIERS overrides (fresh-event values included).'),
    specificAnchors: z.boolean().optional().describe('R4: choose entity anchors by specificity.'),
    anchorMinHits: z.number().int().min(1).max(100).optional().describe('R4: names in fewer memories are not anchors.'),
    anchorOrder: z.enum(['rarest', 'distiller']).optional().describe('R4: order among eligible names.'),
    backgroundReserve: z.number().min(0).max(0.5).optional().describe('R6: fraction of the head reserved for out-of-window background.'),
  })
  .strict()

export type RecallTuningInput = z.infer<typeof RecallTuningInputSchema>

/**
 * The `signals` body field of the same action: a saved distillation, as a
 * previous replay returned it in `signals`. Passing it back skips the cheap-LLM
 * call, so every run of a turn embeds the same query.
 */
export const RecallReplaySignalsSchema = z.object({
  keywords: z.array(z.string()),
  temporal: z.enum([...TEMPORAL_VALUES] as [string, ...string[]]).optional(),
  context: z.enum([...CONTEXT_VALUES] as [string, ...string[]]).optional(),
  paraphrase: z.string().optional(),
  retrospective: z.boolean().optional(),
  timeRange: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
  entities: z.array(z.string()).optional(),
})


/**
 * A gate constant: absent → the default's value; 0 or null → "this term is off".
 */
function gateTerm(value: number | null | undefined, fallback: number | null): number | null {
  if (value === undefined) return fallback
  return typeof value === 'number' && value > 0 ? value : null
}

/**
 * Resolve a (validated) tuning input against the defaults. Absent input →
 * {@link DEFAULT_RECALL_TUNING}. The gate is on when either its absolute floor
 * or its margin is set; pass both as 0 to turn it off.
 */
export function resolveRecallTuning(input?: RecallTuningInput | null): ResolvedRecallTuning {
  if (!input) return DEFAULT_RECALL_TUNING
  const defaultGate = DEFAULT_RECALL_TUNING.boostGate
  const abs = gateTerm(input.boostGateAbs, defaultGate?.abs ?? null)
  const margin = gateTerm(input.boostGateMargin, defaultGate?.margin ?? null)
  const multipliers = { ...DEFAULT_RECALL_TUNING.multipliers }
  for (const [key, value] of Object.entries(input.multipliers ?? {})) {
    if (typeof value === 'number') multipliers[key as RecallMultiplierKey] = value
  }
  return {
    multipliers,
    boostGate: abs === null && margin === null
      ? null
      : { abs, margin, ramp: gateTerm(input.boostGateRamp, defaultGate?.ramp ?? null) ?? 0 },
    boostCap: input.boostCap ?? DEFAULT_RECALL_TUNING.boostCap,
    freshBypassesGate: input.freshBypassesGate ?? DEFAULT_RECALL_TUNING.freshBypassesGate,
    windowBypassesGate: input.windowBypassesGate ?? DEFAULT_RECALL_TUNING.windowBypassesGate,
    anchorMinHits: input.anchorMinHits ?? DEFAULT_RECALL_TUNING.anchorMinHits,
    anchorOrder: input.anchorOrder ?? DEFAULT_RECALL_TUNING.anchorOrder,
    specificAnchors: input.specificAnchors ?? DEFAULT_RECALL_TUNING.specificAnchors,
    backgroundReserve: input.backgroundReserve ?? DEFAULT_RECALL_TUNING.backgroundReserve,
  }
}

/**
 * R4 — pick up to `max` entity anchors that narrow the search: drop names of
 * participants present this turn (the participant boost already covers them,
 * and they match a large share of the corpus) and names in fewer than
 * `minHits` memories (a zero-hit name takes a slot and adds nothing; a
 * one-hit name is often a passing mention rather than the turn's subject).
 * Then order the rest — `rarest` first, or in the distiller's own order — with
 * ties keeping the distiller's order.
 */
export function selectSpecificAnchors(
  candidates: readonly { phrase: string; count: number }[],
  presentNames: readonly string[],
  max: number = 3,
  options: { minHits?: number; order?: AnchorOrder } = {},
): string[] {
  const minHits = Math.max(1, options.minHits ?? 1)
  const present = new Set(presentNames.map(n => n.trim().toLowerCase()).filter(Boolean))
  const eligible = candidates
    .map((c, index) => ({ ...c, index }))
    .filter(c => c.count >= minHits && !present.has(c.phrase.trim().toLowerCase()))
  if ((options.order ?? 'rarest') === 'rarest') {
    eligible.sort((a, b) => a.count - b.count || a.index - b.index)
  }
  return eligible.slice(0, max).map(c => c.phrase)
}

/** One-line summary of the non-default knobs, for logs and the CLI header. */
export function describeRecallTuning(tuning: ResolvedRecallTuning): string {
  const parts: string[] = []
  if (JSON.stringify(tuning.boostGate) !== JSON.stringify(DEFAULT_RECALL_TUNING.boostGate)) {
    const g = tuning.boostGate
    parts.push(g ? `gate abs=${g.abs ?? 'off'} margin=${g.margin ?? 'off'} ramp=${g.ramp}` : 'gate off')
  }
  if (tuning.boostCap !== DEFAULT_RECALL_TUNING.boostCap) parts.push(`cap=${tuning.boostCap}`)
  if (tuning.freshBypassesGate !== DEFAULT_RECALL_TUNING.freshBypassesGate) parts.push(`freshBypassesGate=${tuning.freshBypassesGate}`)
  if (tuning.windowBypassesGate !== DEFAULT_RECALL_TUNING.windowBypassesGate) parts.push(`windowBypassesGate=${tuning.windowBypassesGate}`)
  for (const key of Object.keys(tuning.multipliers) as RecallMultiplierKey[]) {
    if (tuning.multipliers[key] !== DEFAULT_RECALL_TUNING.multipliers[key]) {
      parts.push(`${key}=${tuning.multipliers[key]}`)
    }
  }
  if (
    tuning.specificAnchors !== DEFAULT_RECALL_TUNING.specificAnchors ||
    tuning.anchorMinHits !== DEFAULT_RECALL_TUNING.anchorMinHits ||
    tuning.anchorOrder !== DEFAULT_RECALL_TUNING.anchorOrder
  ) {
    parts.push(tuning.specificAnchors ? `specificAnchors(minHits=${tuning.anchorMinHits}, ${tuning.anchorOrder})` : 'specificAnchors=false')
  }
  if (tuning.backgroundReserve !== DEFAULT_RECALL_TUNING.backgroundReserve) parts.push(`backgroundReserve=${tuning.backgroundReserve}`)
  return parts.length > 0 ? parts.join(', ') : 'defaults'
}
