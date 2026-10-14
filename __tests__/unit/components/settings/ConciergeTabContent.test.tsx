/**
 * Tests for the Concierge's own Settings tab (Settings → The Concierge).
 *
 * Pins what the deep links and the help promise: the five sections exist under
 * their stable ids, `?section=uncensored-desk` opens and scrolls to the desk,
 * the collapsed-by-default pre-screen opens for its own deep link, and a house
 * with no uncensored-compatible profile is told where to tick one.
 */

import React from 'react'
import { screen, within, act } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ConciergeTabContent } from '@/components/settings/tabs/ConciergeTabContent'
import { DEFAULT_CONCIERGE_SETTINGS } from '@/components/settings/chat-settings/types'
import type { ConnectionProfile, ImageProfile } from '@/components/settings/chat-settings/types'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

jest.mock('@/components/ui/icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

jest.mock('@/components/providers/theme-provider', () => ({
  useSubsystemInfo: () => ({
    id: 'concierge',
    name: 'The Concierge',
    description: 'Who gets asked when the usual providers refuse, and how flagged content is shown',
  }),
}))

const mockSection = { current: null as string | null }
jest.mock('@/components/settings/tabs/useSettingsSection', () => ({
  useSettingsSection: () => mockSection.current,
}))

const mockHandleConciergeUpdate = jest.fn(async () => {})
const mockContext = {
  current: {} as Record<string, unknown>,
}
jest.mock('@/components/settings/chat-settings/ChatSettingsProvider', () => ({
  useChatSettingsContext: () => mockContext.current,
}))

const SECTION_IDS = ['on-duty', 'uncensored-desk', 'refusals', 'display', 'pre-screening']

function makeContext(overrides: {
  connectionProfiles?: ConnectionProfile[]
  imageProfiles?: ImageProfile[]
} = {}) {
  return {
    settings: { conciergeSettings: DEFAULT_CONCIERGE_SETTINGS },
    loading: false,
    saving: false,
    loadingProfiles: false,
    connectionProfiles: overrides.connectionProfiles ?? [],
    imageProfiles: overrides.imageProfiles ?? [],
    handleConciergeUpdate: mockHandleConciergeUpdate,
  }
}

function sectionHeader(sectionId: string): HTMLElement {
  const section = document.getElementById(sectionId)
  if (!section) throw new Error(`section ${sectionId} not rendered`)
  return within(section).getAllByRole('button')[0]
}

describe('ConciergeTabContent', () => {
  let scrollIntoView: jest.Mock
  let rafSpy: jest.SpyInstance

  beforeEach(() => {
    mockSection.current = null
    mockHandleConciergeUpdate.mockClear()
    scrollIntoView = jest.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    rafSpy.mockRestore()
  })

  it('renders the five sections under their stable ids', () => {
    mockContext.current = makeContext()
    renderWithQuery(<ConciergeTabContent />)

    for (const id of SECTION_IDS) {
      expect(document.getElementById(id)).not.toBeNull()
    }
    expect(screen.getByText('On Duty')).toBeInTheDocument()
    expect(screen.getByText('The Uncensored Desk')).toBeInTheDocument()
    expect(screen.getByText('When a Provider Refuses')).toBeInTheDocument()
    expect(screen.getByText('Display')).toBeInTheDocument()
    expect(screen.getByText('Pre-Screening (Advanced)')).toBeInTheDocument()
  })

  it('keeps pre-screening collapsed by default', () => {
    mockContext.current = makeContext()
    renderWithQuery(<ConciergeTabContent />)

    expect(sectionHeader('pre-screening')).toHaveAttribute('aria-expanded', 'false')
    expect(sectionHeader('uncensored-desk')).toHaveAttribute('aria-expanded', 'true')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('force-opens and scrolls to the desk for ?section=uncensored-desk', async () => {
    mockSection.current = 'uncensored-desk'
    mockContext.current = makeContext()
    await act(async () => {
      renderWithQuery(<ConciergeTabContent />)
    })

    expect(sectionHeader('uncensored-desk')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Text profile')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('uncensored-desk'))
  })

  it('opens the collapsed pre-screen for ?section=pre-screening', async () => {
    mockSection.current = 'pre-screening'
    mockContext.current = makeContext()
    await act(async () => {
      renderWithQuery(<ConciergeTabContent />)
    })

    expect(sectionHeader('pre-screening')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Pre-screen before sending')).toBeInTheDocument()
  })

  it('points at AI Providers and Images when no profile is uncensored-compatible', () => {
    mockContext.current = makeContext({
      connectionProfiles: [
        { id: 'p1', name: 'Prim', provider: 'OPENAI', modelName: 'gpt', isDefault: true, isDangerousCompatible: false },
      ],
    })
    renderWithQuery(<ConciergeTabContent />)

    const desk = document.getElementById('uncensored-desk') as HTMLElement
    expect(within(desk).getByRole('link', { name: 'AI Providers' })).toHaveAttribute('href', '/settings?tab=providers')
    expect(within(desk).getByRole('link', { name: 'Images' })).toHaveAttribute('href', '/settings?tab=images')
  })

  it('lists only uncensored-compatible profiles on the desk, and says nothing about ticking one', () => {
    mockContext.current = makeContext({
      connectionProfiles: [
        { id: 'p1', name: 'Prim', provider: 'OPENAI', modelName: 'gpt', isDefault: true, isDangerousCompatible: false },
        { id: 'p2', name: 'Candid', provider: 'GROK', modelName: 'grok', isDefault: false, isDangerousCompatible: true },
      ],
    })
    renderWithQuery(<ConciergeTabContent />)

    const desk = document.getElementById('uncensored-desk') as HTMLElement
    expect(within(desk).queryByRole('link', { name: 'AI Providers' })).toBeNull()
    const textSelect = screen.getByLabelText('Text profile') as HTMLSelectElement
    const optionLabels = Array.from(textSelect.options).map((o) => o.textContent)
    expect(optionLabels.some((l) => l?.includes('Candid'))).toBe(true)
    expect(optionLabels.some((l) => l?.includes('Prim'))).toBe(false)

    // The crafter may be any connection profile.
    const crafter = screen.getByLabelText('Image prompt crafter') as HTMLSelectElement
    const crafterLabels = Array.from(crafter.options).map((o) => o.textContent)
    expect(crafterLabels[0]).toBe('Use the cheap LLM')
    expect(crafterLabels.some((l) => l?.includes('Prim'))).toBe(true)
  })
})
