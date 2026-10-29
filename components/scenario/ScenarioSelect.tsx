'use client'

/**
 * The scenario dropdown, shared by the New Chat dialog and the Salon sidebar's
 * in-chat picker. Renders the four tiers as optgroups — project, general,
 * group, character — beneath a standing "Custom…" entry and, when the surface
 * hands it `onBrowse`, a "Browse all scenarios…" entry that opens the scenario
 * browser instead of selecting anything. A pick from outside the hierarchy
 * shows in an "Elsewhere" optgroup holding exactly that one pick.
 *
 * The component is presentational: it takes already-fetched options and a
 * selection, and reports a new selection. What the surrounding surface does
 * with free text (New Chat layers notes beneath a preset; the sidebar swaps in
 * a textarea only for "Custom…") is the surface's own business.
 *
 * Archived entries only reach this component when the surface asked the server
 * for them; when they do, they're marked "(archived)" and remain selectable —
 * archiving hides an entry from the default view, it does not forbid a human
 * who has deliberately gone looking for it.
 */

import { useMemo } from 'react'
import { sortScenarios, type SortableScenario } from '@/lib/scenarios/sort'
import {
  BROWSE_SCENARIO_VALUE,
  CUSTOM_SCENARIO_VALUE,
  GENERAL_SCENARIO_PREFIX,
  GROUP_SCENARIO_PREFIX,
  PROJECT_SCENARIO_PREFIX,
  scenarioOptionLabel,
  scenarioSelectionToValue,
  scenarioValueToSelection,
  type CharacterScenario,
  type GeneralScenarioOption,
  type GroupScenarioOption,
  type ProjectScenarioOption,
  type ScenarioSelection,
} from './types'

/** Store-tier sort fields; character scenarios carry no filename, so the title stands in. */
const storeSortFields = (s: ProjectScenarioOption): SortableScenario => ({ title: s.name, filename: s.filename, path: s.path })
const characterSortFields = (s: CharacterScenario): SortableScenario => ({ title: s.title, filename: s.title, path: s.id })

export interface ScenarioSelectProps {
  id?: string
  selection: ScenarioSelection
  onChange: (selection: ScenarioSelection) => void
  projectScenarios?: ProjectScenarioOption[]
  generalScenarios?: GeneralScenarioOption[]
  groupScenarios?: GroupScenarioOption[]
  /**
   * Character scenarios, offered only when a single LLM character is in play —
   * with two characters present there is no unambiguous "the character".
   */
  characterScenarios?: CharacterScenario[] | null
  /** Marks the character scenario the character itself calls default. */
  characterDefaultScenarioId?: string | null
  /** Offer "Browse all scenarios…"; called instead of `onChange` when it is chosen. */
  onBrowse?: () => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function ScenarioSelect({
  id,
  selection,
  onChange,
  projectScenarios = [],
  generalScenarios = [],
  groupScenarios = [],
  characterScenarios = null,
  characterDefaultScenarioId = null,
  onBrowse,
  disabled = false,
  className = 'qt-select mb-2',
  'aria-label': ariaLabel,
}: ScenarioSelectProps) {
  // Every optgroup lists its entries in title order (`lib/scenarios/sort.ts`).
  // The server already sends them sorted; sorting here too keeps an entry a
  // surface appended locally (a fresh save) in its proper place.
  const sortedProjectScenarios = useMemo(() => sortScenarios(projectScenarios, storeSortFields), [projectScenarios])
  const sortedGeneralScenarios = useMemo(() => sortScenarios(generalScenarios, storeSortFields), [generalScenarios])
  const sortedCharacterScenarios = useMemo(
    () => (characterScenarios ? sortScenarios(characterScenarios, characterSortFields) : null),
    [characterScenarios],
  )

  // Group scenarios by groupId for rendering as optgroups
  const groupScenariosByGroup = useMemo(() => {
    const groups = new Map<string, { groupName: string; scenarios: GroupScenarioOption[] }>()
    for (const scenario of groupScenarios) {
      if (!groups.has(scenario.groupId)) {
        groups.set(scenario.groupId, { groupName: scenario.groupName, scenarios: [] })
      }
      groups.get(scenario.groupId)!.scenarios.push(scenario)
    }
    for (const group of groups.values()) {
      group.scenarios = sortScenarios(group.scenarios, storeSortFields)
    }
    return groups
  }, [groupScenarios])

  return (
    <select
      id={id}
      value={scenarioSelectionToValue(selection)}
      onChange={(e) => {
        // The browse entry is an action, not a selection: the controlled value
        // snaps back to the current selection on the next render.
        if (e.target.value === BROWSE_SCENARIO_VALUE) {
          onBrowse?.()
          return
        }
        onChange(scenarioValueToSelection(e.target.value, selection))
      }}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
    >
      <option value={CUSTOM_SCENARIO_VALUE}>Custom...</option>
      {onBrowse && <option value={BROWSE_SCENARIO_VALUE}>Browse all scenarios…</option>}
      {selection.kind === 'store' && (
        <optgroup label="Elsewhere">
          <option value={scenarioSelectionToValue(selection)}>{selection.label}</option>
        </optgroup>
      )}
      {sortedProjectScenarios.length > 0 && (
        <optgroup label="Project Scenarios">
          {sortedProjectScenarios.map((s) => (
            <option key={`project:${s.path}`} value={`${PROJECT_SCENARIO_PREFIX}${s.path}`}>
              {scenarioOptionLabel(s, ' (project default)')}
            </option>
          ))}
        </optgroup>
      )}
      {sortedGeneralScenarios.length > 0 && (
        <optgroup label="General Scenarios">
          {sortedGeneralScenarios.map((s) => (
            <option key={`general:${s.path}`} value={`${GENERAL_SCENARIO_PREFIX}${s.path}`}>
              {scenarioOptionLabel(s, ' (general default)')}
            </option>
          ))}
        </optgroup>
      )}
      {Array.from(groupScenariosByGroup.entries()).map(([groupId, { groupName, scenarios }]) => (
        <optgroup key={`group:${groupId}`} label={`Group Scenarios: ${groupName}`}>
          {scenarios.map((s) => (
            <option key={`group:${groupId}:${s.path}`} value={`${GROUP_SCENARIO_PREFIX}${groupId}:${s.path}`}>
              {scenarioOptionLabel(s, ' (group default)')}
            </option>
          ))}
        </optgroup>
      ))}
      {sortedCharacterScenarios && sortedCharacterScenarios.length > 0 && (
        <optgroup label="Character Scenarios">
          {sortedCharacterScenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {scenarioOptionLabel(
                { name: s.title, isDefault: characterDefaultScenarioId === s.id, archived: s.archived, description: s.description },
                ' (character default)'
              )}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
