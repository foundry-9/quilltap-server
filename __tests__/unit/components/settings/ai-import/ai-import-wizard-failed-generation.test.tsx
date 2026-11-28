/**
 * #253 — after a failed generation, step 3 showed the error with no way
 * back and no retry; closing the dialog was the only exit.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import AIImportWizard from '@/components/settings/ai-import/AIImportWizard'
import { useAIImport } from '@/components/settings/ai-import/hooks/useAIImport'

jest.mock('@/components/settings/ai-import/hooks/useAIImport', () => ({ useAIImport: jest.fn() }))

const mockedUseAIImport = useAIImport as jest.Mock

const STEPS = Object.fromEntries(
  [
    'analyzing', 'character_basics', 'first_message', 'system_prompts', 'physical_descriptions',
    'wardrobe_items', 'pronouns', 'memories', 'chats', 'assembly', 'validation', 'repair',
  ].map((k) => [k, { status: 'pending' }]),
)

function hook(overrides: Record<string, unknown> = {}) {
  return {
    currentStep: 3,
    canProceed: true,
    characterName: null,
    error: 'The model said nothing',
    uploadedFiles: [{ id: 'f1', name: 'lore.md', size: 10 }],
    sourceText: '',
    uploading: false,
    uploadError: null,
    setSourceText: jest.fn(),
    uploadFiles: jest.fn(),
    removeFile: jest.fn(),
    profiles: [],
    loadingProfiles: false,
    profileId: 'p1',
    includeMemories: true,
    includeChats: false,
    setProfileId: jest.fn(),
    setIncludeMemories: jest.fn(),
    setIncludeChats: jest.fn(),
    generation: { generating: false, steps: STEPS, result: null, stepResults: null, errors: {} },
    startGeneration: jest.fn(),
    importing: false,
    importResult: null,
    importCharacter: jest.fn(),
    exportCharacter: jest.fn(),
    nextStep: jest.fn(),
    prevStep: jest.fn(),
    reset: jest.fn(),
    addMoreMaterial: jest.fn(),
    ...overrides,
  }
}

describe('AIImportWizard after a failed generation', () => {
  it('offers Back and Retry', () => {
    const value = hook()
    mockedUseAIImport.mockReturnValue(value)
    render(<AIImportWizard />)
    expect(screen.getByText('The model said nothing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(value.prevStep).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(value.startGeneration).toHaveBeenCalled()
  })

  it('offers neither while generating', () => {
    mockedUseAIImport.mockReturnValue(
      hook({ error: null, generation: { generating: true, steps: STEPS, result: null, stepResults: null, errors: {} } }),
    )
    render(<AIImportWizard />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})
