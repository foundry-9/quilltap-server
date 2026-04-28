/**
 * Unit tests for RunToolModal component
 *
 * Tests cover:
 * - Modal phases (tool selection, parameter input, execution)
 * - Tool selection and filtering
 * - Execution and response handling
 * - Error handling
 * - Closing/canceling the modal
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// Mock toast
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

// Mock JsonSchemaForm
jest.mock('@/components/chat/JsonSchemaForm', () => ({
  __esModule: true,
  default: ({ values, onChange, onValidChange }: {
    schema: Record<string, unknown>
    values: Record<string, unknown>
    onChange: (v: Record<string, unknown>) => void
    onValidChange: (v: boolean) => void
  }) => (
    <div data-testid="json-schema-form">
      <button
        data-testid="set-form-valid"
        onClick={() => onValidChange(true)}
      >
        Mark Valid
      </button>
      <button
        data-testid="set-form-values"
        onClick={() => onChange({ ...values, query: 'test-value' })}
      >
        Set Values
      </button>
    </div>
  ),
}))

import RunToolModal from '@/components/chat/RunToolModal'
import { showErrorToast } from '@/lib/toast'
import type { AvailableTool } from '@/app/api/v1/tools/route'

// Helper to create mock tools
function createMockTool(overrides: Partial<AvailableTool> = {}): AvailableTool {
  return {
    id: 'search',
    name: 'Search Memories',
    description: 'Search character memories',
    source: 'built-in',
    category: 'memory',
    userInvocable: true,
    ...overrides,
  }
}

function createMockToolWithParams(overrides: Partial<AvailableTool> = {}): AvailableTool {
  return createMockTool({
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    ...overrides,
  })
}

const mockParticipants = [
  {
    id: 'participant-1',
    type: 'CHARACTER' as const,
    displayOrder: 0,
    isActive: true,
    characterId: 'char-abc',
    character: { name: 'Alice', id: 'char-abc' },
  },
]

const baseProps = {
  isOpen: true,
  onClose: jest.fn(),
  chatId: 'chat-123',
  participants: mockParticipants as any,
  onToolExecuted: jest.fn(),
}

describe('RunToolModal', () => {
  let fetchMock: jest.SpiedFunction<typeof global.fetch>

  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, 'fetch') as jest.SpiedFunction<typeof global.fetch>
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function mockFetchTools(tools: AvailableTool[]) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tools }),
    } as Response)
  }

  function mockFetchExecute(response: Record<string, unknown>, ok = true) {
    fetchMock.mockResolvedValueOnce({
      ok,
      json: async () => response,
    } as Response)
  }

  describe('Phase 1: Tool Selection', () => {
    it('shows loading state while fetching tools', async () => {
      // Never resolve the fetch
      fetchMock.mockReturnValueOnce(new Promise(() => {}))

      render(<RunToolModal {...baseProps} />)

      // The modal should be showing a spinner (svg with animate-spin)
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('fetches tools when modal opens', async () => {
      mockFetchTools([createMockTool()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/tools?chatId=chat-123&includeSchemas=true'
      )
    })

    it('displays available tools grouped by category', async () => {
      const tools = [
        createMockTool({ id: 'search', name: 'Search Memories', category: 'memory' }),
        createMockTool({ id: 'generate_image', name: 'Generate Image', category: 'media' }),
      ]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(screen.getByText('Search Memories')).toBeInTheDocument()
      expect(screen.getByText('Generate Image')).toBeInTheDocument()
    })

    it('filters out non-user-invocable tools', async () => {
      const tools = [
        createMockTool({ id: 'user_tool', name: 'User Tool', userInvocable: true }),
        createMockTool({ id: 'internal_tool', name: 'Internal Tool', userInvocable: false }),
      ]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(screen.getByText('User Tool')).toBeInTheDocument()
      expect(screen.queryByText('Internal Tool')).not.toBeInTheDocument()
    })

    it('shows empty state when no tools match search', async () => {
      mockFetchTools([createMockTool()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      const searchInput = screen.getByPlaceholderText('Search tools...')
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } })

      expect(screen.getByText('No tools match your search.')).toBeInTheDocument()
    })

    it('filters tools by search query matching description', async () => {
      const tools = [
        createMockTool({ id: 'search', name: 'Search Memories', description: 'Search character memories', category: 'memory' }),
        createMockTool({ id: 'generate_image', name: 'Generate Image', description: 'Generate an image', category: 'media' }),
      ]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      const searchInput = screen.getByPlaceholderText('Search tools...')
      fireEvent.change(searchInput, { target: { value: 'character' } })

      expect(screen.getByText('Search Memories')).toBeInTheDocument()
      expect(screen.queryByText('Generate Image')).not.toBeInTheDocument()
    })

    it('shows unavailable reason for tools with available=false', async () => {
      const tools = [
        createMockTool({
          id: 'generate_image',
          name: 'Generate Image',
          available: false,
          unavailableReason: 'No image profile configured',
        }),
      ]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(screen.getByText('No image profile configured')).toBeInTheDocument()
    })

    it('does not select unavailable tools on click', async () => {
      const tools = [
        createMockTool({
          id: 'generate_image',
          name: 'Generate Image',
          available: false,
          unavailableReason: 'No image profile configured',
        }),
      ]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      const toolButton = screen.getByText('Generate Image').closest('button')!
      expect(toolButton).toBeDisabled()
    })

    it('shows error toast when tool fetch fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(showErrorToast).toHaveBeenCalledWith('Failed to load available tools')
    })

    it('shows Cancel button in tool selection phase', async () => {
      mockFetchTools([createMockTool()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })

  describe('Phase 2: Parameter Input', () => {
    it('transitions to parameter phase when tool is selected', async () => {
      const tools = [createMockToolWithParams()]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      expect(screen.getByText('Search character memories')).toBeInTheDocument()
      expect(screen.getByText('Parameters')).toBeInTheDocument()
    })

    it('shows "no parameters" message for tools without parameters', async () => {
      const tools = [createMockTool({ parameters: undefined })]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      expect(screen.getByText('This tool requires no parameters.')).toBeInTheDocument()
    })

    it('shows Back button in parameter phase', async () => {
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      expect(screen.getByText('Back')).toBeInTheDocument()
    })

    it('returns to tool selection when Back is clicked', async () => {
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))
      expect(screen.getByText('Parameters')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Back'))

      // Should be back to tool selection - search input visible
      expect(screen.getByPlaceholderText('Search tools...')).toBeInTheDocument()
    })

    it('pre-populates default values from schema', async () => {
      const tools = [createMockTool({
        parameters: {
          type: 'object',
          properties: {
            count: { type: 'number', default: 5 },
          },
        },
      })]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      // The form should be rendered (mocked)
      expect(screen.getByTestId('json-schema-form')).toBeInTheDocument()
    })

    it('disables Run Tool button when form is not valid and has schema', async () => {
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      const runButton = screen.getByText('Run Tool')
      expect(runButton).toBeDisabled()
    })

    it('enables Run Tool button when form becomes valid', async () => {
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      // Use mock form to mark valid
      fireEvent.click(screen.getByTestId('set-form-valid'))

      const runButton = screen.getByText('Run Tool')
      expect(runButton).not.toBeDisabled()
    })
  })

  describe('Tool Execution', () => {
    it('sends correct request when executing a tool', async () => {
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))
      fireEvent.click(screen.getByTestId('set-form-values'))
      fireEvent.click(screen.getByTestId('set-form-valid'))

      mockFetchExecute({ success: true, result: { toolName: 'search', success: true } })

      await act(async () => {
        fireEvent.click(screen.getByText('Run Tool'))
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/chats/chat-123?action=run-tool',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: 'search',
            arguments: { query: 'test-value' },
            characterId: 'char-abc',
            private: false,
          }),
        })
      )
    })

    it('calls onToolExecuted and onClose on success', async () => {
      mockFetchTools([createMockTool({ parameters: undefined })])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      mockFetchExecute({ success: true, result: { toolName: 'search', success: true } })

      await act(async () => {
        fireEvent.click(screen.getByText('Run Tool'))
      })

      expect(baseProps.onToolExecuted).toHaveBeenCalled()
      expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('shows error toast on failed execution response', async () => {
      mockFetchTools([createMockTool({ parameters: undefined })])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      mockFetchExecute({ success: false, error: 'Tool not found' }, false)

      await act(async () => {
        fireEvent.click(screen.getByText('Run Tool'))
      })

      expect(showErrorToast).toHaveBeenCalledWith('Tool not found')
    })

    it('shows error toast on network error during execution', async () => {
      mockFetchTools([createMockTool({ parameters: undefined })])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      fetchMock.mockRejectedValueOnce(new Error('Network failure'))

      await act(async () => {
        fireEvent.click(screen.getByText('Run Tool'))
      })

      expect(showErrorToast).toHaveBeenCalledWith('Network failure')
    })

    it('does not call onToolExecuted or onClose on failure', async () => {
      mockFetchTools([createMockTool({ parameters: undefined })])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      mockFetchExecute({ success: false, error: 'Tool failed' }, false)

      await act(async () => {
        fireEvent.click(screen.getByText('Run Tool'))
      })

      expect(baseProps.onToolExecuted).not.toHaveBeenCalled()
      // onClose should not have been called during execution failure
    })
  })

  describe('Closing/Canceling', () => {
    it('calls onClose when Cancel is clicked in tool selection phase', async () => {
      mockFetchTools([createMockTool()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Cancel'))

      expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('calls onClose when Cancel is clicked in parameter phase', async () => {
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      fireEvent.click(screen.getByText('Search Memories'))

      // In parameter phase there are Cancel and Back buttons
      fireEvent.click(screen.getByText('Cancel'))

      expect(baseProps.onClose).toHaveBeenCalled()
    })

    it('does not fetch tools when modal is closed', () => {
      render(<RunToolModal {...baseProps} isOpen={false} />)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('resets state when modal reopens', async () => {
      mockFetchTools([createMockToolWithParams()])

      const { rerender } = await act(async () => {
        return render(<RunToolModal {...baseProps} />)
      })

      // Select a tool
      fireEvent.click(screen.getByText('Search Memories'))
      expect(screen.getByText('Parameters')).toBeInTheDocument()

      // Close and reopen
      mockFetchTools([createMockToolWithParams()])

      await act(async () => {
        rerender(<RunToolModal {...baseProps} isOpen={false} />)
      })

      await act(async () => {
        rerender(<RunToolModal {...baseProps} isOpen={true} />)
      })

      // Should be back at tool selection phase
      expect(screen.getByPlaceholderText('Search tools...')).toBeInTheDocument()
    })
  })

  describe('Plugin tools', () => {
    it('shows plugin badge for plugin-sourced tools', async () => {
      const tools = [
        createMockTool({
          id: 'mcp_tool',
          name: 'MCP Tool',
          source: 'plugin',
          pluginName: 'MCP Server',
        }),
      ]
      mockFetchTools(tools)

      await act(async () => {
        render(<RunToolModal {...baseProps} />)
      })

      expect(screen.getByText('plugin: MCP Server')).toBeInTheDocument()
    })
  })
})
