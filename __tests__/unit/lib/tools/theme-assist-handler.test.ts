/**
 * @jest-environment node
 *
 * Calliope's tool handlers (Spec J §2.2): each reads the conversation's draft
 * fresh, answers only inside a Calliope conversation, and never writes.
 */

const mockChats = new Map<string, Record<string, unknown>>()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ chats: { findById: async (id: string) => mockChats.get(id) ?? null } }),
}))

const mockDrafts = new Map<string, unknown>()
jest.mock('@/lib/themes/drafts', () => {
  class ThemeDraftNotFoundError extends Error {}
  return {
    ThemeDraftNotFoundError,
    readDraft: async (id: string) => {
      const d = mockDrafts.get(id)
      if (!d) throw new ThemeDraftNotFoundError(`No theme draft ${id}`)
      return d
    },
  }
})

import { THEME_ASSIST_HANDLERS } from '@/lib/tools/handlers/theme-assist-handler'

const manifest = { format: 'qtap-theme', formatVersion: 2, id: 'rains', name: 'Rains', version: '1.0.0', author: 'Tester' }

beforeEach(() => {
  mockChats.clear()
  mockDrafts.clear()
  mockChats.set('muse', { id: 'muse', chatType: 'calliope', themeDraftId: 'rains' })
  mockChats.set('salon', { id: 'salon', chatType: 'salon' })
  mockChats.set('lost', { id: 'lost', chatType: 'calliope', themeDraftId: 'gone' })
  mockDrafts.set('rains', {
    id: 'rains',
    manifest,
    tokens: { primitives: {}, tokens: { '--theme-primary': '#1d4ed8' }, choices: {} },
    revision: 'tokens-1',
    styles: null,
    images: [],
    issues: [],
    files: [{ path: 'theme.json' }, { path: 'tokens.json' }],
  })
})

const ctx = (chatId: string) => ({ chatId, userId: 'user-1' })

describe('every theme tool', () => {
  const validInput: Record<string, unknown> = {
    theme_read_draft: {},
    theme_lookup_tokens: { query: 'primary' },
    theme_lookup_hooks: { query: 'dialog' },
    theme_check_contrast: { pair: 'theme-foreground/theme-background' },
    theme_propose: { title: 'x', reason: 'y', operations: [{ op: 'reset-token', token: '--theme-primary' }] },
  }

  it.each(Object.keys(THEME_ASSIST_HANDLERS))('%s refuses outside a Calliope conversation', async (name) => {
    expect(await THEME_ASSIST_HANDLERS[name](validInput[name], ctx('salon'))).toMatchObject({ success: false, error: expect.stringMatching(/only in a conversation about a theme draft/) })
  })

  it('says so when the draft has gone', async () => {
    expect(await THEME_ASSIST_HANDLERS.theme_read_draft({}, ctx('lost'))).toMatchObject({ success: false, error: expect.stringMatching(/"gone" is no longer there/) })
  })
})

describe('the readers', () => {
  it('theme_read_draft renders the draft', async () => {
    const r = await THEME_ASSIST_HANDLERS.theme_read_draft({ part: 'all' }, ctx('muse'))
    expect(r).toMatchObject({ success: true, formattedText: expect.stringContaining('--theme-primary') })
  })

  it('theme_lookup_tokens finds by name with the draft\'s value, and refuses an empty query', async () => {
    expect(await THEME_ASSIST_HANDLERS.theme_lookup_tokens({ names: ['--theme-primary'] }, ctx('muse'))).toMatchObject({
      success: true,
      formattedText: expect.stringContaining('#1d4ed8'),
    })
    expect(await THEME_ASSIST_HANDLERS.theme_lookup_tokens({}, ctx('muse'))).toMatchObject({ success: false, error: expect.stringMatching(/^Invalid input/) })
  })

  it('theme_lookup_hooks finds a hook by class', async () => {
    expect(await THEME_ASSIST_HANDLERS.theme_lookup_hooks({ classes: ['qt-dialog'] }, ctx('muse'))).toMatchObject({
      success: true,
      formattedText: expect.stringContaining('.qt-dialog'),
    })
  })

  it('theme_check_contrast measures a pair and refuses an unknown one', async () => {
    expect(await THEME_ASSIST_HANDLERS.theme_check_contrast({ foreground: '#000', background: '#fff' }, ctx('muse'))).toMatchObject({
      success: true,
      formattedText: expect.stringMatching(/light: 21:1, passes/),
    })
    expect(await THEME_ASSIST_HANDLERS.theme_check_contrast({ pair: 'no/such' }, ctx('muse'))).toMatchObject({ success: false })
  })
})

describe('theme_propose', () => {
  const set = (operations: unknown[]) => ({ title: 'Deeper', reason: 'Asked for.', operations })

  it('records an offered proposal with the revision it was judged against, and writes nothing', async () => {
    const before = JSON.stringify(mockDrafts.get('rains'))
    const r = await THEME_ASSIST_HANDLERS.theme_propose(set([{ op: 'set-token', token: '--theme-primary', value: '#1e3a8a' }]), ctx('muse'))
    expect(r).toMatchObject({ success: true, proposal: { draftId: 'rains', draftRevision: 'tokens-1+none' } })
    expect(JSON.stringify(mockDrafts.get('rains'))).toBe(before)
  })

  it('returns a refused proposal as a failure, so the author never sees it', async () => {
    expect(await THEME_ASSIST_HANDLERS.theme_propose(set([{ op: 'set-token', token: '--theme-nope', value: 'red' }]), ctx('muse'))).toMatchObject({
      success: false,
      error: expect.stringMatching(/^Not shown to the author/),
    })
  })

  it('refuses a malformed change set before reading the draft', async () => {
    expect(await THEME_ASSIST_HANDLERS.theme_propose({ title: 'x', reason: 'y', operations: [] }, ctx('muse'))).toMatchObject({
      success: false,
      error: expect.stringMatching(/^Invalid input for theme_propose/),
    })
  })
})
