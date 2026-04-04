/**
 * Model Classes
 *
 * Pure constant data defining LLM capability tiers.
 * Each model class describes context/output limits, tags, and quality level.
 * Connection profiles can optionally reference a model class by name.
 *
 * @module llm/model-classes
 */

/**
 * A model class defines capability tiers for LLM connection profiles.
 */
export interface ModelClass {
  /** Unique identifier / display name */
  name: string
  /** Single-letter tier designation (A = smallest, D = largest) */
  tier: string
  /** Maximum context window size in tokens */
  maxContext: number
  /** Maximum output/completion size in tokens */
  maxOutput: number
  /** Capability tags for categorization and filtering */
  tags: readonly string[]
  /** Quality ranking (0 = lowest, higher = better) */
  quality: number
}

/**
 * Built-in model classes defining standard LLM capability tiers.
 *
 * - Compact (A): Small/local models with limited context
 * - Standard (B): Mid-range models suitable for general use
 * - Extended (C): Large-context models for creative and reasoning tasks
 * - Deep (D): Maximum-context models for the most demanding workloads
 */
export const MODEL_CLASSES: readonly ModelClass[] = [
  {
    name: 'Compact',
    tier: 'A',
    maxContext: 32000,
    maxOutput: 4000,
    tags: ['SMALL', 'CHEAP', 'LOCAL'],
    quality: 0,
  },
  {
    name: 'Standard',
    tier: 'B',
    maxContext: 128000,
    maxOutput: 16000,
    tags: ['BUDGET'],
    quality: 1,
  },
  {
    name: 'Extended',
    tier: 'C',
    maxContext: 200000,
    maxOutput: 128000,
    tags: ['CREATIVE', 'THINKING'],
    quality: 2,
  },
  {
    name: 'Deep',
    tier: 'D',
    maxContext: 1000000,
    maxOutput: 128000,
    tags: ['MAX'],
    quality: 3,
  },
] as const

/**
 * Valid model class names for validation
 */
export const MODEL_CLASS_NAMES: readonly string[] = MODEL_CLASSES.map(mc => mc.name)

/**
 * Look up a model class by name
 *
 * @param name The model class name (e.g., 'Compact', 'Standard')
 * @returns The matching ModelClass or undefined
 */
export function getModelClass(name: string): ModelClass | undefined {
  return MODEL_CLASSES.find(mc => mc.name === name)
}

/**
 * Check whether a string is a valid model class name
 *
 * @param name The string to validate
 * @returns true if name matches a known model class
 */
export function isValidModelClassName(name: string): boolean {
  return MODEL_CLASS_NAMES.includes(name)
}
