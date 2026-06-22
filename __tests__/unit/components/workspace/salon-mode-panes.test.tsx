/**
 * SalonModePanes routing: legacy fallback (no workspace → in-chat SplitLayout)
 * and the workspace branch (document/terminal modes spawn child tabs and the
 * panes are portaled into their hosts). Guards the trickiest Phase 4 logic.
 */

import { useCallback, useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SalonModePanes } from '@/app/salon/[id]/components/SalonModePanes'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import {
  WorkspaceTabProvider,
  WorkspacePortalRegistryProvider,
  useWorkspacePortalRegistry,
  portalKey,
} from '@/components/workspace/workspace-tab-context'

/** Registers a portal host node for a chat-linked pane (stands in for a TabView). */
function HostProbe({ kind, chatId }: { kind: 'terminal' | 'document'; chatId: string }) {
  const reg = useWorkspacePortalRegistry()
  const setNode = reg?.setNode
  const ref = useCallback(
    (el: HTMLElement | null) => setNode?.(portalKey(kind, chatId), el),
    [setNode, kind, chatId]
  )
  return <div data-testid={`host-${kind}`} ref={ref} />
}

/** Surfaces how many document tabs exist in the workspace. */
function DocTabCount() {
  const { state } = useWorkspace()
  const n = Object.values(state.tabs).filter((t) => t.kind === 'document').length
  return <div data-testid="doc-tab-count">{n}</div>
}

const baseProps = {
  parentChatId: 'c1',
  chatTitle: 'My Chat',
  mode: 'normal' as const,
  dividerPosition: 50,
  onDividerPositionChange: () => {},
  rightPaneVerticalSplit: 50,
  onRightPaneVerticalSplitChange: () => {},
  terminalContent: null,
  terminalActive: false,
  onCloseTerminal: () => {},
}

describe('SalonModePanes — legacy (no workspace)', () => {
  it('renders the in-chat SplitLayout with the chat content', () => {
    render(
      <SalonModePanes
        {...baseProps}
        chatContent={<div>CHAT-BODY</div>}
        documentContent={null}
        documentActive={false}
        onCloseDocument={() => {}}
      />
    )
    expect(screen.getByText('CHAT-BODY')).toBeInTheDocument()
  })
})

describe('SalonModePanes — workspace branch', () => {
  beforeEach(() => window.localStorage.clear())

  function WorkspaceHarness() {
    const [documentActive, setDocumentActive] = useState(false)
    return (
      <WorkspaceProvider>
        <WorkspacePortalRegistryProvider>
          <WorkspaceTabProvider tabId="salon-tab">
            <SalonModePanes
              {...baseProps}
              chatContent={<div>CHAT-BODY</div>}
              documentContent={documentActive ? <div>DOC-BODY</div> : null}
              documentActive={documentActive}
              onCloseDocument={() => setDocumentActive(false)}
            />
          </WorkspaceTabProvider>
          <HostProbe kind="document" chatId="c1" />
          <DocTabCount />
          <button onClick={() => setDocumentActive((v) => !v)}>toggle-doc</button>
        </WorkspacePortalRegistryProvider>
      </WorkspaceProvider>
    )
  }

  it('opens a document child tab and portals the pane into its host', () => {
    render(<WorkspaceHarness />)

    // Chat content renders inline in the workspace branch.
    expect(screen.getByText('CHAT-BODY')).toBeInTheDocument()
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('0')

    fireEvent.click(screen.getByText('toggle-doc'))

    // A document tab was spawned and the pane portaled into its host.
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('1')
    expect(within(screen.getByTestId('host-document')).getByText('DOC-BODY')).toBeInTheDocument()
  })

  it('closes the document child tab when document mode turns off', () => {
    render(<WorkspaceHarness />)
    fireEvent.click(screen.getByText('toggle-doc'))
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('1')

    fireEvent.click(screen.getByText('toggle-doc'))
    expect(screen.getByTestId('doc-tab-count').textContent).toBe('0')
  })
})
