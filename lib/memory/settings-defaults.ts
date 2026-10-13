/**
 * Every memory setting's default, in one client-safe module.
 *
 * The values come from the Zod schemas' `.default()`s (`lib/schemas/settings.types.ts`)
 * — this module only parses them once — plus the admission thresholds, which
 * are not user-settable and live here so there is one place to read them.
 * Imports nothing but schemas, so the settings cards can import it directly.
 *
 * @module memory/settings-defaults
 */

import {
  MemoryConsolidationSettingsSchema,
  MemoryExtractionLimitsSchema,
  MemoryExtractionModeSettingsSchema,
  MemoryMaintenanceSettingsSchema,
  MemoryRecallSettingsSchema,
  MEMORY_MAINTENANCE_CAP_MIN,
  MEMORY_MAINTENANCE_CAP_MAX,
} from '@/lib/schemas/settings.types'
import type { MemoryConsolidationSettings } from '@/lib/schemas/settings.types'
import { MAX_REINFORCEMENT_FOOTNOTES } from './reinforcement-footnotes'

/** Admission's cut-offs: the cosine bands plus the date guard and footnote cap. */
export interface AdmissionThresholds {
  /** At or above: the candidate is absorbed as a near-duplicate. */
  readonly nearDuplicate: number
  /** At or above: the candidate reinforces the existing row. */
  readonly reinforce: number
  /** At or above (and under `reinforce`): the candidate is linked to the row. */
  readonly related: number
  /** Two rows more than this many days apart are different occasions. */
  readonly dateGuardDays: number
  readonly footnoteCap: number
}

/**
 * Admission thresholds for neural embeddings: the cosines at which a
 * candidate is absorbed as a near-duplicate, reinforces an existing row, or is
 * linked to it, plus the date guard (two rows more than this many days apart
 * are different occasions) and the footnote cap.
 */
export const ADMISSION_THRESHOLDS: AdmissionThresholds = Object.freeze({
  nearDuplicate: 0.90,
  reinforce: 0.85,
  related: 0.70,
  dateGuardDays: 7,
  footnoteCap: MAX_REINFORCEMENT_FOOTNOTES,
})

/**
 * Admission thresholds for the Built-in (TF-IDF) profile. A bag of stemmed
 * words scores a restatement of one fact ~0.4–0.6 and different facts about
 * one subject ≤0.1, where a neural model gives 0.85+ and ~0.5; only
 * near-verbatim text reaches 0.8. Calibrated offline on the plugin's own
 * vectorizer (builtin-tfidf-memory-tuning §1, §3). The date guard and
 * footnote cap are shared.
 */
export const ADMISSION_THRESHOLDS_TFIDF: AdmissionThresholds = Object.freeze({
  ...ADMISSION_THRESHOLDS,
  nearDuplicate: 0.80,
  reinforce: 0.40,
  related: 0.20,
})

/**
 * The thresholds for vectors made by `provider` (`BUILTIN` is TF-IDF). An
 * unknown or missing provider reads as neural.
 */
export function admissionThresholdsForProvider(provider: string | null | undefined): AdmissionThresholds {
  return provider === 'BUILTIN' ? ADMISSION_THRESHOLDS_TFIDF : ADMISSION_THRESHOLDS
}

/**
 * The cosine at which consolidation joins two memories, for vectors made by
 * `provider`: `tfidfClusterThreshold` for the Built-in (TF-IDF) profile,
 * `clusterThreshold` otherwise. An explicit per-run `override` (the API's
 * dry-run knob) wins on either provider.
 */
export function resolveClusterThreshold(
  settings: Pick<MemoryConsolidationSettings, 'clusterThreshold' | 'tfidfClusterThreshold'>,
  provider: string | null | undefined,
  override?: number,
): number {
  if (typeof override === 'number') return override
  return provider === 'BUILTIN' ? settings.tfidfClusterThreshold : settings.clusterThreshold
}

/** The default value of every memory setting. */
export const MEMORY_SETTING_DEFAULTS = Object.freeze({
  maintenance: MemoryMaintenanceSettingsSchema.parse({}),
  consolidation: MemoryConsolidationSettingsSchema.parse({}),
  recall: MemoryRecallSettingsSchema.parse({}),
  extractionMode: MemoryExtractionModeSettingsSchema.parse({}),
  extractionLimits: MemoryExtractionLimitsSchema.parse({}),
  admission: ADMISSION_THRESHOLDS,
  admissionTfidf: ADMISSION_THRESHOLDS_TFIDF,
})

/** The bounds every per-character cap is validated against (schema, API and card alike). */
export const MEMORY_CAP_BOUNDS = Object.freeze({ min: MEMORY_MAINTENANCE_CAP_MIN, max: MEMORY_MAINTENANCE_CAP_MAX })
