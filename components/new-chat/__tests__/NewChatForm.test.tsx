/**
 * NewChatForm scenario-layering tests
 *
 * Covers the "layer free text onto a chosen scenario" change:
 * - The free-text editor is now ALWAYS shown (even when a preset is selected).
 * - Selecting a preset preset shows the read-only preview plus the editor and a
 *   "added beneath the scenario above" hint.
 * - Selecting a preset no longer clears the typed free text (`scenario`).
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factories hoist
 * cleanly. Heavy child components are stubbed; MarkdownLexicalEditor is replaced
 * with a plain textarea that surfaces its aria-label.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { NewChatForm } from '../NewChatForm'
import type { NewChatFormState, GeneralScenarioOption } from '../types'

// --- Stub heavy / irrelevant children -------------------------------------

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@/components/ui/icon', () => ({
  Icon: () => null,
}))

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string
    onChange: (v: string) => void
    ariaLabel?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

jest.mock('@/components/image-profiles/ImageProfilePicker', () => ({
  ImageProfilePicker: () => null,
}))

jest.mock('@/components/settings/chat-settings/components/TimestampConfigCard', () => ({
  TimestampConfigCard: () => null,
}))

jest.mock('@/components/wardrobe', () => ({
  OutfitSelector: () => null,
}))

jest.mock('@/components/new-chat/AutonomousRoomCard', () => ({
  AutonomousRoomCard: () => null,
}))

jest.mock('@/hooks/usePersonaDisplayName', () => ({
  useUserCharacterDisplayName: () => ({ formatCharacterName: (name: string) => name }),
}))

// --- Fixtures --------------------------------------------------------------

function makeState(overrides: Partial<NewChatFormState> = {}): NewChatFormState {
  return {
    selectedUserCharacterId: '',
    imageProfileId: '',
    scenario: '',
    scenarioId: null,
    projectScenarioPath: null,
    generalScenarioPath: null,
    groupScenarioPath: null,
    groupScenarioGroupId: null,
    timestampConfig: null,
    avatarGenerationEnabled: false,
    outfitSelections: [],
    autonomous: {
      enabled: false,
      scheduleCron: '',
      scheduleFreshnessHours: null,
      budgetMaxTurns: null,
      budgetMaxTokens: null,
      budgetMaxWallClockMinutes: null,
      budgetEstimatedSpendCapUSD: null,
      runVisibility: null,
      runDestructiveToolsAllowed: false,
      budgetExcludeCacheHits: true,
    },
    ...overrides,
  }
}

const GENERAL_SCENARIO: GeneralScenarioOption = {
  path: 'Scenarios/foggy-moor.md',
  filename: 'foggy-moor.md',
  name: 'Foggy Moor',
  isDefault: false,
  body: 'A foggy moor at dawn.',
}

function renderForm(stateOverrides: Partial<NewChatFormState> = {}, props: Record<string, unknown> = {}) {
  const setState = jest.fn()
  render(
    <NewChatForm
      profiles={[]}
      imageProfiles={[]}
      userControlledCharacters={[]}
      selectedCharacters={[]}
      setSelectedCharacters={jest.fn()}
      state={makeState(stateOverrides)}
      setState={setState}
      project={null}
      creating={false}
      {...props}
    />
  )
  return { setState }
}

// --- Tests -----------------------------------------------------------------

describe('NewChatForm scenario layering', () => {
  it('shows the "Starting scenario" editor when no preset is selected', () => {
    renderForm()
    expect(screen.getByLabelText('Starting scenario')).toBeInTheDocument()
    expect(screen.queryByLabelText('Additional scenario notes')).not.toBeInTheDocument()
  })

  it('shows the preset preview, append hint, and editor when a preset is selected', () => {
    renderForm(
      { generalScenarioPath: GENERAL_SCENARIO.path },
      { generalScenarios: [GENERAL_SCENARIO] }
    )
    // Read-only preview of the chosen scenario body
    expect(screen.getByText('A foggy moor at dawn.')).toBeInTheDocument()
    // The append hint
    expect(screen.getByText(/added beneath the scenario above/i)).toBeInTheDocument()
    // The editor is still present, relabelled
    expect(screen.getByLabelText('Additional scenario notes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Starting scenario')).not.toBeInTheDocument()
  })

  it('does NOT clear typed free text when a preset is selected from the dropdown', () => {
    const { setState } = renderForm(
      { scenario: 'typed notes' },
      { generalScenarios: [GENERAL_SCENARIO] }
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: `general:${GENERAL_SCENARIO.path}` } })

    // handleScenarioSelectChange calls setState with a functional updater.
    expect(setState).toHaveBeenCalledTimes(1)
    const updater = setState.mock.calls[0][0] as (prev: NewChatFormState) => NewChatFormState
    const next = updater(makeState({ scenario: 'typed notes' }))

    // The preset is set, but the free text survives (no `scenario: ''` reset).
    expect(next.generalScenarioPath).toBe(GENERAL_SCENARIO.path)
    expect(next.scenario).toBe('typed notes')
  })
})
