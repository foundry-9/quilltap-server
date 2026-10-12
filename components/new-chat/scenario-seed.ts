/**
 * The New Chat dialog's default scenario, chosen once from the defaults on
 * offer — in the order the server has always applied them:
 *
 *   character default > project default > general default > Custom
 *
 * (Group defaults are not seeded.) A selection the user has picked by hand is
 * never re-seeded: `scenarioTouched` pins it until the form is reset.
 *
 * @module components/new-chat/scenario-seed
 */

import type { ScenarioSelection } from '@/components/scenario/types'

export interface ScenarioDefaults {
  /** The single LLM character's `defaultScenarioId`, when one is cast. */
  characterDefaultScenarioId?: string | null
  /** The project's default scenario path. */
  projectDefaultPath?: string | null
  /** Quilltap General's default scenario path. */
  generalDefaultPath?: string | null
}

/** The seeded selection for a set of defaults. */
export function defaultScenarioSelection(defaults: ScenarioDefaults): ScenarioSelection {
  if (defaults.characterDefaultScenarioId) {
    return { kind: 'character', scenarioId: defaults.characterDefaultScenarioId }
  }
  if (defaults.projectDefaultPath) return { kind: 'project', path: defaults.projectDefaultPath }
  if (defaults.generalDefaultPath) return { kind: 'general', path: defaults.generalDefaultPath }
  return { kind: 'custom' }
}

/** Re-seed unless the user has touched the picker. */
export function seedScenarioSelection(
  prev: { scenarioSelection: ScenarioSelection; scenarioTouched: boolean },
  defaults: ScenarioDefaults,
): ScenarioSelection {
  return prev.scenarioTouched ? prev.scenarioSelection : defaultScenarioSelection(defaults)
}
