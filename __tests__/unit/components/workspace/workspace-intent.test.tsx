/**
 * WorkspaceIntent applies a transient `?open=` intent — the target the Phase 6
 * old-route redirects point at — opening the right tab (with payload) and then
 * stripping the params back to a clean `/workspace`.
 */

let mockParams = new URLSearchParams()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockParams,
}))

import { render, screen } from '@testing-library/react'
import { WorkspaceProvider, useWorkspace } from '@/components/providers/workspace-provider'
import { WorkspaceIntent } from '@/components/workspace/WorkspaceIntent'

function Probe() {
  const { state } = useWorkspace()
  const entries = Object.values(state.tabs)
    .map((t) => {
      const p = (t.payload ?? {}) as { characterId?: string; tab?: string }
      return `${t.kind}:${p.characterId ?? ''}:${p.tab ?? ''}`
    })
    .sort()
  return <div data-testid="tabs">{entries.join('|')}</div>
}

function setup(search: string) {
  mockParams = new URLSearchParams(search)
  mockReplace.mockClear()
  return render(
    <WorkspaceProvider>
      <WorkspaceIntent />
      <Probe />
    </WorkspaceProvider>
  )
}

describe('WorkspaceIntent', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens a standalone-page kind from ?open= and strips the params', () => {
    setup('open=profile')
    expect(screen.getByTestId('tabs').textContent).toContain('profile::')
    expect(mockReplace).toHaveBeenCalledWith('/workspace')
  })

  it('opens the character editor with its characterId + tab payload', () => {
    setup('open=character-edit&characterId=abc&tab=system-prompts')
    expect(screen.getByTestId('tabs').textContent).toContain('character-edit:abc:system-prompts')
  })

  it('skips character-edit when the characterId is missing', () => {
    setup('open=character-edit')
    expect(screen.getByTestId('tabs').textContent).not.toContain('character-edit')
  })

  it('ignores an unknown open kind (only the default home tab remains)', () => {
    setup('open=bogus')
    expect(screen.getByTestId('tabs').textContent).toBe('home::')
  })
})
