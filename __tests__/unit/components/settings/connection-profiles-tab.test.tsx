/**
 * Unit tests for ConnectionProfilesTab max token limit handling
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'
import ConnectionProfilesTab from '@/components/settings/connection-profiles-tab'

function jsonResponse(data: any, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as Response)
}

function setupSettingsFetchMock() {
  return jest.spyOn(global as any, 'fetch').mockImplementation((input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url

    if (url.startsWith('/api/profiles?t=')) {
      return jsonResponse([])
    }

    if (url.startsWith('/api/profiles/') && url.endsWith('/tags')) {
      return jsonResponse({ tags: [] })
    }

    if (url === '/api/chats') {
      return jsonResponse([])
    }

    if (url.startsWith('/api/chats/') && url.endsWith('/messages')) {
      return jsonResponse([])
    }

    if (url === '/api/keys') {
      return jsonResponse([
        { id: 'key-1', label: 'Primary', provider: 'OPENAI', isActive: true },
      ])
    }

    if (url === '/api/providers') {
      return jsonResponse({
        providers: [
          {
            name: 'OPENAI',
            displayName: 'OpenAI',
            configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
            capabilities: { chat: true, imageGeneration: true, embeddings: true, webSearch: true },
          },
        ],
      })
    }

    if (url === '/api/chat-settings') {
      return jsonResponse({ cheapLLMSettings: { defaultCheapProfileId: null } })
    }

    if (url === '/api/profiles/test-connection') {
      return jsonResponse({ message: 'Connected' })
    }

    if (url === '/api/models') {
      return jsonResponse({
        models: ['gpt-3.5-turbo'],
        modelsWithInfo: [
          {
            id: 'gpt-3.5-turbo',
            label: 'gpt-3.5-turbo',
            maxOutputTokens: 8192,
            contextWindow: 16384,
          },
        ],
      })
    }

    if (url === '/api/profiles/test-message') {
      return jsonResponse({ message: 'ok' })
    }

    return jsonResponse([])
  })
}

describe('ConnectionProfilesTab max tokens limit', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('clamps max tokens input using selected model metadata', async () => {
    const fetchMock = setupSettingsFetchMock()

    render(<ConnectionProfilesTab />)

    const addProfileButton = await screen.findByRole('button', { name: /\+ Add Profile/ })
    await act(async () => {
      fireEvent.click(addProfileButton)
    })

    const maxTokensInput = (await screen.findByLabelText('Max Tokens')) as HTMLInputElement
    expect(maxTokensInput).toHaveAttribute('max', '128000')

    const apiKeySelect = await screen.findByLabelText('API Key *')
    await act(async () => {
      fireEvent.change(apiKeySelect, { target: { value: 'key-1' } })
    })

    const connectButton = screen.getByRole('button', { name: /^connect$/i })
    await act(async () => {
      fireEvent.click(connectButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/profiles/test-connection',
        expect.objectContaining({ method: 'POST' })
      )
    })

    await screen.findByText(/connected/i)

    const fetchModelsButton = screen.getByRole('button', { name: /fetch models/i })
    await waitFor(() => expect(fetchModelsButton).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(fetchModelsButton)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/models',
        expect.objectContaining({ method: 'POST' })
      )
    })

    await waitFor(() => {
      expect(maxTokensInput).toHaveAttribute('max', '8192')
    })

    expect(screen.getByText(/Model limit: 8,192 tokens/)).toBeInTheDocument()
  })
})
