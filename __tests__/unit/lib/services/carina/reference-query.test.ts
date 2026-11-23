/**
 * The Reference Query block of a Carina answerer's prompt
 * (docs/developer/features/roleplay-character-latitude.md §5.8).
 *
 * An assistant-kind answerer's block is byte-identical to what it was before
 * kinds reached Carina. A roleplay answerer is also told to look first and
 * then answer with particulars instead of pleading ignorance.
 *
 * @jest-environment node
 */

import {
  ROLEPLAY_REFERENCE_QUERY_CLOSE,
  buildReferenceQueryBlock,
} from '@/lib/services/carina/reference-query'

const CARD = '**Ada**\nHarbourmaster'

describe('buildReferenceQueryBlock', () => {
  it('keeps the assistant block byte-identical, with an asker', () => {
    expect(buildReferenceQueryBlock(CARD, 'assistant')).toBe(
      '## Reference Query\nYou are being consulted for a quick, standalone question by the ' +
        'individual described below. Use this to know who is addressing you, then answer them ' +
        'directly and concisely from your own knowledge and the tools available to you. You do not ' +
        'have the surrounding conversation in view.' +
        `\n\n### Who Is Asking\n${CARD}`,
    )
  })

  it('keeps the assistant block byte-identical, without an asker', () => {
    expect(buildReferenceQueryBlock(null, 'assistant')).toBe(
      '## Reference Query\nYou are being consulted for a quick, standalone question. ' +
        'Answer it directly and concisely from your own knowledge and the tools available to you. ' +
        'You do not have the surrounding conversation in view.',
    )
  })

  it.each([CARD, null])('adds the close for a roleplay answerer (asker: %s)', (card) => {
    const block = buildReferenceQueryBlock(card, 'roleplay')
    const assistant = buildReferenceQueryBlock(card, 'assistant')

    expect(block).toContain(ROLEPLAY_REFERENCE_QUERY_CLOSE)
    expect(block.replace(` ${ROLEPLAY_REFERENCE_QUERY_CLOSE}`, '')).toBe(assistant)
  })

  it('puts the close before the asker card', () => {
    const block = buildReferenceQueryBlock(CARD, 'roleplay')
    expect(block.indexOf(ROLEPLAY_REFERENCE_QUERY_CLOSE)).toBeLessThan(block.indexOf('### Who Is Asking'))
  })

  it('the close looks first, fills only a real gap, and stays off the conversation', () => {
    expect(ROLEPLAY_REFERENCE_QUERY_CLOSE).toContain('Look first: if your memory or a tool holds the answer, give it as it is.')
    expect(ROLEPLAY_REFERENCE_QUERY_CLOSE).toContain('Where they are silent and nothing established contradicts you')
    expect(ROLEPLAY_REFERENCE_QUERY_CLOSE).toContain('instead of saying you do not know')
    expect(ROLEPLAY_REFERENCE_QUERY_CLOSE).toContain('say nothing of what anyone there has said or done')
  })
})
