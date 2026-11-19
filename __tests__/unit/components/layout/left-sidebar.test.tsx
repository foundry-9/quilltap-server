/**
 * The grouped rail (navigation-menus §5): drawn from the registry, four group
 * buttons with flyout menus, one flyout at a time, keyboard movement, focus
 * return, aria-current on the right button, disabled rows with their reason,
 * and the Electron shell's native-menu bridge running the same activators.
 */

import React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { LeftSidebar } from '@/components/layout/left-sidebar'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { usePathname } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { useBrahmaConsoleOptional } from '@/components/providers/brahma-console-provider'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useNewChatModalOptional } from '@/components/providers/new-chat-provider'

jest.mock('next/navigation', () => ({ usePathname: jest.fn(), useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next/dynamic', () => () => () => null)
jest.mock('@/components/providers/workspace-provider', () => ({ useWorkspaceOptional: jest.fn() }))
jest.mock('@/components/providers/help-chat-provider', () => ({
  useHelpChatOptional: () => ({ isEligible: true, eligibilityLoading: false, openHelpChat: jest.fn() }),
}))
jest.mock('@/components/providers/brahma-console-provider', () => ({ useBrahmaConsoleOptional: jest.fn() }))
jest.mock('@/components/providers/wardrobe-dialog-provider', () => ({ useWardrobeDialogOptional: jest.fn() }))
jest.mock('@/components/providers/inventory-dialog-provider', () => ({ useInventoryDialogOptional: () => ({ open: jest.fn() }) }))
jest.mock('@/components/providers/atlas-dialog-provider', () => ({ useAtlasDialogOptional: () => ({ open: jest.fn() }) }))
jest.mock('@/components/providers/new-chat-provider', () => ({ useNewChatModalOptional: jest.fn() }))
jest.mock('@/components/providers/quick-hide-provider', () => ({
  useQuickHide: () => ({ hiddenTagIds: new Set(), hideDangerousChats: false, hideSalonImages: false }),
}))
jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ data: { user: { name: 'Specimen' } } }),
}))
jest.mock('@/components/dashboard/nav-user-menu-theme', () => ({
  NavUserMenuThemeContent: () => <button type="button">Earl Grey</button>,
}))
jest.mock('@/components/dashboard/nav-user-menu-quick-hide', () => ({
  NavUserMenuQuickHideContent: () => <p>Hide things</p>,
  QuickHideIcon: () => <span />,
}))
jest.mock('@/lib/hooks/use-character-wardrobe-items', () => ({ chatProjectIdQuery: jest.fn() }))

const mockPathname = usePathname as jest.Mock
const mockWorkspace = useWorkspaceOptional as jest.Mock
const mockBrahma = useBrahmaConsoleOptional as jest.Mock
const mockWardrobe = useWardrobeDialogOptional as jest.Mock
const mockNewChat = useNewChatModalOptional as jest.Mock

function workspaceShowing(left: string, right?: string, focusedPane: 'left' | 'right' = 'left') {
  return {
    openTab: jest.fn(),
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
  return Array.from(document.querySelectorAll('.qt-left-sidebar [aria-current="page"]')).map((el) => el.getAttribute('data-nav') ?? '')
}

function railButton(nav: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>('.qt-left-sidebar [data-nav]')).find((b) => b.dataset.nav === nav)
  if (!el) throw new Error(`no rail button ${nav}`)
  return el
}

describe('LeftSidebar', () => {
  let ws: ReturnType<typeof workspaceShowing>

  beforeEach(() => {
    ws = workspaceShowing('home')
    mockPathname.mockReturnValue('/workspace')
    mockWorkspace.mockReturnValue(ws)
    mockBrahma.mockReturnValue({ isEligible: true, openConsole: jest.fn() })
    mockWardrobe.mockReturnValue({ open: jest.fn() })
    mockNewChat.mockReturnValue({ open: jest.fn() })
    delete (window as { quilltap?: unknown }).quilltap
  })

  it('draws ten buttons from the registry', () => {
    renderWithQuery(<LeftSidebar />)
    const top = Array.from(document.querySelectorAll('.qt-collapsed-nav-button')).map((el) => el.getAttribute('data-nav'))
    expect(top).toEqual(['home', 'characters', 'conversations', 'objects', 'library', 'studio'])
    const pinned = Array.from(document.querySelectorAll('.qt-left-sidebar-item')).map((el) => el.getAttribute('data-nav'))
    expect(pinned).toEqual(['help', 'quick-hide', 'settings'])
    expect(screen.getByRole('button', { name: 'User menu' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-haspopup', 'menu')
  })

  it.each([
    ['character', ['characters']],
    ['salon', ['conversations']],
    ['brahma', ['conversations']],
    ['files', ['library']],
    ['theme-editor', ['studio']],
    ['settings', ['settings']],
    ['profile', []],
  ])('marks the button for a %s tab', (kind, expected) => {
    mockWorkspace.mockReturnValue(workspaceShowing(kind))
    renderWithQuery(<LeftSidebar />)
    expect(current()).toEqual(expected)
  })

  it('follows the focused pane', () => {
    mockWorkspace.mockReturnValue(workspaceShowing('salon', 'atlas', 'right'))
    renderWithQuery(<LeftSidebar />)
    expect(current()).toEqual(['objects'])
  })

  it('outside the workspace, follows the route', () => {
    mockPathname.mockReturnValue('/prospero')
    mockWorkspace.mockReturnValue(null)
    renderWithQuery(<LeftSidebar />)
    expect(current()).toEqual(['library'])
  })

  it('opens a group’s flyout with its label and rows, one flyout at a time', () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('library'))
    expect(railButton('library')).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Library' })
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Projects', 'Files', 'The Scriptorium', 'My Photos', 'Open Document…',
    ])
    expect(within(menu).getByRole('menuitem', { name: 'Files' })).toHaveAttribute('href', '/files')

    fireEvent.click(railButton('studio'))
    expect(screen.queryByRole('menu', { name: 'Library' })).toBeNull()
    expect(screen.getByRole('menu', { name: 'Studio' })).toBeInTheDocument()
    expect(railButton('library')).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(railButton('studio'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves with the arrow keys, Home and End, and Escape returns focus', async () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.keyDown(railButton('objects'), { key: 'ArrowRight' })
    const menu = screen.getByRole('menu', { name: 'Objects' })
    const rows = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(rows[0]).toHaveFocus())
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(rows[1]).toHaveFocus()
    fireEvent.keyDown(rows[1], { key: 'End' })
    expect(rows[rows.length - 1]).toHaveFocus()
    fireEvent.keyDown(rows[rows.length - 1], { key: 'ArrowDown' })
    expect(rows[0]).toHaveFocus()
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' })
    expect(rows[rows.length - 1]).toHaveFocus()
    fireEvent.keyDown(rows[rows.length - 1], { key: 'Home' })
    expect(rows[0]).toHaveFocus()
    fireEvent.keyDown(rows[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(railButton('objects')).toHaveFocus())
  })

  it('closes on an outside click', () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('conversations'))
    expect(screen.getByRole('menu', { name: 'Conversations' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a destination as a tab in place and closes the flyout', () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('library'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'The Scriptorium' }))
    expect(ws.openTab).toHaveBeenCalledWith('scriptorium', undefined)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(railButton('conversations'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Brahma Console' }))
    expect(ws.openTab).toHaveBeenCalledWith('brahma', undefined)
  })

  it('runs an action: New Chat… opens the modal', () => {
    const open = jest.fn()
    mockNewChat.mockReturnValue({ open })
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('conversations'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Chat…' }))
    expect(open).toHaveBeenCalled()
  })

  it('shows a disabled row with its reason and does nothing on a click', () => {
    mockBrahma.mockReturnValue({ isEligible: false, openConsole: jest.fn() })
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('conversations'))
    const row = screen.getByRole('menuitem', { name: /Brahma Console/ })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAccessibleDescription('Needs a connection profile')
    fireEvent.click(row)
    expect(ws.openTab).not.toHaveBeenCalled()
  })

  it('opens the theme panel from Studio, hung from the Studio button', async () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('studio'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme…' }))
    const panel = screen.getByRole('dialog', { name: 'Theme' })
    expect(within(panel).getByRole('button', { name: 'Earl Grey' })).toBeInTheDocument()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(railButton('studio')).toHaveFocus())
  })

  it('closes a panel on Escape even after its content drops focus to the page', () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('quick-hide'))
    expect(screen.getByRole('dialog', { name: 'Quick-hide' })).toBeInTheDocument()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Quick-hide one click from the rail', () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('quick-hide'))
    expect(railButton('quick-hide')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Quick-hide' })).toBeInTheDocument()
  })

  it('opens the profile menu', () => {
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }))
    expect(ws.openTab).toHaveBeenCalledWith('about', undefined)
  })

  it('outside the workspace, opens the Wardrobe dialog', () => {
    const open = jest.fn()
    mockWardrobe.mockReturnValue({ open })
    mockPathname.mockReturnValue('/settings')
    renderWithQuery(<LeftSidebar />)
    fireEvent.click(railButton('objects'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wardrobe' }))
    expect(open).toHaveBeenCalledWith()
    expect(ws.openTab).not.toHaveBeenCalled()
  })

  it('runs a native menu click through the same activator', () => {
    let handler: ((id: string) => void) | undefined
    const unsubscribe = jest.fn()
    ;(window as { quilltap?: unknown }).quilltap = {
      onNavigate: (fn: (id: string) => void) => {
        handler = fn
        return unsubscribe
      },
    }
    const { unmount } = renderWithQuery(<LeftSidebar />)
    expect(handler).toBeDefined()
    act(() => handler!('atlas'))
    expect(ws.openTab).toHaveBeenCalledWith('atlas', undefined)
    act(() => handler!('not-a-thing'))
    expect(ws.openTab).toHaveBeenCalledTimes(1)
    act(() => handler!('themes'))
    expect(screen.getByRole('dialog', { name: 'Theme' })).toBeInTheDocument()
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
