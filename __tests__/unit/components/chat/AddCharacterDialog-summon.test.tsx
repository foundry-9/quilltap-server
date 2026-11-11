/**
 * #171: Summon from Lore opened over Add Character.
 *
 * Add Character's click-outside used to guard the Create NPC dialog but not
 * Summon from Lore, so the first mousedown inside the Summon dialog counted
 * as "outside" Add Character and closed it (unmounting Summon with it). Both
 * are BaseModals now; the shell's stack makes the later-opened Summon the
 * topmost dialog, which alone answers clicks and Escape.
 *
 * The real AddCharacterDialog and the real SummonFromLoreModal are rendered;
 * only the lazily-loaded wizard inside Summon and the heavy editors are stubbed.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import AddCharacterDialog from '@/components/chat/AddCharacterDialog'

// The Summon modal loads AIImportWizard through next/dynamic; stand in a small
// form so there is something inside the dialog to click on.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function AIImportWizardStub() {
      return (
        <div data-testid="ai-import-wizard">
          <label htmlFor="lore-text">Lore text</label>
          <textarea id="lore-text" />
        </div>
      )
    },
}))

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// Avatars need the display provider; a name is enough here.
jest.mock('@/components/ui/Avatar', () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span>{name}</span>,
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const CHARACTER = { id: 'char-1', name: 'Ada Lovelace', title: 'the analyst', npc: false }
const PROFILE = { id: 'profile-1', name: 'GPT', provider: 'openai', modelName: 'gpt-4', isDefault: true }

function routeFetch() {
  return jest.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.startsWith('/api/v1/characters')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ characters: [CHARACTER] }) } as Response)
    }
    if (url.startsWith('/api/v1/connection-profiles')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ profiles: [PROFILE] }) } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
  })
}

async function openSummonOverAddCharacter(onClose: () => void) {
  renderWithQuery(
    <AddCharacterDialog
      isOpen
      onClose={onClose}
      chatId="chat-1"
      existingCharacterIds={[]}
      onCharacterAdded={() => {}}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: /Summon from Lore/i }))
  return screen.findByRole('dialog', { name: 'Summon From Lore' })
}

describe('AddCharacterDialog with Summon from Lore open (#171)', () => {
  beforeEach(() => {
    routeFetch()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('a mousedown inside the Summon dialog does not close Add Character', async () => {
    const onClose = jest.fn()
    const summon = await openSummonOverAddCharacter(onClose)

    // Summon is portaled to the body, outside Add Character's dialog element.
    const addCharacter = screen.getByRole('dialog', { name: 'Add Character to Chat' })
    expect(addCharacter.contains(summon)).toBe(false)

    fireEvent.mouseDown(screen.getByLabelText('Lore text'))
    fireEvent.mouseDown(summon)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Summon From Lore' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Add Character to Chat' })).toBeInTheDocument()
  })

  it('Escape closes only the Summon dialog', async () => {
    const onClose = jest.fn()
    await openSummonOverAddCharacter(onClose)

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Summon From Lore' })).not.toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add Character to Chat' })).toBeInTheDocument()

    // With Summon gone, Add Character is topmost again and answers Escape.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
