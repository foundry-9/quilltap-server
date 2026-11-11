/**
 * #170 — a refetch of the project must not overwrite typed instructions, and
 * each editor saves only its own fields.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useProjectDetail } from '@/app/prospero/[id]/hooks/useProjectDetail'

jest.mock('@/lib/toast', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }))

let serverProject: Record<string, unknown>
const puts: Array<Record<string, unknown>> = []

describe('useProjectDetail drafts (#170)', () => {
  beforeEach(() => {
    puts.length = 0
    serverProject = { id: 'p1', name: 'Gatsby', description: 'West Egg', instructions: 'old text', characterRoster: [] }
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string)
        puts.push(body)
        serverProject = { ...serverProject, ...body }
      }
      return { ok: true, status: 200, json: async () => ({ project: serverProject }) } as Response
    })
  })

  it('keeps typed instructions across a refetch and saves them alone', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useProjectDetail('p1'), { wrapper })
    await waitFor(() => expect(result.current.project?.name).toBe('Gatsby'))
    expect(result.current.instructionsDraft).toBe('old text')

    act(() => { result.current.setInstructionsDraft('new text') })
    // A roster change elsewhere renamed nothing but re-reads the project.
    await act(async () => { await result.current.fetchProject() })
    expect(result.current.instructionsDraft).toBe('new text')
    expect(result.current.instructionsDirty).toBe(true)

    await act(async () => { await result.current.handleSaveInstructions() })
    expect(puts).toEqual([{ instructions: 'new text' }])
    await waitFor(() => expect(result.current.instructionsDirty).toBe(false))
  })

  it('adopts a server change while the draft is clean', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useProjectDetail('p1'), { wrapper })
    await waitFor(() => expect(result.current.project?.name).toBe('Gatsby'))
    serverProject = { ...serverProject, instructions: 'from another tab' }
    await act(async () => { await result.current.fetchProject() })
    await waitFor(() => expect(result.current.instructionsDraft).toBe('from another tab'))
  })

  it('header save sends only name and description, and leaves an instructions draft alone', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useProjectDetail('p1'), { wrapper })
    await waitFor(() => expect(result.current.project?.name).toBe('Gatsby'))

    act(() => { result.current.setInstructionsDraft('typed, unsaved') })
    act(() => { result.current.startEditing() })
    act(() => { result.current.setHeaderDraft({ name: 'Nick', description: '' }) })
    await act(async () => { await result.current.handleSaveHeader() })

    expect(puts).toEqual([{ name: 'Nick', description: null }])
    expect(result.current.isEditing).toBe(false)
    expect(result.current.instructionsDraft).toBe('typed, unsaved')
  })
})
