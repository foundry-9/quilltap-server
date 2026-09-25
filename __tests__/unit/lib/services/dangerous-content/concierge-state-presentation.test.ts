/**
 * Tests for lib/services/dangerous-content/concierge-state-presentation.ts
 *
 * The presentation table is the single source for every word the three states
 * wear on screen, so the tests pin the whole table rather than a sample: a copy
 * edit should be a deliberate one-line change here, not a silent drift. The
 * provenance variants of Unmoderated's sentence are pinned too.
 */

import {
  CONCIERGE_STATE_PRESENTATION,
  conciergeToneSuffix,
  conciergeToneTextClass,
  describeConciergeState,
} from '@/lib/services/dangerous-content/concierge-state-presentation'
import { CONCIERGE_STATES, type ConciergeState } from '@/lib/services/dangerous-content/chat-override'

const ALL_STATES: readonly ConciergeState[] = CONCIERGE_STATES

describe('CONCIERGE_STATE_PRESENTATION', () => {
  it.each([
    ['moderated', 'Moderated', 'eye', 'success'],
    ['unmoderated', 'Unmoderated', 'eye-off', 'danger'],
    ['locked', 'Locked', 'shield', 'muted'],
  ])('describes %s as %s / %s / %s', (state, label, icon, tone) => {
    const presentation = CONCIERGE_STATE_PRESENTATION[state as ConciergeState]
    expect(presentation.label).toBe(label)
    expect(presentation.icon).toBe(icon)
    expect(presentation.tone).toBe(tone)
  })

  it('covers all three states, each with a detail sentence and the same hint', () => {
    expect(Object.keys(CONCIERGE_STATE_PRESENTATION).sort()).toEqual([...ALL_STATES].sort())
    for (const state of ALL_STATES) {
      expect(CONCIERGE_STATE_PRESENTATION[state].detail.length).toBeGreaterThan(0)
      expect(CONCIERGE_STATE_PRESENTATION[state].hint).toBe(
        "Change it from the Salon sidebar's Chat section."
      )
    }
  })

  it('keeps the helper sentences verbatim', () => {
    expect(CONCIERGE_STATE_PRESENTATION.moderated.detail).toBe(
      'The Concierge sends everything to the usual providers first, and to the uncensored desk only when one of them refuses. After enough refusals he moves the whole chat himself.'
    )
    expect(CONCIERGE_STATE_PRESENTATION.unmoderated.detail).toBe(
      'You have opened the uncensored door yourself. Nothing here goes near a moderated provider.'
    )
    expect(CONCIERGE_STATE_PRESENTATION.locked.detail).toBe(
      'Only the usual providers, ever. If one refuses, the refusal stands. For the chat that must never reach an uncensored model.'
    )
  })

  it('gives every state a distinct label, icon and tone', () => {
    const labels = ALL_STATES.map(s => CONCIERGE_STATE_PRESENTATION[s].label)
    const icons = ALL_STATES.map(s => CONCIERGE_STATE_PRESENTATION[s].icon)
    const tones = ALL_STATES.map(s => CONCIERGE_STATE_PRESENTATION[s].tone)
    expect(new Set(labels).size).toBe(3)
    expect(new Set(icons).size).toBe(3)
    expect(new Set(tones).size).toBe(3)
  })
})

describe('conciergeToneSuffix', () => {
  it('leaves the danger base rule unsuffixed and names the one modifier', () => {
    expect(conciergeToneSuffix('danger')).toBe('')
    expect(conciergeToneSuffix('muted')).toBe('-muted')
  })

  it('falls through to the base for success (Moderated draws no badge and no mark)', () => {
    expect(conciergeToneSuffix('success')).toBe('')
  })

  it.each([
    ['unmoderated', ''],
    ['locked', '-muted'],
  ])('gives %s the class suffix "%s"', (state, suffix) => {
    expect(conciergeToneSuffix(CONCIERGE_STATE_PRESENTATION[state as ConciergeState].tone)).toBe(suffix)
  })
})

describe('conciergeToneTextClass', () => {
  it.each([
    ['moderated', 'qt-text-success'],
    ['unmoderated', 'qt-text-danger'],
    ['locked', 'qt-text-muted'],
  ])('gives %s the text class %s', (state, expected) => {
    expect(conciergeToneTextClass(CONCIERGE_STATE_PRESENTATION[state as ConciergeState].tone)).toBe(expected)
  })
})

describe('describeConciergeState', () => {
  it.each(ALL_STATES)('reads %s straight off the table with no provenance', (state) => {
    const presentation = CONCIERGE_STATE_PRESENTATION[state]
    expect(describeConciergeState(state)).toEqual({
      title: presentation.label,
      detail: presentation.detail,
      categories: null,
      hint: presentation.hint,
    })
  })

  it("uses the operator's sentence for Unmoderated set by the operator", () => {
    expect(describeConciergeState('unmoderated', { setBy: 'operator', reason: 'manual' }).detail)
      .toBe(CONCIERGE_STATE_PRESENTATION.unmoderated.detail)
  })

  it('names the refusal count when the Concierge moved the chat after refusals', () => {
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'refusals', refusalCount: 2 }).detail)
      .toBe('The Concierge moved this chat to the uncensored desk after two refusals. Set it back to Moderated if you disagree.')
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'refusals', refusalCount: 1 }).detail)
      .toBe('The Concierge moved this chat to the uncensored desk after one refusal. Set it back to Moderated if you disagree.')
  })

  it('still reads sensibly when the refusal count is unknown', () => {
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'refusals' }).detail)
      .toBe('The Concierge moved this chat to the uncensored desk after the usual providers refused it. Set it back to Moderated if you disagree.')
  })

  it("says the classifier's reading when the Concierge moved the chat on the conversation", () => {
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'classifier' }).detail)
      .toBe('The Concierge moved this chat to the uncensored desk on reading the conversation. Set it back to Moderated if you disagree.')
  })

  it("surfaces categories only for the classifier's own move", () => {
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'classifier' }, ['NSFW', 'Violence']).categories)
      .toEqual(['NSFW', 'Violence'])
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'classifier' }, []).categories).toBeNull()
    expect(describeConciergeState('unmoderated', { setBy: 'concierge', reason: 'refusals' }, ['NSFW']).categories).toBeNull()
    expect(describeConciergeState('unmoderated', { setBy: 'operator' }, ['NSFW']).categories).toBeNull()
  })

  it.each(['moderated', 'locked'] as ConciergeState[])(
    'never surfaces the preserved categories or a Concierge sentence on %s',
    (state) => {
      const description = describeConciergeState(state, { setBy: 'concierge', reason: 'classifier' }, ['NSFW'])
      expect(description.categories).toBeNull()
      expect(description.detail).toBe(CONCIERGE_STATE_PRESENTATION[state].detail)
    }
  )
})
