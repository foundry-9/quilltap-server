/**
 * Tests for the trailing-sections message and the turn notes.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  logger.child = () => logger
  return { logger }
})

import { buildTurnNotes, composeTrailingMessage, type TrailingSections } from '@/lib/chat/context/turn-trailing'
import { NOTHING_TO_ADD_SENTINEL } from '@/lib/chat/turn-manager/skip-signal'
import { YIELD_SENTINEL } from '@/lib/chat/turn-manager/yield-signal'

const none: TrailingSections = {
  coreWhisper: '',
  recall: '',
  mail: '',
  progressions: '',
  inventory: '',
  inform: null,
  referentLedger: '',
  closingEcho: '',
  turnSkip: '',
  turnYield: '',
}

const every: TrailingSections = {
  coreWhisper: 'CORE',
  recall: 'RECALL',
  mail: 'MAIL',
  progressions: 'PROGRESSIONS',
  inventory: 'INVENTORY',
  inform: 'INFORM',
  referentLedger: 'LEDGER',
  closingEcho: 'ECHO',
  turnSkip: 'SKIP',
  turnYield: 'YIELD',
  storyteller: 'STORYTELLER',
}
const ORDER = ['CORE', 'RECALL', 'MAIL', 'PROGRESSIONS', 'INVENTORY', 'INFORM', 'LEDGER', 'ECHO', 'SKIP', 'YIELD', 'STORYTELLER']

describe('composeTrailingMessage', () => {
  it('is the bare user message when there are no sections', () => {
    expect(composeTrailingMessage({ newUserMessage: 'Hello', sections: none, narrationAnchor: '' })).toEqual({
      role: 'user',
      content: 'Hello',
      name: undefined,
      metadata: { isUserTurn: true },
    })
  })

  it('is absent with neither a user message nor any section', () => {
    expect(composeTrailingMessage({ sections: none, narrationAnchor: '' })).toBeNull()
  })

  it('appends every section to the user message in the one order, rule-separated', () => {
    const message = composeTrailingMessage({ newUserMessage: 'Hello', newUserName: 'Charlie', sections: every, narrationAnchor: 'ANCHOR' })
    expect(message?.content).toBe(['Hello', ...ORDER].join('\n\n---\n\n'))
    expect(message?.name).toBe('Charlie')
  })

  it('carries the same order on its own, scene note first, on a turn with no user message', () => {
    const message = composeTrailingMessage({ sections: every, narrationAnchor: 'ANCHOR' })
    expect(message).toEqual({ role: 'user', content: ['ANCHOR', ...ORDER].join('\n\n---\n\n') })
  })
})

describe('buildTurnNotes', () => {
  it('builds neither note by default', () => {
    expect(buildTurnNotes({ operatorName: 'Charlie', chatId: 'chat' })).toEqual({ turnSkip: '', turnYield: '' })
  })

  it('offers the pass and the yield with their sentinels', () => {
    const notes = buildTurnNotes({
      turnSkip: { offerSkip: true, recentlyAddressed: true, characterName: 'Friday' },
      offerYield: true,
      operatorName: 'Charlie',
      chatId: 'chat',
    })
    expect(notes.turnSkip).toContain(NOTHING_TO_ADD_SENTINEL)
    expect(notes.turnSkip).toContain('Friday appears to have been directly addressed')
    expect(notes.turnYield).toContain(YIELD_SENTINEL)
    expect(notes.turnYield).toContain('Charlie has raised a hand')
  })
})
