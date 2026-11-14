/**
 * The Foundry (Settings page) rendered through the registry: the rail, deep
 * links old and new, search, the persona lens, badges, the default-group rule,
 * and the Moderation group with the Concierge's real card bodies (this file
 * replaces the old ConciergeTabContent test).
 */

import React from 'react'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { DEFAULT_CONCIERGE_SETTINGS } from '@/components/settings/chat-settings/types'
import type { ConnectionProfile, ImageProfile } from '@/components/settings/chat-settings/types'
import type { AttentionChip } from '@/components/settings/AttentionStrip'
import { SettingsView } from '@/app/settings/SettingsView'

const mockSearch = { current: new URLSearchParams() }
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearch.current,
  usePathname: () => '/settings',
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

jest.mock('@/components/ui/icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}))

const mockBackdrop = jest.fn()
jest.mock('@/components/providers/theme-provider', () => {
  const { DEFAULT_SUBSYSTEM_DEFINITIONS, CHILD_SUBSYSTEM_IDS } = jest.requireActual('@/lib/foundry/subsystem-defaults')
  return {
    useSubsystemInfo: (id: string) => DEFAULT_SUBSYSTEM_DEFINITIONS[id],
    useAllSubsystemInfo: () => CHILD_SUBSYSTEM_IDS.map((id: string) => DEFAULT_SUBSYSTEM_DEFINITIONS[id]),
    useSubsystemBackgroundStyle: (id: string) => {
      mockBackdrop(id)
      return undefined
    },
  }
})

const mockContext = { current: {} as Record<string, unknown> }
jest.mock('@/components/settings/chat-settings/ChatSettingsProvider', () => ({
  ChatSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useChatSettingsContext: () => mockContext.current,
}))

const mockChips = { current: [] as AttentionChip[] }
jest.mock('@/components/settings/AttentionStrip', () => ({
  ...jest.requireActual('@/components/settings/AttentionStrip'),
  useAttentionChips: () => ({ chips: mockChips.current, ready: true }),
}))

// Card bodies: the Moderation group's are real; the rest are labelled stubs.
jest.mock('@/components/settings/cards', () => {
  const moderation = jest.requireActual('@/components/settings/cards/moderation-cards')
  const real: Record<string, unknown> = {
    'on-duty': moderation.OnDutyCard,
    'uncensored-desk': moderation.UncensoredDeskCard,
    refusals: moderation.RefusalsCard,
    display: moderation.DisplayCard,
    'pre-screening': moderation.PreScreeningCard,
  }
  const { SETTINGS_CARDS } = jest.requireActual('@/lib/settings/registry')
  const map: Record<string, unknown> = {}
  for (const card of SETTINGS_CARDS as { id: string }[]) {
    map[card.id] =
      real[card.id] ??
      (({ focusCard, focusProvider }: { focusCard?: string | null; focusProvider?: string | null }) => (
        <div data-testid={`body-${card.id}`} data-focus={focusCard ?? ''} data-provider={focusProvider ?? ''} />
      ))
  }
  return { SETTINGS_CARD_COMPONENTS: map }
})

function makeContext(overrides: { connectionProfiles?: ConnectionProfile[]; imageProfiles?: ImageProfile[] } = {}) {
  return {
    settings: { conciergeSettings: DEFAULT_CONCIERGE_SETTINGS },
    loading: false,
    saving: false,
    loadingProfiles: false,
    connectionProfiles: overrides.connectionProfiles ?? [],
    imageProfiles: overrides.imageProfiles ?? [],
    embeddingProfiles: [],
    handleConciergeUpdate: jest.fn(async () => {}),
  }
}

function header(cardId: string): HTMLElement {
  const card = document.getElementById(cardId)
  if (!card) throw new Error(`card ${cardId} not rendered`)
  return within(card).getAllByRole('button')[0]
}

function rail(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Settings sections' })
}

function currentGroup(): string | null {
  return within(rail()).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.textContent ?? null
}

async function renderAt(query: string) {
  mockSearch.current = new URLSearchParams(query)
  await act(async () => {
    renderWithQuery(<SettingsView />)
  })
}

describe('SettingsView', () => {
  let scrollIntoView: jest.Mock
  let rafSpy: jest.SpyInstance

  beforeEach(() => {
    mockContext.current = makeContext()
    mockChips.current = []
    mockReplace.mockClear()
    mockBackdrop.mockClear()
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

  it('titles the page The Foundry and keeps the word Settings', async () => {
    await renderAt('')
    expect(screen.getByRole('heading', { level: 1, name: 'The Foundry' })).toBeInTheDocument()
    expect(screen.getByText(/Settings — configure/)).toBeInTheDocument()
  })

  it('lists the ten groups in order on the rail', async () => {
    await renderAt('')
    expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Connections', 'Composer & Display', 'Context & Memory', 'Characters & Prompts', 'Images',
      'Games & Tools', 'Moderation', 'Appearance', 'Security', 'Data & Maintenance',
    ])
  })

  it('opens a group from the rail and writes ?group=', async () => {
    await renderAt('')
    fireEvent.click(within(rail()).getByRole('button', { name: 'Security' }))
    expect(currentGroup()).toBe('Security')
    expect(document.getElementById('encryption-passphrase')).not.toBeNull()
    expect(mockReplace).toHaveBeenCalledWith('/settings?group=security', { scroll: false })
  })

  describe('default group', () => {
    it('opens Connections with nothing lit, and shows no strip', async () => {
      await renderAt('')
      expect(currentGroup()).toBe('Connections')
      expect(screen.queryByRole('list', { name: 'Settings that need attention' })).toBeNull()
    })

    it('opens Moderation when the only lit chip is the Concierge off duty', async () => {
      mockChips.current = [{ id: 'concierge-off-duty', label: 'The Concierge is off duty', card: 'on-duty', group: 'moderation' }]
      await renderAt('')
      expect(currentGroup()).toBe('Moderation')
    })

    it('opens Connections for a missing key, with the chip linking to the Providers card', async () => {
      mockChips.current = [
        { id: 'profile-key', label: '“Prim” is missing its key or provider', card: 'providers', group: 'connections' },
        { id: 'concierge-off-duty', label: 'The Concierge is off duty', card: 'on-duty', group: 'moderation' },
      ]
      await renderAt('')
      expect(currentGroup()).toBe('Connections')
      const strip = screen.getByRole('list', { name: 'Settings that need attention' })
      expect(within(strip).getByRole('link', { name: /missing its key/ })).toHaveAttribute('href', '/settings?section=providers')
    })

    it('does not override an explicit address', async () => {
      mockChips.current = [{ id: 'concierge-off-duty', label: 'The Concierge is off duty', card: 'on-duty', group: 'moderation' }]
      await renderAt('group=images')
      expect(currentGroup()).toBe('Images')
    })
  })

  describe('deep links', () => {
    it('opens the card’s group, opens the card and scrolls to it for ?section=', async () => {
      await renderAt('section=taboo')
      expect(currentGroup()).toBe('Characters & Prompts')
      expect(header('taboo')).toHaveAttribute('aria-expanded', 'true')
      expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('taboo'))
    })

    it('lands a legacy tab + section on the card’s new home', async () => {
      await renderAt('tab=chat&section=taboo')
      expect(currentGroup()).toBe('Characters & Prompts')
    })

    it('bridges a legacy tab alone to its group', async () => {
      await renderAt('tab=system')
      expect(currentGroup()).toBe('Data & Maintenance')
    })

    it('opens the Providers card, focused on a hosted kind card, for ?section=image-profiles', async () => {
      await renderAt('section=image-profiles')
      expect(currentGroup()).toBe('Connections')
      expect(header('providers')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('body-providers')).toHaveAttribute('data-focus', 'image-profiles')
    })
  })

  it('hands a provider to the Providers card for ?section=providers&provider=', async () => {
    await renderAt('section=providers&provider=OPENAI')
    expect(header('providers')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('body-providers')).toHaveAttribute('data-provider', 'OPENAI')
  })

  describe('the Moderation group', () => {
    const SECTION_IDS = ['on-duty', 'uncensored-desk', 'refusals', 'display', 'pre-screening']

    it('renders the Concierge’s five cards under their stable ids', async () => {
      await renderAt('group=moderation')
      for (const id of SECTION_IDS) expect(document.getElementById(id)).not.toBeNull()
      expect(screen.getByText('The Uncensored Desk')).toBeInTheDocument()
    })

    it('puts pre-screening below the Advanced divider, collapsed', async () => {
      await renderAt('group=moderation')
      expect(screen.getByRole('separator')).toHaveTextContent('Advanced')
      expect(header('pre-screening')).toHaveAttribute('aria-expanded', 'false')
      expect(header('uncensored-desk')).toHaveAttribute('aria-expanded', 'true')
      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('force-opens and scrolls to the desk for ?section=uncensored-desk', async () => {
      await renderAt('section=uncensored-desk')
      expect(header('uncensored-desk')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('Text profile')).toBeInTheDocument()
      expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('uncensored-desk'))
    })

    it('opens the collapsed pre-screen for ?section=pre-screening', async () => {
      await renderAt('section=pre-screening')
      expect(header('pre-screening')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Pre-screen before sending')).toBeInTheDocument()
    })

    it('points at the connection and image profiles when no profile is uncensored-compatible', async () => {
      mockContext.current = makeContext({
        connectionProfiles: [
          { id: 'p1', name: 'Prim', provider: 'OPENAI', modelName: 'gpt', isDefault: true, isDangerousCompatible: false },
        ],
      })
      await renderAt('group=moderation')
      const desk = document.getElementById('uncensored-desk') as HTMLElement
      expect(within(desk).getByRole('link', { name: 'connection profile' })).toHaveAttribute(
        'href',
        '/settings?section=connection-profiles',
      )
      expect(within(desk).getByRole('link', { name: 'image profile' })).toHaveAttribute(
        'href',
        '/settings?section=image-profiles',
      )
    })

    it('wears the Concierge’s backdrop', async () => {
      await renderAt('group=moderation')
      expect(mockBackdrop).toHaveBeenLastCalledWith('concierge')
    })
  })

  describe('search', () => {
    function search(text: string) {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: text } })
    }

    it('narrows to Security for "password", opens the passphrase and marks the word', async () => {
      await renderAt('')
      search('password')
      expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Security2'])
      expect(currentGroup()).toBe('Security2')
      expect(header('encryption-passphrase')).toHaveAttribute('aria-expanded', 'true')
      const marks = document.getElementById('encryption-passphrase')!.querySelectorAll('mark')
      expect(Array.from(marks).map((m) => m.textContent?.toLowerCase())).toContain('password')
      expect(screen.getByText('2 settings match')).toBeInTheDocument()
    })

    it('shows exactly Pascal’s cards for "Pascal"', async () => {
      await renderAt('')
      search('Pascal')
      expect(currentGroup()).toBe('Games & Tools3')
      for (const id of ['automation', 'custom-tools', 'general-state']) expect(document.getElementById(id)).not.toBeNull()
      expect(document.getElementById('agent-mode')).toBeNull()
    })

    it('restores the group and card states when the search is cleared', async () => {
      await renderAt('group=appearance')
      fireEvent.click(header('tags'))
      expect(header('tags')).toHaveAttribute('aria-expanded', 'true')
      search('dice')
      expect(currentGroup()).toMatch(/^Games & Tools/)
      search('')
      expect(currentGroup()).toBe('Appearance')
      expect(header('tags')).toHaveAttribute('aria-expanded', 'true')
      expect(header('avatar-settings')).toHaveAttribute('aria-expanded', 'false')
    })

    it('pre-fills from ?q=', async () => {
      await renderAt('q=dice')
      expect(screen.getByRole('searchbox', { name: 'Search settings' })).toHaveValue('dice')
      expect(document.getElementById('automation')).not.toBeNull()
    })

    it('focuses the search on "/" and clears it on Escape', async () => {
      await renderAt('')
      const box = screen.getByRole('searchbox', { name: 'Search settings' })
      fireEvent.keyDown(document, { key: '/' })
      expect(box).toHaveFocus()
      search('dice')
      fireEvent.keyDown(box, { key: 'Escape' })
      expect(box).toHaveValue('')
    })
  })

  describe('the persona lens', () => {
    it('shows exactly Saquel’s cards for ?persona=saquel', async () => {
      await renderAt('persona=saquel')
      expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Connections1', 'Security3'])
      expect(document.getElementById('api-keys')).not.toBeNull()
      fireEvent.click(within(rail()).getByRole('button', { name: /Security/ }))
      for (const id of ['encryption-passphrase', 'auto-lock', 'delete-all-data']) {
        expect(document.getElementById(id)).not.toBeNull()
      }
      expect(screen.getByText(/Showing only Saquel/)).toBeInTheDocument()
      expect(mockBackdrop).toHaveBeenLastCalledWith('saquel')
    })

    it('shows only the Console card for ?persona=brahma', async () => {
      await renderAt('persona=brahma')
      expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Games & Tools1'])
      const column = screen.getByRole('region', { name: 'Games & Tools' })
      expect(column.querySelectorAll('.qt-collapsible-card')).toHaveLength(1)
      expect(document.getElementById('brahma-console')).not.toBeNull()
    })

    it('clears the lens with Show everything', async () => {
      await renderAt('persona=brahma')
      fireEvent.click(screen.getByRole('button', { name: 'Show everything' }))
      expect(within(rail()).getAllByRole('button')).toHaveLength(10)
    })

    it('turns a persona chip on and off', async () => {
      await renderAt('')
      const chip = screen.getByRole('button', { name: 'Pascal the Croupier' })
      fireEvent.click(chip)
      expect(chip).toHaveAttribute('aria-pressed', 'true')
      expect(currentGroup()).toBe('Games & Tools3')
      fireEvent.click(chip)
      expect(chip).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('dresses the autonomous-room cards in the Salon’s badge', async () => {
    await renderAt('group=games-tools')
    for (const id of ['autonomous-rooms', 'autonomous-room-schedules']) {
      expect(document.getElementById(id)!.querySelector('[data-persona]')).toHaveAttribute('data-persona', 'salon')
    }
  })
})
