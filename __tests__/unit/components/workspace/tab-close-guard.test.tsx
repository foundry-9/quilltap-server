/**
 * Workspace tab close guards (#222): the user's close (tab strip ×, Delete,
 * Ctrl/Cmd+Alt+W) goes through `requestCloseTab`, which asks the tab's close
 * guard first. A standalone document tab's guard saves unsaved text and keeps
 * the tab open when the save is refused — the same rule as its own close button.
 */

import React, { useEffect } from 'react'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

type PaneProps = { onContentChange: (content: string) => void }
let pane: PaneProps | null = null

jest.mock('@/app/salon/[id]/components/DocumentPane', () => ({
  __esModule: true,
  default: (props: PaneProps) => {
    pane = props
    return null
  },
}))
jest.mock('@/app/salon/[id]/components/DocumentViewerPane', () => ({ DocumentViewerPane: () => null }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn() }))

import {
  WorkspaceProvider,
  useWorkspace,
  type TabCloseGuard,
} from '@/components/providers/workspace-provider'
import { WorkspaceTabProvider } from '@/components/workspace/workspace-tab-context'
import { useWorkspaceShortcuts } from '@/components/workspace/useWorkspaceShortcuts'
import { StandaloneDocumentView } from '@/components/workspace/StandaloneDocumentView'
import { showErrorToast } from '@/lib/toast'

type Api = ReturnType<typeof useWorkspace>
let api: Api

function Capture({ onApi }: { onApi: (ws: Api) => void }) {
  const ws = useWorkspace()
  useWorkspaceShortcuts()
  useEffect(() => onApi(ws))
  return null
}

function renderWorkspace(children?: React.ReactNode) {
  return render(
    <WorkspaceProvider>
      <Capture onApi={(ws) => { api = ws }} />
      {children}
    </WorkspaceProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  jest.clearAllMocks()
  pane = null
})

describe('requestCloseTab', () => {
  it('leaves the tab open when its guard refuses', async () => {
    renderWorkspace()
    let id = ''
    act(() => { id = api.openTab('aurora') })
    const guard: TabCloseGuard = jest.fn(async () => false)
    act(() => { api.registerCloseGuard(id, guard) })

    let closed: boolean | undefined
    await act(async () => { closed = await api.requestCloseTab(id) })

    expect(guard).toHaveBeenCalledTimes(1)
    expect(closed).toBe(false)
    expect(api.state.tabs[id]).toBeDefined()
  })

  it('closes the tab when its guard agrees', async () => {
    renderWorkspace()
    let id = ''
    act(() => { id = api.openTab('aurora') })
    act(() => { api.registerCloseGuard(id, async () => true) })

    let closed: boolean | undefined
    await act(async () => { closed = await api.requestCloseTab(id) })

    expect(closed).toBe(true)
    expect(api.state.tabs[id]).toBeUndefined()
  })

  it('closes an unguarded tab, and an unregistered guard no longer applies', async () => {
    renderWorkspace()
    let id = ''
    act(() => { id = api.openTab('aurora') })
    let unregister: () => void = () => {}
    act(() => { unregister = api.registerCloseGuard(id, async () => false) })
    act(() => unregister())

    await act(async () => { await api.requestCloseTab(id) })
    expect(api.state.tabs[id]).toBeUndefined()
  })

  it('asks the guards of child tabs the close would cascade to', async () => {
    renderWorkspace()
    let parent = ''
    let child = ''
    act(() => { parent = api.openTab('salon', { chatId: 'c1' }) })
    act(() => { child = api.openTab('document', { chatId: 'c1' }, { parentTabId: parent }) })
    act(() => { api.registerCloseGuard(child, async () => false) })

    await act(async () => { await api.requestCloseTab(parent) })
    expect(api.state.tabs[parent]).toBeDefined()
    expect(api.state.tabs[child]).toBeDefined()
  })

  it('leaves programmatic closeTab unguarded', () => {
    renderWorkspace()
    let id = ''
    act(() => { id = api.openTab('aurora') })
    act(() => { api.registerCloseGuard(id, async () => false) })
    act(() => api.closeTab(id))
    expect(api.state.tabs[id]).toBeUndefined()
  })

  it('routes Ctrl/Cmd+Alt+W through the guard', async () => {
    renderWorkspace()
    let id = ''
    act(() => { id = api.openTab('aurora') })
    const guard: TabCloseGuard = jest.fn(async () => false)
    act(() => { api.registerCloseGuard(id, guard) })

    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true, altKey: true, bubbles: true })
    })
    expect(guard).toHaveBeenCalled()
    expect(api.state.tabs[id]).toBeDefined()
  })
})

describe('standalone document tab ×', () => {
  const payload = { docKey: 'doc-1', scope: 'general' as const, filePath: 'notes.txt', displayTitle: 'Notes' }

  function json(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
  }

  let writeStatus = 200
  const fetchMock = jest.fn(async (url: string) => {
    const action = new URL(url, 'http://x').searchParams.get('action')
    if (action === 'open-document') {
      return json(200, { document: { filePath: 'notes.txt', scope: 'general', displayTitle: 'Notes' }, content: '', mtime: 1 })
    }
    if (action === 'write-document') return json(writeStatus, writeStatus === 200 ? { mtime: 2 } : { error: 'nope' })
    return json(200, {})
  })

  /** Mounts the open document tab's view inside the real workspace store, as the host would. */
  function DocumentTab() {
    const { tabs } = useWorkspace()
    const tab = Object.values(tabs).find((t) => t.kind === 'document-standalone')
    if (!tab) return null
    return (
      <WorkspaceTabProvider tabId={tab.id}>
        <span data-testid="doc-tab">{tab.id}</span>
        <StandaloneDocumentView payload={payload as never} />
      </WorkspaceTabProvider>
    )
  }

  async function mountDocument(): Promise<string> {
    global.fetch = fetchMock as unknown as typeof fetch
    renderWorkspace(<DocumentTab />)
    let id = ''
    act(() => { id = api.openTab('document-standalone', payload) })
    await waitFor(() => expect(pane).not.toBeNull())
    expect(screen.getByTestId('doc-tab')).toHaveTextContent(id)
    return id
  }

  function writes() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('write-document'))
  }

  it('keeps the tab open with a toast when the save is refused', async () => {
    writeStatus = 500
    const id = await mountDocument()
    act(() => pane!.onContentChange('unsaved words'))

    let closed: boolean | undefined
    await act(async () => { closed = await api.requestCloseTab(id) })

    expect(writes()).toHaveLength(1)
    expect(closed).toBe(false)
    expect(showErrorToast).toHaveBeenCalled()
    expect(api.state.tabs[id]).toBeDefined()
    expect(screen.getByTestId('doc-tab')).toBeInTheDocument()
  })

  it('saves and then closes when the save succeeds', async () => {
    writeStatus = 200
    const id = await mountDocument()
    act(() => pane!.onContentChange('saved words'))

    let closed: boolean | undefined
    await act(async () => { closed = await api.requestCloseTab(id) })

    expect(writes()).toHaveLength(1)
    expect(closed).toBe(true)
    expect(showErrorToast).not.toHaveBeenCalled()
    expect(api.state.tabs[id]).toBeUndefined()
  })

  it('closes at once with nothing unsaved', async () => {
    const id = await mountDocument()
    await act(async () => { await api.requestCloseTab(id) })
    expect(writes()).toHaveLength(0)
    expect(api.state.tabs[id]).toBeUndefined()
  })
})
