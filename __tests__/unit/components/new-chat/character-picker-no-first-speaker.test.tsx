/**
 * The new-chat picker marked the first selected character "Speaks First",
 * but a chat's opening line is drawn by talkativeness (the opening turn's
 * participant resolver), not by list order — a two-character chat opened with
 * the second character's line (fresh-instance dogfood, 4.14.1). The picker
 * makes no promise about who speaks first.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { CharacterPickerPanel } from '@/components/new-chat/CharacterPickerPanel'
import type { Character, SelectedCharacter } from '@/components/new-chat/types'

const margit: Character = { id: 'c1', name: 'Margit Varnay', controlledBy: 'llm' }
const tobias: Character = { id: 'c2', name: 'Tobias Fenwick', controlledBy: 'llm' }
const selected: SelectedCharacter[] = [
  { character: margit, connectionProfileId: 'p1', controlledBy: 'llm' },
  { character: tobias, connectionProfileId: 'p1', controlledBy: 'llm' },
]

jest.mock('@/components/new-chat/NewChatFormContext', () => ({
  useNewChatForm: () => ({
    characters: [margit, tobias],
    profiles: [{ id: 'p1', name: 'Profile', provider: 'ANTHROPIC', modelName: 'claude-haiku-5-5' }],
    selectedCharacters: selected,
    setSelectedCharacters: jest.fn(),
    handleCastChanged: jest.fn(),
    creating: false,
  }),
}))
jest.mock('@/hooks/useAvatarDisplay', () => ({ useAvatarDisplay: () => ({ style: 'CIRCULAR' }) }))
jest.mock('@/components/ui/icon', () => ({ Icon: () => null }))
jest.mock('@/components/ui/ProviderModelBadge', () => ({ ProviderModelBadge: () => null }))
jest.mock('@/components/subprompts', () => ({ SubpromptPicker: () => null }))

describe('CharacterPickerPanel', () => {
  it('lists the selected cast without marking anyone to speak first', () => {
    render(<CharacterPickerPanel />)
    expect(screen.getAllByText('Margit Varnay').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tobias Fenwick').length).toBeGreaterThan(0)
    expect(screen.queryByText(/speaks first/i)).toBeNull()
  })
})
