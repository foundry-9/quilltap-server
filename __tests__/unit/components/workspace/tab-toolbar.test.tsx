/**
 * Per-tab page toolbar: two panes showing different surfaces must show their
 * own injected toolbar content, and `usePageToolbar()` inside a tab must keep
 * working unchanged (resolving to the nearest, per-tab provider).
 */

import { useEffect } from 'react'
import { render, screen, within } from '@testing-library/react'
import { usePageToolbar } from '@/components/providers/page-toolbar-provider'
import {
  TabToolbarRegistryProvider,
  TabToolbarProvider,
  PaneToolbar,
} from '@/components/workspace/tab-toolbar'

/** A surface that injects left toolbar content, like SalonView does. */
function LeftInjector({ text }: { text: string }) {
  const { setLeftContent } = usePageToolbar()
  useEffect(() => {
    setLeftContent(<span>{text}</span>)
  }, [text, setLeftContent])
  return <div>body:{text}</div>
}

describe('per-tab toolbar', () => {
  it('renders each pane its own active tab toolbar content', () => {
    render(
      <TabToolbarRegistryProvider>
        <TabToolbarProvider tabId="A">
          <LeftInjector text="A-left" />
        </TabToolbarProvider>
        <TabToolbarProvider tabId="B">
          <LeftInjector text="B-left" />
        </TabToolbarProvider>
        <div data-testid="pane-a">
          <PaneToolbar activeTabId="A" />
        </div>
        <div data-testid="pane-b">
          <PaneToolbar activeTabId="B" />
        </div>
      </TabToolbarRegistryProvider>
    )

    const paneA = within(screen.getByTestId('pane-a'))
    const paneB = within(screen.getByTestId('pane-b'))

    expect(paneA.getByText('A-left')).toBeInTheDocument()
    expect(paneA.queryByText('B-left')).toBeNull()
    expect(paneB.getByText('B-left')).toBeInTheDocument()
    expect(paneB.queryByText('A-left')).toBeNull()
  })

  it('renders nothing for a pane whose active tab injected no content', () => {
    const { container } = render(
      <TabToolbarRegistryProvider>
        <PaneToolbar activeTabId="ghost" />
      </TabToolbarRegistryProvider>
    )
    expect(container.querySelector('.qt-pane-toolbar')).toBeNull()
  })

  it('drops a tab toolbar entry when its provider unmounts (tab closed)', () => {
    function Harness({ showB }: { showB: boolean }) {
      return (
        <TabToolbarRegistryProvider>
          {showB && (
            <TabToolbarProvider tabId="B">
              <LeftInjector text="B-left" />
            </TabToolbarProvider>
          )}
          <div data-testid="pane-b">
            <PaneToolbar activeTabId="B" />
          </div>
        </TabToolbarRegistryProvider>
      )
    }
    const { rerender } = render(<Harness showB />)
    expect(within(screen.getByTestId('pane-b')).getByText('B-left')).toBeInTheDocument()

    rerender(<Harness showB={false} />)
    expect(within(screen.getByTestId('pane-b')).queryByText('B-left')).toBeNull()
  })
})
