import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryList } from '@/components/memory/memory-list'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn().mockResolvedValue(true),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}))

describe('MemoryList', () => {
  const mockCharacterId = '550e8400-e29b-41d4-a716-446655440001'
  const mockFetch = global.fetch as jest.Mock

  const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

  async function renderMemoryList(overrides: Partial<{ characterId: string }> = {}) {
    const props = { characterId: mockCharacterId, ...overrides }
    let rendered: ReturnType<typeof render>

    await act(async () => {
      rendered = render(<MemoryList {...props} />)
      await flushPromises()
    })

    return rendered!
  }

  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [] }),
    } as Response)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('shows loading text before rendering the list header', async () => {
    render(<MemoryList characterId={mockCharacterId} />)
    expect(screen.getByText(/loading memories/i)).toBeInTheDocument()

    await act(async () => {
      await flushPromises()
    })

    expect(screen.getByText(/Memories \(0\)/i)).toBeInTheDocument()
  })

  it('fetches memories and displays the count', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        memories: [
          {
            id: '1',
            characterId: mockCharacterId,
            content: 'Alpha',
            summary: 'Alpha',
            keywords: [],
            tags: [],
            importance: 0.5,
            source: 'AUTO',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: '2',
            characterId: mockCharacterId,
            content: 'Beta',
            summary: 'Beta',
            keywords: [],
            tags: [],
            importance: 0.7,
            source: 'MANUAL',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    } as Response)

    await renderMemoryList()

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/characters/${mockCharacterId}/memories`))
    expect(screen.getByText(/Memories \(2\)/i)).toBeInTheDocument()
  })

  it('shows an error message if the fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)

    await renderMemoryList()

    await waitFor(() => {
      expect(screen.getByText(/failed to fetch memories/i)).toBeInTheDocument()
    })
  })

  it('updates search input value without throwing', async () => {
    await renderMemoryList()

    const searchInput = screen.getByPlaceholderText(/search memories/i)
    fireEvent.change(searchInput, { target: { value: 'alpha' } })

    await act(async () => {
      await flushPromises()
    })

    expect(searchInput).toHaveValue('alpha')
  })

  it('opens housekeeping dialog when cleanup is clicked', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        memories: [
          {
            id: '1',
            characterId: mockCharacterId,
            content: 'Alpha',
            summary: 'Alpha',
            keywords: [],
            tags: [],
            importance: 0.5,
            source: 'AUTO',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    } as Response)

    await renderMemoryList()

    fireEvent.click(screen.getByRole('button', { name: /cleanup/i }))

    await act(async () => {
      await flushPromises()
    })

    expect(screen.getByText(/memory cleanup/i)).toBeInTheDocument()
  })
})
