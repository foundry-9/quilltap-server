/**
 * The In Their Own Words gate (`shouldRehearseImpersonatedLine`).
 *
 * Five rules decide whether a composer submit becomes a rehearsal. Four of them
 * are about staying out of the way: an owner seat has no voice of its own to
 * consult, an attachment-only send has nothing to restate, a Carina address is
 * machinery rather than a line, and a "Send as written" resubmit has already
 * been through the dialog once.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  shouldRehearseImpersonatedLine,
  type ShouldRehearseArgs,
} from '@/app/salon/[id]/hooks/useImpersonationVoice'

const IMPERSONATED = 'seat-evangeline'

function args(over: Partial<ShouldRehearseArgs> = {}): ShouldRehearseArgs {
  return {
    enabled: true,
    seat: { id: IMPERSONATED, type: 'CHARACTER', controlledBy: 'llm' },
    impersonatingParticipantIds: [IMPERSONATED],
    text: 'I tell him I will take the job.',
    hasAttachmentsOnly: false,
    bypassOnce: false,
    ...over,
  }
}

describe('every chat setting the Salon reads is LIVE', () => {
  // Bug 134: `useChatData` used to fetch `/api/v1/settings/chat` once, from the
  // mount effect, into `useState`. A workspace tab keeps a Salon mounted for the
  // life of the session, so that value was a snapshot of whenever the tab was
  // opened and no dial flipped in the Settings tab ever reached the open chat.
  // Every read now goes through the TanStack query, whose key the settings
  // mutation invalidates.
  const salonView = readFileSync(join(__dirname, '..', '..', 'SalonView.tsx'), 'utf8')
  const chatData = readFileSync(join(__dirname, '..', 'useChatData.ts'), 'utf8')

  it('SalonView takes its settings from useChatSettingsQuery', () => {
    expect(salonView).toContain('const { data: chatSettings } = useChatSettingsQuery()')
    expect(salonView).toContain('chatSettings?.impersonationVoiceRewrite')
  })

  it('the mount-only fetch is gone, and cannot be called back', () => {
    expect(salonView).not.toContain('fetchChatSettings')
    expect(chatData).not.toContain('chatSettings')
    expect(chatData).not.toContain('/api/v1/settings/chat')
  })
})

describe('shouldRehearseImpersonatedLine', () => {
  it('fires for an impersonated character seat with prose', () => {
    expect(shouldRehearseImpersonatedLine(args())).toBe(true)
  })

  describe('rule 1 — the instance setting', () => {
    it('never fires when the setting is off', () => {
      expect(shouldRehearseImpersonatedLine(args({ enabled: false }))).toBe(false)
    })
  })

  describe('rule 2 — the seat', () => {
    it('never fires with no speaking seat at all', () => {
      expect(shouldRehearseImpersonatedLine(args({ seat: null }))).toBe(false)
    })

    it('never fires for a seat that is not in the overlay', () => {
      expect(
        shouldRehearseImpersonatedLine(args({ impersonatingParticipantIds: ['seat-someone-else'] })),
      ).toBe(false)
    })

    it('never fires for the owner persona, even when it is also in the overlay', () => {
      expect(
        shouldRehearseImpersonatedLine(
          args({ seat: { id: IMPERSONATED, type: 'CHARACTER', controlledBy: 'user' } }),
        ),
      ).toBe(false)
    })
  })

  describe('rule 3 — there has to be something to restate', () => {
    it('never fires on empty text', () => {
      expect(shouldRehearseImpersonatedLine(args({ text: '' }))).toBe(false)
    })

    it('never fires on whitespace alone', () => {
      expect(shouldRehearseImpersonatedLine(args({ text: '   \n\t ' }))).toBe(false)
    })

    it('never fires on an attachment-only send', () => {
      expect(
        shouldRehearseImpersonatedLine(args({ text: '', hasAttachmentsOnly: true })),
      ).toBe(false)
    })
  })

  describe('rule 4 — Carina addresses are machinery', () => {
    it('never fires on a public Carina address', () => {
      expect(
        shouldRehearseImpersonatedLine(args({ text: '@Evangeline: what year is it?' })),
      ).toBe(false)
    })

    it('never fires on a whispered Carina address', () => {
      expect(
        shouldRehearseImpersonatedLine(args({ text: '@Evangeline? what year is it?' })),
      ).toBe(false)
    })

    it('still fires on an @name that is not a Carina address', () => {
      expect(
        shouldRehearseImpersonatedLine(args({ text: 'I look at @Evangeline and say nothing.' })),
      ).toBe(true)
    })
  })

  describe('rule 5 — bypass once', () => {
    it('lets a "Send as written" resubmit straight through', () => {
      expect(shouldRehearseImpersonatedLine(args({ bypassOnce: true }))).toBe(false)
    })
  })
})
