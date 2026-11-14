/**
 * The character page's sections on a blank character (principle 4 of the
 * unification spec: empty is a prompt, not a gap) — every field renders, so a
 * new user can see a character's whole shape — and the save model's wiring:
 * prose drafts go to the autosave engine, a toggle saves at once.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '@/__tests__/helpers/renderWithQuery'
import { AutosaveEngine } from '@/lib/autosave/autosave-engine'
import { CharacterPageContext, type CharacterPageContextValue } from '@/app/aurora/[id]/CharacterPageContext'
import { DetailsSection } from '@/app/aurora/[id]/sections/DetailsSection'
import { AbilitiesSection } from '@/app/aurora/[id]/sections/AbilitiesSection'
import { ChatDefaultsSection } from '@/app/aurora/[id]/sections/ChatDefaultsSection'
import type { Character } from '@/app/aurora/[id]/types'
import { validateCharacterDraft } from '@/app/aurora/[id]/hooks/useCharacterAutosave'

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel, placeholder }: { value: string; onChange: (v: string) => void; ariaLabel: string; placeholder?: string }) => (
    <textarea aria-label={ariaLabel} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
jest.mock('@/components/tags/tag-editor', () => ({ TagEditor: () => <div data-testid="tag-editor" /> }))
jest.mock('@/components/characters/progressions/ProgressionsSection', () => ({
  ProgressionsSection: () => <div data-testid="progressions" />,
}))
jest.mock('@/components/image-profiles/ImageProfilePicker', () => ({
  ImageProfilePicker: () => <div data-testid="image-profile-picker" />,
}))
jest.mock('@/components/settings/chat-settings/components/TimestampConfigCard', () => ({
  TimestampConfigCard: () => <div data-testid="timestamps" />,
}))
jest.mock('@/hooks/useChatSettingsQuery', () => ({
  useChatSettingsQuery: (select: (s: unknown) => unknown) => ({
    data: select({ coreWhisper: { enabled: true }, agentModeSettings: { defaultEnabled: false } }),
  }),
}))

const blank: Character = { id: 'c1', name: 'Ada', scenarios: [], systemPrompts: [], aliases: [] }

function renderSection(node: React.ReactNode, overrides: Partial<CharacterPageContextValue> = {}) {
  const engine = new AutosaveEngine({ save: jest.fn().mockResolvedValue(undefined), validate: validateCharacterDraft })
  const saveNow = jest.fn().mockResolvedValue(true)
  const value: CharacterPageContextValue = {
    characterId: 'c1',
    character: blank,
    autosave: { engine, saveNow, run: jest.fn(), patchCache: jest.fn(), flush: jest.fn() },
    readOnly: false,
    externalToken: 0,
    reload: jest.fn(),
    stats: null,
    groups: [],
    vault: null,
    profiles: [],
    userControlledCharacters: [],
    defaultPartnerId: null,
    defaultPartnerName: null,
    goToSection: jest.fn(),
    ...overrides,
  }
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CharacterPageContext.Provider value={value}>{node}</CharacterPageContext.Provider>
    </QueryClientProvider>,
  )
  return { engine, saveNow }
}

describe('character page sections on a blank character', () => {
  it('Details shows every fact and every Dossier field, empty ones with their hint', () => {
    renderSection(<DetailsSection />)
    for (const label of ['Name', 'Title', 'Pronouns', 'Birthday']) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Add alias')).toBeInTheDocument()
    expect(screen.getByTestId('tag-editor')).toBeInTheDocument()
    for (const label of ['Identity', 'Description', 'Manifesto', 'Personality', 'First Message', 'Example Dialogues']) {
      const editor = screen.getByRole('textbox', { name: new RegExp(label, 'i') })
      expect(editor).toHaveAttribute('placeholder')
      expect(editor.getAttribute('placeholder')).not.toBe('')
    }
    expect(screen.getByTestId('progressions')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vault' })).toBeInTheDocument()
    // The dead scalar System Prompt field is gone (#146).
    expect(screen.queryByRole('textbox', { name: /system prompt/i })).toBeNull()
  })

  it('a Dossier edit becomes a draft in the autosave engine, not an immediate write', () => {
    const { engine, saveNow } = renderSection(<DetailsSection />)
    const editor = screen.getByRole('textbox', { name: /Personality/i })
    fireEvent.focus(editor)
    fireEvent.change(editor, { target: { value: 'Brave' } })
    expect(engine.draftOf('personality')).toBe('Brave')
    expect(saveNow).not.toHaveBeenCalled()
  })

  it('an empty name is held back with an inline error', () => {
    const { engine } = renderSection(<DetailsSection />)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '' } })
    expect(engine.hasDraft('name')).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('must have a name')
  })

  it('Abilities shows every power, and a toggle saves at once', () => {
    const { saveNow } = renderSection(<AbilitiesSection />)
    for (const label of [
      'System transparency',
      "Aurora's Core whisper",
      'Can answer @-queries (Carina)',
      'Dresses themselves',
      'Creates outfits',
      'Manages inventory',
      'You play this character',
      'Non-player character',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    // Inherit says what it resolves to.
    expect(screen.getAllByText(/Inherit — currently/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('Can answer @-queries (Carina)'))
    expect(saveNow).toHaveBeenCalledWith({ canBeCarina: true }, expect.any(String))
  })

  it('Chat Defaults shows what the New Chat dialog pre-fills, and no default-prompt picker', () => {
    renderSection(<ChatDefaultsSection />)
    expect(screen.getByLabelText('Default connection profile')).toBeInTheDocument()
    expect(screen.getByLabelText('Default conversation partner')).toBeInTheDocument()
    expect(screen.getByTestId('image-profile-picker')).toBeInTheDocument()
    expect(screen.getByTestId('timestamps')).toBeInTheDocument()
    expect(screen.getByLabelText('Agent mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Help tools')).toBeInTheDocument()
    expect(screen.queryByText(/Default System Prompt/i)).toBeNull()
    expect(screen.queryByText(/Default Scenario/i)).toBeNull()
  })
})
