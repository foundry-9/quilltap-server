/**
 * Regression tests: a dynamic-backgrounds collage takes precedence over a
 * theme's home-page pictures.
 *
 * - 3a8df9d51: the home tab did not mark its root with `--story-background-url`,
 *   so the theme's `--qt-page-background-image` was painted over the collage.
 *   `HomeViewContainer` now passes the collage URL to `HomeView`, which marks
 *   its root.
 * - a6ed5800c: Madman's Box paints its own home photograph on
 *   `.qt-homepage-container::before`; `HomeView` now adds the catalogued
 *   `qt-homepage-backdrop` state class while a collage shows, so the theme
 *   can stand aside.
 */

import { screen } from '@testing-library/react'
import React from 'react'
import { HomeView } from '@/components/homepage/HomeView'
import { HomeViewContainer } from '@/components/homepage/HomeViewContainer'
import { renderWithQuery as render } from '../../../helpers/renderWithQuery'
import { HOME_HOOKS } from '@/lib/themes/hooks/home'

jest.mock('@/components/homepage', () => ({
  WelcomeSection: () => <div data-testid="welcome" />,
  QuickActionsRow: () => <div data-testid="quick-actions" />,
  RecentChatsSection: () => <div data-testid="recent-chats" />,
  ProjectsSection: () => <div data-testid="projects" />,
  CharactersSection: () => <div data-testid="characters" />,
}))

const mockUseDynamicBackground = jest.fn()
jest.mock('@/hooks/useDynamicBackground', () => ({
  useDynamicBackground: (...args: unknown[]) => mockUseDynamicBackground(...args),
}))

const mockApiFetch = jest.fn()
jest.mock('@/lib/query/fetcher', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

const mockReportBackdrop = jest.fn()
jest.mock('@/components/workspace/workspace-backdrop', () => ({
  useReportWorkspaceBackdrop: (...args: unknown[]) => mockReportBackdrop(...args),
}))

const baseProps = {
  displayName: 'Bertie',
  lastChatId: null,
  recentChats: [],
  projects: [],
  characters: [],
}

function homeRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector('.qt-homepage-container')
  if (!root) throw new Error('home root not rendered')
  return root as HTMLElement
}

describe('HomeView with a dynamic background', () => {
  it('marks its root with --story-background-url and the backdrop state while a collage shows', () => {
    const { container } = render(<HomeView {...baseProps} backgroundUrl="/api/v1/system/dynamic-backgrounds?page=home&seed=1" />)
    const root = homeRoot(container)

    expect(root.style.getPropertyValue('--story-background-url')).toBe(
      "url('/api/v1/system/dynamic-backgrounds?page=home&seed=1')",
    )
    expect(root.classList.contains('qt-homepage-backdrop')).toBe(true)
  })

  it.each([undefined, null, ''])('leaves the root unmarked without a collage (%p)', (backgroundUrl) => {
    const { container } = render(<HomeView {...baseProps} backgroundUrl={backgroundUrl as string | null | undefined} />)
    const root = homeRoot(container)

    expect(root.getAttribute('style')).toBeNull()
    expect(root.classList.contains('qt-homepage-backdrop')).toBe(false)
  })

  it('catalogues qt-homepage-backdrop as a state of the home container hook', () => {
    const states = HOME_HOOKS.flatMap((hook) => hook.states ?? [])
    expect(states).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'class', className: 'qt-homepage-backdrop' })]),
    )
  })
})

describe('HomeViewContainer', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockUseDynamicBackground.mockReset()
    mockReportBackdrop.mockReset()
    mockApiFetch.mockResolvedValue(baseProps)
  })

  it('hands the home collage to HomeView so the theme background stands aside', async () => {
    mockUseDynamicBackground.mockReturnValue('/collage/home.webp')
    const { container } = render(<HomeViewContainer />)

    await screen.findByTestId('welcome')
    const root = homeRoot(container)
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/system/home', expect.anything())
    expect(mockUseDynamicBackground).toHaveBeenCalledWith('home')
    expect(root.style.getPropertyValue('--story-background-url')).toBe("url('/collage/home.webp')")
    expect(root.classList.contains('qt-homepage-backdrop')).toBe(true)
  })

  it('renders an unmarked root when dynamic backgrounds are off', async () => {
    mockUseDynamicBackground.mockReturnValue(null)
    const { container } = render(<HomeViewContainer />)

    await screen.findByTestId('welcome')
    const root = homeRoot(container)
    expect(root.style.getPropertyValue('--story-background-url')).toBe('')
    expect(root.classList.contains('qt-homepage-backdrop')).toBe(false)
  })
})
