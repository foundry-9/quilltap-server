/**
 * The left rail's navigation hooks (Calliope Live, Spec B): every item says
 * which it is in `data-nav`, and the one standing for the surface on show —
 * the focused workspace pane's active tab, or the route outside the
 * workspace — carries aria-current="page". No item carries it when none
 * corresponds.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { CollapsedNav } from '@/components/layout/left-sidebar/collapsed-nav'
import { usePathname } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'

jest.mock('next/navigation', () => ({ usePathname: jest.fn() }))
jest.mock('@/components/providers/workspace-provider', () => ({ useWorkspaceOptional: jest.fn() }))
jest.mock('@/components/workspace/useWorkspaceLink', () => ({ useWorkspaceLink: () => () => false }))

const mockPathname = usePathname as jest.Mock
const mockWorkspace = useWorkspaceOptional as jest.Mock

function workspaceShowing(left: string, right?: string, focusedPane: 'left' | 'right' = 'left') {
  return {
    state: {
      tabs: {
        a: { id: 'a', kind: left, title: 'A' },
        ...(right ? { b: { id: 'b', kind: right, title: 'B' } } : {}),
      },
      panes: {
        left: { order: ['a'], activeTabId: 'a' },
        right: right ? { order: ['b'], activeTabId: 'b' } : null,
      },
      focusedPane,
      splitRatio: 0.5,
    },
  }
}

function current(): string[] {
  return Array.from(document.querySelectorAll('[aria-current="page"]')).map((el) => el.getAttribute('data-nav') ?? '')
}

describe('CollapsedNav hooks', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/workspace')
    mockWorkspace.mockReturnValue(workspaceShowing('home'))
  })

  it('names every item in data-nav, the brand link as home', () => {
    render(<CollapsedNav />)
    const ids = Array.from(document.querySelectorAll('.qt-collapsed-nav-button')).map((el) => el.getAttribute('data-nav'))
    expect(ids).toEqual(['home', 'projects', 'files', 'scriptorium', 'characters', 'photos', 'scenarios', 'custom-tools', 'chats'])
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('data-nav', 'home')
  })

  it('marks the item for the focused pane’s active tab', () => {
    mockWorkspace.mockReturnValue(workspaceShowing('home', 'character', 'right'))
    render(<CollapsedNav />)
    expect(current()).toEqual(['characters'])
  })

  it('follows the left pane when it has the focus', () => {
    mockWorkspace.mockReturnValue(workspaceShowing('salon', 'character', 'left'))
    render(<CollapsedNav />)
    expect(current()).toEqual(['chats'])
  })

  it('marks nothing when the tab on show has no rail item', () => {
    mockWorkspace.mockReturnValue(workspaceShowing('brahma'))
    render(<CollapsedNav />)
    expect(current()).toEqual([])
  })

  it('outside the workspace, follows the route', () => {
    mockPathname.mockReturnValue('/prospero')
    mockWorkspace.mockReturnValue(null)
    render(<CollapsedNav />)
    expect(current()).toEqual(['projects'])
  })
})
