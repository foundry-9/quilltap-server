/**
 * The setup wizard's Test All checked the chat model and the embedding model,
 * but not a Manual background (cheap) model. A Manual pick can be another
 * provider and another model entirely, and every background job runs on it,
 * so a bad one passed the review page and surfaced later as failed jobs
 * (fresh-instance dogfood, 4.14.1). It is now tested with its own row.
 */

import React, { useReducer } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { TestConfirmStep, testedSummary } from '@/components/setup-wizard/steps/TestConfirmStep'
import {
  INITIAL_WIZARD_STATE,
  wizardReducer,
  type ProviderInfo,
  type WizardState,
} from '@/components/setup-wizard/useProviderWizardState'
import { testEmbedding, testMessage } from '@/components/setup-wizard/wizard-api'

jest.mock('@/components/setup-wizard/wizard-api', () => ({
  testMessage: jest.fn(),
  testEmbedding: jest.fn(),
  createConnectionProfile: jest.fn(),
  createEmbeddingProfile: jest.fn(),
  createImageProfile: jest.fn(),
  updateChatSettings: jest.fn(),
}))
jest.mock('@/components/ui/icon', () => ({
  Icon: ({ title }: { title?: string }) => <span>{title}</span>,
}))

const mockTestMessage = testMessage as jest.Mock
const mockTestEmbedding = testEmbedding as jest.Mock

function provider(id: string, displayName: string): ProviderInfo {
  return {
    id,
    displayName,
    description: '',
    abbreviation: id.slice(0, 3),
    colors: { bg: '', text: '', icon: '' },
    capabilities: { chat: true, imageGeneration: false, embeddings: true, webSearch: false },
    configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
  }
}

function baseState(overrides: Partial<WizardState>): WizardState {
  return {
    ...INITIAL_WIZARD_STATE,
    currentStep: 'confirm',
    availableProviders: [provider('ANTHROPIC', 'Anthropic'), provider('OPENAI', 'OpenAI')],
    selectedProviders: ['ANTHROPIC', 'OPENAI'],
    apiKeys: {
      ANTHROPIC: { label: 'a', key: '', validated: true, apiKeyId: 'key-a' },
      OPENAI: { label: 'o', key: '', validated: true, apiKeyId: 'key-o' },
    },
    chatConfig: { provider: 'ANTHROPIC', model: 'claude-haiku-5-5' },
    ...overrides,
  }
}

function Harness({ initial }: { initial: WizardState }) {
  const [state, dispatch] = useReducer(wizardReducer, initial)
  return <TestConfirmStep state={state} dispatch={dispatch} onComplete={() => {}} />
}

describe('TestConfirmStep — Test All', () => {
  beforeEach(() => {
    mockTestMessage.mockReset()
    mockTestEmbedding.mockReset()
  })

  it('tests a Manual background model with its own provider, key and model', async () => {
    mockTestMessage.mockResolvedValue({ success: true })
    renderWithQuery(
      <Harness
        initial={baseState({ cheapConfig: { strategy: 'USER_DEFINED', provider: 'OPENAI', model: 'gpt-5.4-nano' } })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test All' }))

    await waitFor(() => expect(screen.getByText('Chat and the background model work')).toBeTruthy())
    expect(mockTestMessage).toHaveBeenCalledTimes(2)
    expect(mockTestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'OPENAI', apiKeyId: 'key-o', modelName: 'gpt-5.4-nano' }),
    )
    expect(screen.getAllByText('Test passed')).toHaveLength(2)
  })

  it('reports a failing background model on its own row and withholds the all-clear', async () => {
    mockTestMessage.mockImplementation(async ({ provider }: { provider: string }) =>
      provider === 'OPENAI' ? { success: false, error: 'model not found' } : { success: true },
    )
    renderWithQuery(
      <Harness
        initial={baseState({ cheapConfig: { strategy: 'USER_DEFINED', provider: 'OPENAI', model: 'gpt-nope' } })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test All' }))

    await waitFor(() => expect(screen.getByText('model not found')).toBeTruthy())
    expect(screen.getByText('Test passed')).toBeTruthy()
    expect(screen.getByText('Test failed')).toBeTruthy()
    expect(screen.queryByText(/work$/)).toBeNull()
  })

  it('makes no extra call for Auto', async () => {
    mockTestMessage.mockResolvedValue({ success: true })
    mockTestEmbedding.mockResolvedValue({ success: true })
    renderWithQuery(
      <Harness
        initial={baseState({ embeddingConfig: { provider: 'OPENAI', model: 'text-embedding-3-small', dimensions: 1536 } })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test All' }))

    await waitFor(() => expect(screen.getByText('Chat and embeddings work')).toBeTruthy())
    expect(mockTestMessage).toHaveBeenCalledTimes(1)
  })
})

describe('testedSummary', () => {
  it('names exactly what was tested', () => {
    expect(testedSummary(false, false)).toBe('Chat works')
    expect(testedSummary(true, false)).toBe('Chat and the background model work')
    expect(testedSummary(false, true)).toBe('Chat and embeddings work')
    expect(testedSummary(true, true)).toBe('Chat, the background model and embeddings work')
  })
})
