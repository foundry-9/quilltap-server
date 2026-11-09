/**
 * The settings registry is the one list of what is on the Settings page.
 * These tests hold its integrity, the legacy eight-tab bridge, and search.
 */

import fs from 'fs'
import path from 'path'
import {
  SETTINGS_CARDS,
  SETTINGS_GROUPS,
  LEGACY_SECTION_ALIASES,
  LEGACY_TAB_TO_GROUP,
  getSettingsCard,
  resolveSettingsLink,
  resolveSettingsHref,
  searchSettingsCards,
  topLevelCardsOf,
} from '@/lib/settings/registry'
import { CHILD_SUBSYSTEM_IDS, DEFAULT_SUBSYSTEM_DEFINITIONS } from '@/lib/foundry/subsystem-defaults'

const HELP_DIR = path.join(process.cwd(), 'help')

/**
 * The page as it was before the redesign (2026-11-09): eight tabs and the
 * cards each rendered. Every pair must still land on the same card.
 */
const PHASE_0_TABS: Record<string, string[]> = {
  providers: ['api-keys', 'connection-profiles', 'cheap-llm', 'capabilities-report'],
  chat: [
    'composition-mode', 'composer-spellcheck', 'composer-slash-commands', 'auto-scroll', 'text-replacements',
    'smart-typography', 'token-display', 'context-compression', 'memory-cascade', 'image-description',
    'automation', 'custom-tools', 'general-state', 'agent-mode', 'thinking-display', 'answer-confirmation',
    'taboo', 'data-retention', 'brahma-console', 'autonomous-rooms', 'autonomous-room-schedules',
  ],
  concierge: ['on-duty', 'uncensored-desk', 'refusals', 'display', 'pre-screening'],
  appearance: ['appearance', 'avatar-settings', 'tags'],
  memory: [
    'embedding-profiles', 'memory-backfill', 'memory-maintenance', 'memory-extraction-grain', 'memory-recall',
    'memory-regenerate', 'conversation-summaries-regenerate',
  ],
  images: ['image-profiles', 'story-backgrounds', 'wardrobe-images', 'default-aesthetics'],
  templates: ['roleplay-templates', 'prompts', 'core-whisper'],
  system: [
    'encryption-passphrase', 'auto-lock', 'plugins', 'backup-restore', 'import-export', 'llm-logging',
    'tasks-queue', 'llm-logs', 'delete-all-data',
  ],
}

const params = (q: string) => new URLSearchParams(q)

describe('settings registry integrity', () => {
  it('has unique card ids', () => {
    const ids = SETTINGS_CARDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every card in a group that exists, and every group has a card', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id))
    for (const card of SETTINGS_CARDS) expect(groupIds.has(card.group)).toBe(true)
    for (const group of SETTINGS_GROUPS) expect(topLevelCardsOf(group.id).length).toBeGreaterThan(0)
  })

  it('gives every card at least two keywords and a help document that exists', () => {
    for (const card of SETTINGS_CARDS) {
      expect({ id: card.id, keywords: card.keywords.length >= 2 }).toEqual({ id: card.id, keywords: true })
      expect({ id: card.id, help: fs.existsSync(path.join(HELP_DIR, `${card.help}.md`)) }).toEqual({
        id: card.id,
        help: true,
      })
    }
  })

  it('hosts cards only inside a top-level card of the same group', () => {
    for (const card of SETTINGS_CARDS.filter((c) => c.hostedBy)) {
      const host = getSettingsCard(card.hostedBy)
      expect(host).toBeDefined()
      expect(host!.hostedBy).toBeUndefined()
      expect(host!.group).toBe(card.group)
    }
  })

  it('has every persona in the hub own at least one card', () => {
    for (const persona of CHILD_SUBSYSTEM_IDS) {
      expect({ persona, owns: SETTINGS_CARDS.some((c) => c.persona === persona) }).toEqual({ persona, owns: true })
    }
  })

  it('restores Pascal and Saquel to the hub and adds Brahma', () => {
    expect(CHILD_SUBSYSTEM_IDS).toEqual(expect.arrayContaining(['pascal', 'saquel', 'brahma']))
  })

  it('points every hub persona at its lens', () => {
    for (const persona of CHILD_SUBSYSTEM_IDS) {
      expect(DEFAULT_SUBSYSTEM_DEFINITIONS[persona].href).toBe(`/settings?persona=${persona}`)
    }
  })

  it('dresses the autonomous-room cards in the Salon and the Console in Brahma', () => {
    expect(getSettingsCard('autonomous-rooms')!.persona).toBe('salon')
    expect(getSettingsCard('autonomous-room-schedules')!.persona).toBe('salon')
    expect(SETTINGS_CARDS.filter((c) => c.persona === 'brahma').map((c) => c.id)).toEqual(['brahma-console'])
  })

  it('places the ten groups in the agreed order', () => {
    expect(SETTINGS_GROUPS.map((g) => g.title)).toEqual([
      'Connections', 'Composer & Display', 'Context & Memory', 'Characters & Prompts', 'Images',
      'Games & Tools', 'Moderation', 'Appearance', 'Security', 'Data & Maintenance',
    ])
  })
})

describe('resolveSettingsLink — new addresses', () => {
  it('opens a group', () => {
    expect(resolveSettingsLink(params('group=security'))).toEqual({ group: 'security' })
  })

  it('derives the group from a card, ignoring a disagreeing group', () => {
    expect(resolveSettingsLink(params('section=taboo'))).toEqual({ group: 'characters-prompts', card: 'taboo' })
    expect(resolveSettingsLink(params('group=images&section=taboo'))).toEqual({
      group: 'characters-prompts',
      card: 'taboo',
    })
  })

  it('keeps `appearance` the group and `appearance` the card apart', () => {
    expect(resolveSettingsLink(params('group=appearance'))).toEqual({ group: 'appearance' })
    expect(resolveSettingsLink(params('section=appearance'))).toEqual({ group: 'appearance', card: 'appearance' })
  })

  it('names nowhere for a bare or unknown address', () => {
    expect(resolveSettingsLink(params(''))).toBeNull()
    expect(resolveSettingsLink(params('group=nowhere'))).toBeNull()
    expect(resolveSettingsLink(params('section=nowhere'))).toBeNull()
  })

  it('resolves a hosted card to its own id (the renderer opens its host)', () => {
    expect(resolveSettingsLink(params('section=image-profiles'))).toEqual({
      group: 'connections',
      card: 'image-profiles',
    })
  })

  it('resolves whole hrefs, and only /settings ones', () => {
    expect(resolveSettingsHref('/settings?section=plugins')).toEqual({ group: 'data-maintenance', card: 'plugins' })
    expect(resolveSettingsHref('/settings/wizard')).toBeNull()
    expect(resolveSettingsHref('/aurora?section=plugins')).toBeNull()
  })
})

describe('resolveSettingsLink — the legacy bridge', () => {
  it('lands every Phase 0 (tab, section) pair on the same card', () => {
    for (const [tab, sections] of Object.entries(PHASE_0_TABS)) {
      for (const section of sections) {
        const resolved = resolveSettingsLink(params(`tab=${tab}&section=${section}`))
        expect(resolved?.card).toBe(section)
        expect(resolved?.group).toBe(getSettingsCard(section)!.group)
      }
    }
  })

  it('accounts for all 56 Phase 0 cards', () => {
    expect(Object.values(PHASE_0_TABS).flat()).toHaveLength(56)
  })

  it('resolves every old tab alone to a group', () => {
    for (const tab of Object.keys(PHASE_0_TABS)) {
      expect(resolveSettingsLink(params(`tab=${tab}`))).toEqual({
        group: LEGACY_TAB_TO_GROUP[tab as keyof typeof LEGACY_TAB_TO_GROUP],
      })
    }
  })

  it('sends the Courier to the connection profiles', () => {
    expect(resolveSettingsLink(params('tab=providers&section=the-courier'))).toEqual({
      group: 'connections',
      card: 'connection-profiles',
    })
  })

  it('resolves every alias to a registered card', () => {
    for (const target of Object.values(LEGACY_SECTION_ALIASES)) expect(getSettingsCard(target)).toBeDefined()
  })

  it('falls back to the tab when a section is unknown', () => {
    expect(resolveSettingsLink(params('tab=system&section=gone'))).toEqual({ group: 'data-maintenance' })
  })
})

describe('searchSettingsCards', () => {
  it('finds the passphrase by "password"', () => {
    const ids = searchSettingsCards('password').map((c) => c.id)
    expect(ids).toContain('encryption-passphrase')
    expect(new Set(searchSettingsCards('password').map((c) => c.group))).toEqual(new Set(['security']))
  })

  it('finds dice and the censor', () => {
    expect(searchSettingsCards('dice').map((c) => c.id)).toContain('automation')
    expect(searchSettingsCards('censor').every((c) => c.group === 'moderation')).toBe(true)
  })

  it('matches a persona by name, and only that persona', () => {
    const pascal = searchSettingsCards('Pascal')
    expect(pascal.map((c) => c.id).sort()).toEqual(['automation', 'custom-tools', 'general-state'])
  })

  it('uses the theme-resolved persona name', () => {
    const ids = searchSettingsCards('Gatekeeper', (p) => (p === 'saquel' ? 'The Gatekeeper' : p)).map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['encryption-passphrase', 'auto-lock', 'delete-all-data', 'api-keys']))
  })

  it('requires every term, ignoring case and accents', () => {
    expect(searchSettingsCards('REBUILD Memory').map((c) => c.id)).toEqual(['memory-regenerate'])
    expect(searchSettingsCards('tâboo').map((c) => c.id)).toEqual(['taboo'])
  })

  it('matches nothing for an empty query', () => {
    expect(searchSettingsCards('   ')).toEqual([])
  })
})
