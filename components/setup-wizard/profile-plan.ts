/**
 * What the provider wizard's Save does with each part of the configuration
 * when it was opened from Settings over an existing setup (#268).
 *
 * Settings mode preloads the chat, background, embedding and image profiles it
 * found; each carries an {@link ExistingProfileRef}. Save then keeps a part the
 * operator did not change, updates the same row when only the model moved,
 * and creates a new profile only for a provider that had none — so a re-run
 * never trips the unique-name rule and never piles up duplicates. Pure.
 *
 * @module components/setup-wizard/profile-plan
 */

import { makeUniqueProfileName, normalizeProfileName } from '@/lib/llm/connection-profile-names'

/** A profile the wizard preloaded from the instance. */
export interface ExistingProfileRef {
  id: string
  name: string
  provider: string
  model: string
}

/** The provider and model a wizard part is set to now. */
export interface DesiredProfile {
  provider: string
  model: string
}

export type ProfileWritePlan =
  | { kind: 'keep'; id: string }
  | { kind: 'update'; id: string; name: string }
  | { kind: 'create'; name: string }

/**
 * Decide one part's write.
 *
 * - Same provider and model as the preloaded row: keep it.
 * - Same provider, new model: update that row. Its name follows the model only
 *   when it is still the wizard's own name for the old model; a name the
 *   operator chose is left alone.
 * - Anything else: create, under a name not already taken.
 *
 * `takenNames` is every existing name of this profile kind.
 */
export function planProfileWrite(
  existing: ExistingProfileRef | undefined,
  desired: DesiredProfile,
  autoName: (d: DesiredProfile) => string,
  takenNames: readonly string[],
): ProfileWritePlan {
  if (existing && existing.provider === desired.provider) {
    if (existing.model === desired.model) return { kind: 'keep', id: existing.id }
    const wasAutoNamed =
      normalizeProfileName(existing.name) ===
      normalizeProfileName(autoName({ provider: existing.provider, model: existing.model }))
    if (!wasAutoNamed) return { kind: 'update', id: existing.id, name: existing.name }
    const others = takenNames.filter((n) => normalizeProfileName(n) !== normalizeProfileName(existing.name))
    return { kind: 'update', id: existing.id, name: uniqueName(autoName(desired), others) }
  }
  return { kind: 'create', name: uniqueName(autoName(desired), takenNames) }
}

function uniqueName(desired: string, takenNames: readonly string[]): string {
  return makeUniqueProfileName(desired, new Set(takenNames.map(normalizeProfileName)))
}
