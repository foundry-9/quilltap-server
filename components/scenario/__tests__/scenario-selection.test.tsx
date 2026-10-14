/**
 * The scenario picker's shared vocabulary — selection tokens, payloads, the
 * browser's pure helpers, and the dropdown itself.
 *
 * A pick from outside the chat's hierarchy is a `store` selection: its token
 * is `store:<mountPointId>:<path>`, its payload a `scenarioRef`, and its label
 * (`Owner › Name`) rides in the selection because the token cannot carry it.
 * "Browse all scenarios…" is an action, never a selection.
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factory hoists.
 */

import React from 'react'
import { fireEvent, render, within } from '@testing-library/react'
import {
  BROWSE_SCENARIO_VALUE,
  CUSTOM_SCENARIO_VALUE,
  scenarioSelectionToPayload,
  scenarioSelectionToValue,
  scenarioValueToSelection,
  type ScenarioSelection,
} from '../types'
import { ScenarioSelect } from '../ScenarioSelect'
import {
  isInHierarchy,
  pickToSelection,
  scenarioMatchesSearch,
  type BrowserScenario,
  type BrowserSource,
} from '../ScenarioBrowserDialog'

// react-markdown is ESM-only; the browser module imports it for previews.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// --- Fixtures --------------------------------------------------------------

const STORE: ScenarioSelection = {
  kind: 'store',
  mountPointId: 'mp-9',
  path: 'Scenarios/the-attic.md',
  label: 'Farhouse › The Attic',
}

function scenario(overrides: Partial<BrowserScenario> = {}): BrowserScenario {
  return {
    path: 'Scenarios/the-attic.md',
    filename: 'the-attic.md',
    name: 'The Attic',
    isDefault: false,
    archived: false,
    excerpt: 'Dust, trunks and a single round window.',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

function source(overrides: Partial<BrowserSource> = {}): BrowserSource {
  return {
    scope: 'project',
    id: 'proj-1',
    name: 'Glasshouse',
    mountPointId: 'mp-proj-1',
    scenarios: [],
    warnings: [],
    ...overrides,
  }
}

const HIERARCHY = { projectId: 'proj-1', groupIds: ['g-1'], characterId: 'char-1' }

// --- Tokens and payloads ---------------------------------------------------

describe('scenario selection tokens', () => {
  it('round-trips a store selection, keeping its label through `current`', () => {
    const value = scenarioSelectionToValue(STORE)
    expect(value).toBe('store:mp-9:Scenarios/the-attic.md')
    expect(scenarioValueToSelection(value, STORE)).toEqual(STORE)
  })

  it('keeps colons in a store path (only the first colon splits)', () => {
    const odd: ScenarioSelection = { ...STORE, path: 'Scenarios/a:b.md', label: 'X › a:b' }
    expect(scenarioValueToSelection(scenarioSelectionToValue(odd), odd)).toEqual(odd)
  })

  it('derives a label from the path when `current` names a different selection', () => {
    expect(scenarioValueToSelection('store:mp-9:Scenarios/the-attic.md')).toEqual({
      kind: 'store',
      mountPointId: 'mp-9',
      path: 'Scenarios/the-attic.md',
      label: 'the-attic',
    })
    expect(
      scenarioValueToSelection('store:mp-9:Scenarios/the-attic.md', { ...STORE, mountPointId: 'mp-other' })
    ).toMatchObject({ label: 'the-attic' })
  })

  it('reads a malformed store token as custom', () => {
    expect(scenarioValueToSelection('store:')).toEqual({ kind: 'custom' })
    expect(scenarioValueToSelection('store::Scenarios/x.md')).toEqual({ kind: 'custom' })
  })

  it('reads the browse entry as custom — it is never a selection', () => {
    expect(scenarioValueToSelection(BROWSE_SCENARIO_VALUE)).toEqual({ kind: 'custom' })
    expect(scenarioValueToSelection(BROWSE_SCENARIO_VALUE, STORE)).toEqual({ kind: 'custom' })
  })

  it.each<ScenarioSelection>([
    { kind: 'custom' },
    { kind: 'character', scenarioId: 'sc-1' },
    { kind: 'project', path: 'Scenarios/a.md' },
    { kind: 'general', path: 'Scenarios/b.md' },
    { kind: 'group', groupId: 'g-1', path: 'Scenarios/c.md' },
  ])('round-trips the native %o', (selection) => {
    expect(scenarioValueToSelection(scenarioSelectionToValue(selection))).toEqual(selection)
  })
})

describe('scenarioSelectionToPayload', () => {
  it('maps a store selection to a scenarioRef and nothing else', () => {
    expect(scenarioSelectionToPayload(STORE)).toEqual({
      scenarioRef: { mountPointId: 'mp-9', path: 'Scenarios/the-attic.md' },
    })
  })

  it('maps each native kind to exactly its own field', () => {
    expect(scenarioSelectionToPayload({ kind: 'custom' })).toEqual({})
    expect(scenarioSelectionToPayload({ kind: 'character', scenarioId: 'sc-1' })).toEqual({ scenarioId: 'sc-1' })
    expect(scenarioSelectionToPayload({ kind: 'project', path: 'p.md' })).toEqual({ projectScenarioPath: 'p.md' })
    expect(scenarioSelectionToPayload({ kind: 'general', path: 'g.md' })).toEqual({ generalScenarioPath: 'g.md' })
    expect(scenarioSelectionToPayload({ kind: 'group', groupId: 'g-1', path: 'c.md' })).toEqual({
      groupScenarioPath: 'c.md',
      groupScenarioGroupId: 'g-1',
    })
  })
})

// --- The browser's pure helpers -------------------------------------------

describe('isInHierarchy', () => {
  it('always counts General, and owners only when they are the chat’s own', () => {
    expect(isInHierarchy({ scope: 'general', id: null }, {})).toBe(true)
    expect(isInHierarchy({ scope: 'project', id: 'proj-1' }, HIERARCHY)).toBe(true)
    expect(isInHierarchy({ scope: 'project', id: 'proj-2' }, HIERARCHY)).toBe(false)
    expect(isInHierarchy({ scope: 'group', id: 'g-1' }, HIERARCHY)).toBe(true)
    expect(isInHierarchy({ scope: 'group', id: 'g-2' }, HIERARCHY)).toBe(false)
    expect(isInHierarchy({ scope: 'character', id: 'char-1' }, HIERARCHY)).toBe(true)
    expect(isInHierarchy({ scope: 'character', id: 'char-2' }, HIERARCHY)).toBe(false)
    expect(isInHierarchy({ scope: 'project', id: null }, { projectId: null })).toBe(false)
  })
})

describe('pickToSelection', () => {
  it('snaps a General pick to its native kind', () => {
    const s = source({ scope: 'general', id: null, name: 'Quilltap General' })
    expect(pickToSelection(s, scenario(), HIERARCHY)).toEqual({ kind: 'general', path: 'Scenarios/the-attic.md' })
  })

  it("snaps a pick from the chat's own project to its native kind", () => {
    expect(pickToSelection(source(), scenario(), HIERARCHY)).toEqual({
      kind: 'project',
      path: 'Scenarios/the-attic.md',
    })
  })

  it("snaps a pick from one of the cast's groups to its native kind", () => {
    const s = source({ scope: 'group', id: 'g-1', name: 'The Company' })
    expect(pickToSelection(s, scenario(), HIERARCHY)).toEqual({
      kind: 'group',
      groupId: 'g-1',
      path: 'Scenarios/the-attic.md',
    })
  })

  it("snaps the single character's own scenario to its id", () => {
    const s = source({ scope: 'character', id: 'char-1', name: 'Alice' })
    expect(pickToSelection(s, scenario({ scenarioId: 'sc-attic' }), HIERARCHY)).toEqual({
      kind: 'character',
      scenarioId: 'sc-attic',
    })
  })

  it("makes a store pick of the character's own scenario when it carries no scenarioId", () => {
    const s = source({ scope: 'character', id: 'char-1', name: 'Alice', mountPointId: 'mp-alice' })
    expect(pickToSelection(s, scenario(), HIERARCHY)).toEqual({
      kind: 'store',
      mountPointId: 'mp-alice',
      path: 'Scenarios/the-attic.md',
      label: 'Alice › The Attic',
    })
  })

  it('makes a store selection labelled Owner › Name for anything outside the hierarchy', () => {
    const s = source({ id: 'proj-2', name: 'Farhouse', mountPointId: 'mp-far' })
    expect(pickToSelection(s, scenario(), HIERARCHY)).toEqual({
      kind: 'store',
      mountPointId: 'mp-far',
      path: 'Scenarios/the-attic.md',
      label: 'Farhouse › The Attic',
    })
    const stranger = source({ scope: 'character', id: 'char-9', name: 'Bob', mountPointId: 'mp-bob' })
    expect(pickToSelection(stranger, scenario({ scenarioId: 'sc-b' }), HIERARCHY)).toMatchObject({
      kind: 'store',
      mountPointId: 'mp-bob',
      label: 'Bob › The Attic',
    })
  })
})

describe('scenarioMatchesSearch', () => {
  const s = source({ name: 'Glasshouse' })
  const sc = scenario({ description: 'A forgotten room' })

  it('matches everything on an empty or blank query', () => {
    expect(scenarioMatchesSearch(s, sc, '')).toBe(true)
    expect(scenarioMatchesSearch(s, sc, '   ')).toBe(true)
  })

  it.each([
    ['name', 'attic'],
    ['description', 'FORGOTTEN'],
    ['excerpt', 'Round Window'],
    ['owner name', 'glasshouse'],
  ])('matches on %s, case-insensitively', (_field, query) => {
    expect(scenarioMatchesSearch(s, sc, query)).toBe(true)
  })

  it('trims the query and rejects a miss', () => {
    expect(scenarioMatchesSearch(s, sc, '  attic  ')).toBe(true)
    expect(scenarioMatchesSearch(s, sc, 'conservatory')).toBe(false)
    expect(scenarioMatchesSearch(s, scenario({ description: undefined }), 'forgotten')).toBe(false)
  })
})

// --- The dropdown ----------------------------------------------------------

describe('ScenarioSelect', () => {
  const GENERAL = [
    { path: 'Scenarios/moor.md', filename: 'moor.md', name: 'The Moor', isDefault: false, body: 'Fog.' },
  ]

  function renderSelect(props: Partial<React.ComponentProps<typeof ScenarioSelect>> = {}) {
    const onChange = jest.fn()
    const onBrowse = jest.fn()
    const view = render(
      <ScenarioSelect
        selection={{ kind: 'custom' }}
        onChange={onChange}
        onBrowse={onBrowse}
        generalScenarios={GENERAL}
        aria-label="Scenario"
        {...props}
      />
    )
    const select = view.getByLabelText('Scenario') as HTMLSelectElement
    return { onChange, onBrowse, select, view }
  }

  it('calls onBrowse, not onChange, for the browse entry', () => {
    const { onChange, onBrowse, select } = renderSelect()
    fireEvent.change(select, { target: { value: BROWSE_SCENARIO_VALUE } })
    expect(onBrowse).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports an ordinary pick through onChange', () => {
    const { onChange, onBrowse, select } = renderSelect()
    fireEvent.change(select, { target: { value: 'general:Scenarios/moor.md' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'general', path: 'Scenarios/moor.md' })
    expect(onBrowse).not.toHaveBeenCalled()
  })

  it('omits the browse entry when the surface offers no browser', () => {
    const { select } = renderSelect({ onBrowse: undefined })
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value)
    expect(values).not.toContain(BROWSE_SCENARIO_VALUE)
    expect(values[0]).toBe(CUSTOM_SCENARIO_VALUE)
  })

  it('renders the Elsewhere optgroup holding exactly the store selection', () => {
    const { select } = renderSelect({ selection: STORE })
    const elsewhere = select.querySelector('optgroup[label="Elsewhere"]') as HTMLElement
    expect(elsewhere).not.toBeNull()
    const options = within(elsewhere).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Farhouse › The Attic')
    expect(select.value).toBe('store:mp-9:Scenarios/the-attic.md')
  })

  it('has no Elsewhere optgroup for a native selection', () => {
    const { select } = renderSelect({ selection: { kind: 'general', path: 'Scenarios/moor.md' } })
    expect(select.querySelector('optgroup[label="Elsewhere"]')).toBeNull()
  })
})
