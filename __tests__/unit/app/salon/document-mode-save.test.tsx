/**
 * Document Mode saves.
 *
 * #174: text typed while a save was in flight was marked saved and never
 * written. #175: closing (or renaming) after a refused save closed the pane
 * and dropped the unsaved text.
 */

import { renderHook, act, waitFor } from '@testing-library/react'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn() }))

jest.mock('@/app/salon/[id]/hooks/documentModeApi', () => {
  const actual = jest.requireActual('@/app/salon/[id]/hooks/documentModeApi')
  return {
    ...actual,
    openDocumentForChat: jest.fn(),
    requestDocumentWrite: jest.fn(),
    closeDocumentForChat: jest.fn(async () => undefined),
    persistChatDocumentState: jest.fn(async () => undefined),
    readDocumentContentForChat: jest.fn(),
    renameDocumentForChat: jest.fn(),
  }
})

import { useDocumentMode } from '@/app/salon/[id]/hooks/useDocumentMode'
import {
  openDocumentForChat,
  requestDocumentWrite,
  closeDocumentForChat,
  readDocumentContentForChat,
  renameDocumentForChat,
} from '@/app/salon/[id]/hooks/documentModeApi'
import { showErrorToast } from '@/lib/toast'

const openMock = openDocumentForChat as jest.Mock
const writeMock = requestDocumentWrite as jest.Mock
const closeMock = closeDocumentForChat as jest.Mock
const readMock = readDocumentContentForChat as jest.Mock
const renameMock = renameDocumentForChat as jest.Mock

const DOC_ID = 'doc-1'

function okResponse(mtime: number) {
  return { ok: true, status: 200, json: async () => ({ mtime }), text: async () => '' }
}

function failResponse(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => 'nope' }
}

async function openPlainDoc() {
  openMock.mockResolvedValue({
    document: { id: DOC_ID, filePath: 'notes.txt', scope: 'project', displayTitle: 'Notes' },
    content: 'v0',
    mtime: 1,
  })
  const hook = renderHook(() => useDocumentMode({ chatId: 'chat-1', chat: null }))
  await act(async () => {
    await hook.result.current.openDocument({ filePath: 'notes.txt' })
  })
  return hook
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useDocumentMode saves', () => {
  it('writes text typed during an in-flight save instead of marking it saved (#174)', async () => {
    const { result } = await openPlainDoc()

    act(() => result.current.handleContentChange(DOC_ID, 'v1'))

    let resolveFirst: (v: unknown) => void = () => {}
    writeMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce(okResponse(3))

    let savePromise: Promise<boolean> = Promise.resolve(true)
    act(() => { savePromise = result.current.saveDocument(DOC_ID) })

    // Typed while the first write is in flight.
    act(() => result.current.handleContentChange(DOC_ID, 'v2'))

    let saved = false
    await act(async () => {
      resolveFirst(okResponse(2))
      saved = await savePromise
    })

    expect(saved).toBe(true)
    expect(writeMock).toHaveBeenCalledTimes(2)
    expect(writeMock.mock.calls[0][1]).toMatchObject({ content: 'v1', mtime: 1 })
    expect(writeMock.mock.calls[1][1]).toMatchObject({ content: 'v2', mtime: 2 })
    await waitFor(() => expect(result.current.openDocs[0].isDirty).toBe(false))
  })

  it.each([500, 409])('keeps the pane open with its text when the save is refused with %i (#175)', async (status) => {
    const { result } = await openPlainDoc()
    act(() => result.current.handleContentChange(DOC_ID, 'unsaved words'))

    writeMock.mockResolvedValue(failResponse(status))
    readMock.mockResolvedValue({ content: 'v0', mtime: 5 })

    await act(async () => {
      await result.current.closeDocument(DOC_ID)
    })

    expect(closeMock).not.toHaveBeenCalled()
    expect(showErrorToast).toHaveBeenCalled()
    expect(result.current.openDocs).toHaveLength(1)
    expect(result.current.openDocs[0].document.content).toBe('unsaved words')
  })

  it('does not rename over a refused save (#175)', async () => {
    const { result } = await openPlainDoc()
    act(() => result.current.handleContentChange(DOC_ID, 'unsaved words'))
    writeMock.mockResolvedValue(failResponse(500))

    await act(async () => {
      await result.current.renameDocument(DOC_ID, 'New Title')
    })

    expect(renameMock).not.toHaveBeenCalled()
    expect(showErrorToast).toHaveBeenCalled()
  })

  it('closes after a successful save', async () => {
    const { result } = await openPlainDoc()
    act(() => result.current.handleContentChange(DOC_ID, 'v1'))
    writeMock.mockResolvedValue(okResponse(2))

    await act(async () => {
      await result.current.closeDocument(DOC_ID)
    })

    expect(writeMock).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledWith('chat-1', DOC_ID)
    expect(result.current.openDocs).toHaveLength(0)
  })
})
