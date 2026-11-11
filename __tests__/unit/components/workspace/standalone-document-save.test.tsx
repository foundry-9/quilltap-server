/**
 * The workspace's standalone document tab saves the way Document Mode does
 * (#174 / #175): text typed during a save is written, and a refused save
 * never closes or renames over the unsaved text.
 */

import React from 'react'
import { render, act, waitFor } from '@testing-library/react'

type PaneProps = {
  onContentChange: (content: string) => void
  onFlushSave: () => void
  onCloseDocument: () => Promise<void>
  onTitleChange: (title: string) => Promise<void>
  isDirty: boolean
}

let pane: PaneProps | null = null

jest.mock('@/app/salon/[id]/components/DocumentPane', () => ({
  __esModule: true,
  default: (props: PaneProps) => {
    pane = props
    return null
  },
}))
jest.mock('@/app/salon/[id]/components/DocumentViewerPane', () => ({ DocumentViewerPane: () => null }))
jest.mock('@/components/providers/workspace-provider', () => ({ useWorkspace: () => ({ openTab: jest.fn() }) }))

const closeSelf = jest.fn()
jest.mock('@/components/workspace/useCloseSelfTab', () => ({ useCloseSelfTab: () => closeSelf }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn() }))

import { StandaloneDocumentView } from '@/components/workspace/StandaloneDocumentView'
import { showErrorToast } from '@/lib/toast'

const payload = { docKey: 'doc-1', scope: 'general' as const, filePath: 'notes.txt', displayTitle: 'Notes' }

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

type Responder = (action: string, body: Record<string, unknown>) => unknown
let respond: Responder
const fetchMock = jest.fn(async (url: string, init: { body: string }) => {
  const action = new URL(url, 'http://x').searchParams.get('action') as string
  return respond(action, JSON.parse(init.body))
})

function writes() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('write-document'))
    .map(([, init]) => JSON.parse((init as { body: string }).body))
}

async function mountOpen() {
  render(<StandaloneDocumentView payload={payload as never} />)
  await waitFor(() => expect(pane).not.toBeNull())
}

beforeEach(() => {
  jest.clearAllMocks()
  pane = null
  global.fetch = fetchMock as unknown as typeof fetch
  respond = (action) =>
    action === 'open-document'
      ? json(200, { document: { filePath: 'notes.txt', scope: 'general', displayTitle: 'Notes' }, content: 'v0', mtime: 1 })
      : json(200, {})
})

describe('StandaloneDocumentView saves', () => {
  it('writes text typed during an in-flight save', async () => {
    await mountOpen()
    let release: () => void = () => {}
    let writeCount = 0
    const base = respond
    respond = (action, body) => {
      if (action !== 'write-document') return base(action, body)
      writeCount++
      if (writeCount === 1) return new Promise((r) => { release = () => r(json(200, { mtime: 2 })) })
      return json(200, { mtime: 3 })
    }

    act(() => pane!.onContentChange('v1'))
    act(() => pane!.onFlushSave())
    act(() => pane!.onContentChange('v2'))
    await act(async () => { release() })

    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[0]).toMatchObject({ content: 'v1', mtime: 1 })
    expect(writes()[1]).toMatchObject({ content: 'v2', mtime: 2 })
    await waitFor(() => expect(pane!.isDirty).toBe(false))
  })

  it.each([500, 409])('stays open with its text when the save is refused with %i', async (status) => {
    await mountOpen()
    const base = respond
    respond = (action, body) => {
      if (action === 'write-document') return json(status, { error: 'nope' })
      if (action === 'read-document') return json(200, { content: 'v0', mtime: 5 })
      return base(action, body)
    }

    act(() => pane!.onContentChange('unsaved words'))
    await act(async () => { await pane!.onCloseDocument() })

    expect(closeSelf).not.toHaveBeenCalled()
    expect(showErrorToast).toHaveBeenCalled()
  })

  it('does not rename over a refused save', async () => {
    await mountOpen()
    const base = respond
    respond = (action, body) => (action === 'write-document' ? json(500, {}) : base(action, body))

    act(() => pane!.onContentChange('unsaved words'))
    await act(async () => { await pane!.onTitleChange('New Title') })

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('rename-document'))).toBe(false)
    expect(showErrorToast).toHaveBeenCalled()
  })

  it('closes after a successful save', async () => {
    await mountOpen()
    const base = respond
    respond = (action, body) => (action === 'write-document' ? json(200, { mtime: 2 }) : base(action, body))

    act(() => pane!.onContentChange('v1'))
    await act(async () => { await pane!.onCloseDocument() })

    expect(writes()).toHaveLength(1)
    expect(closeSelf).toHaveBeenCalled()
  })
})
