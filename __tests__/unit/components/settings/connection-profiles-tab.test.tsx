/**
 * Unit tests for ConnectionProfilesTab max token limit handling
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import ConnectionProfilesTab from '@/components/settings/connection-profiles-tab'

// Mock clientLogger to prevent console output and avoid module issues
jest.mock('@/lib/client-logger', () => ({
  clientLogger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}))

// Mock fetchJson helper
jest.mock('@/lib/fetch-helpers', () => ({
  fetchJson: jest.fn(),
}))

// Mock useAutoAssociate hook
jest.mock('@/hooks/useAutoAssociate', () => ({
  useAutoAssociate: jest.fn(() => jest.fn()),
}))

describe('ConnectionProfilesTab max tokens limit', () => {
  let fetchJsonMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    const { fetchJson } = require('@/lib/fetch-helpers')
    fetchJsonMock = fetchJson

    // Setup default mock responses for fetchJson
    fetchJsonMock.mockImplementation(async (url: string, options?: any) => {
      // Connection profiles list
      if (url.includes('/api/v1/connection-profiles')) {
        return { ok: true, data: [] }
      }

      // API keys
      if (url === '/api/v1/api-keys') {
        return {
          ok: true,
          data: [{ id: 'key-1', label: 'Primary', provider: 'OPENAI', isActive: true }],
        }
      }

      // Providers configuration
      if (url === '/api/providers') {
        return {
          ok: true,
          data: {
            providers: [
              {
                name: 'OPENAI',
                displayName: 'OpenAI',
                configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
                capabilities: { chat: true, imageGeneration: true, embeddings: true, webSearch: true },
              },
            ],
          },
        }
      }

      // Chat settings
      if (url === '/api/chat-settings') {
        return { ok: true, data: { cheapLLMSettings: { defaultCheapProfileId: null } } }
      }

      // Test connection
      if (url === '/api/profiles/test-connection') {
        return { ok: true, data: { message: 'Connected' } }
      }

      // Fetch models
      if (url === '/api/models') {
        return {
          ok: true,
          data: {
            models: ['gpt-3.5-turbo'],
            modelsWithInfo: [
              {
                id: 'gpt-3.5-turbo',
                label: 'gpt-3.5-turbo',
                maxOutputTokens: 8192,
                contextWindow: 16384,
              },
            ],
          },
        }
      }

      // Test message
      if (url === '/api/profiles/test-message') {
        return { ok: true, data: { message: 'ok' } }
      }

      // Default response
      return { ok: true, data: null }
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('clamps max tokens input using selected model metadata', async () => {
    const user = userEvent.setup()

    render(<ConnectionProfilesTab />)

    // Wait for the profiles list to load
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/connection-profiles'),
        expect.any(Object)
      )
    })

    // Find and click the "Add Profile" button
    const addProfileButton = await screen.findByRole('button', { name: /\+ Add Profile/ })
    await user.click(addProfileButton)

    // Wait for modal to appear - check for the modal title
    await screen.findByText(/Create Connection Profile/)

    // Initial max tokens limit should be 128000 (default)
    let maxTokensInput = (await screen.findByLabelText('Max Tokens')) as HTMLInputElement
    expect(maxTokensInput).toHaveAttribute('max', '128000')

    // Select an API key
    const apiKeySelect = await screen.findByLabelText('API Key *')
    await user.selectOptions(apiKeySelect, 'key-1')

    // Click the Connect button
    const connectButton = screen.getByRole('button', { name: /^Connect$/i })
    await user.click(connectButton)

    // Wait for connection message to appear
    await waitFor(() => {
      expect(screen.getByText(/Connected/i)).toBeInTheDocument()
    })

    // Verify connection test was called
    expect(fetchJsonMock).toHaveBeenCalledWith(
      '/api/profiles/test-connection',
      expect.objectContaining({ method: 'POST' })
    )

    // Fetch Models button should now be enabled
    const fetchModelsButton = screen.getByRole('button', { name: /Fetch Models/i })
    await waitFor(() => expect(fetchModelsButton).not.toBeDisabled())

    // Click Fetch Models
    await user.click(fetchModelsButton)

    // Wait for models to be fetched
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(
        '/api/models',
        expect.objectContaining({ method: 'POST' })
      )
    })

    // Select a model by finding the input with placeholder matching "model" or "gpt"
    const modelInput = screen.queryAllByPlaceholderText(/gpt|model|search/i)[0] as HTMLInputElement

    if (modelInput) {
      // Type in the model input to select it
      await user.type(modelInput, 'gpt-3.5-turbo')

      // Wait for the model to be selected and the max tokens limit to update
      await waitFor(() => {
        maxTokensInput = screen.getByLabelText('Max Tokens') as HTMLInputElement
        expect(maxTokensInput).toHaveAttribute('max', '8192')
      }, { timeout: 3000 })

      // Verify the model limit text is displayed with correct formatting
      const modelLimitElements = screen.queryAllByText((content, element) => {
        return element?.textContent?.includes('Model limit') && element?.textContent?.includes('8,192')
      })
      expect(modelLimitElements.length).toBeGreaterThan(0)
    } else {
      // If model input not found, just verify the max tokens limit was updated
      // (it might be fetched automatically)
      await waitFor(() => {
        maxTokensInput = screen.getByLabelText('Max Tokens') as HTMLInputElement
        expect(maxTokensInput).toHaveAttribute('max', '8192')
      }, { timeout: 3000 })

      // Verify the model limit text is displayed
      const modelLimitElements = screen.queryAllByText((content, element) => {
        return element?.textContent?.includes('Model limit') && element?.textContent?.includes('8,192')
      })
      expect(modelLimitElements.length).toBeGreaterThan(0)
    }
  })
})
