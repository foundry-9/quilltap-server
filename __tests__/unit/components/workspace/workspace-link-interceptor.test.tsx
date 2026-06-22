/**
 * The global link interceptor must open tab-equivalent links in place (no
 * navigation) while in the workspace, de-dupe singletons, and never double-handle
 * a link that already prevented default (the rail / recent-chat path).
 */

/* Raw <a> elements are intentional here — they simulate the un-wired links
   (e.g. the Settings footer) the interceptor is meant to catch. */
/* eslint-disable @next/next/no-html-link-for-pages */

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace',
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import { WorkspaceLinkInterceptor } from '@/components/workspace/WorkspaceLinkInterceptor'

function Probe() {
  const { state } = useWorkspace()
  const kinds = Object.values(state.tabs)
    .map((t) => t.kind)
    .sort()
  return <div data-testid="kinds">{kinds.join(',')}</div>
}

function countKind(kind: string) {
  return screen.getByTestId('kinds').textContent!.split(',').filter((k) => k === kind).length
}

function setup() {
  return render(
    <WorkspaceProvider>
      <WorkspaceLinkInterceptor />
      <Probe />
      <a href="/settings" data-testid="settings">Settings</a>
      <a href="/aurora" data-testid="aurora">Aurora</a>
      {/* No tab equivalent → must NOT be intercepted (left to navigate). The
          onClick prevents jsdom's unimplemented-navigation noise. */}
      <a href="/aurora/new" data-testid="newchar" onClick={(e) => e.preventDefault()}>New character</a>
      <a href="https://example.com" data-testid="ext" onClick={(e) => e.preventDefault()}>External</a>
    </WorkspaceProvider>
  )
}

describe('WorkspaceLinkInterceptor', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens a tab-equivalent link in place instead of navigating', () => {
    setup()
    expect(screen.getByTestId('kinds')).toHaveTextContent('home')
    fireEvent.click(screen.getByTestId('settings'))
    expect(countKind('settings')).toBe(1)
    fireEvent.click(screen.getByTestId('aurora'))
    expect(countKind('aurora')).toBe(1)
  })

  it('de-dupes singleton tabs on repeated clicks', () => {
    setup()
    fireEvent.click(screen.getByTestId('settings'))
    fireEvent.click(screen.getByTestId('settings'))
    expect(countKind('settings')).toBe(1)
  })

  it('leaves links with no tab equivalent (and external links) alone', () => {
    setup()
    const before = screen.getByTestId('kinds').textContent
    fireEvent.click(screen.getByTestId('newchar'))
    fireEvent.click(screen.getByTestId('ext'))
    expect(screen.getByTestId('kinds').textContent).toBe(before)
  })
})
