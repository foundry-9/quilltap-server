/**
 * The kind-specific generator directions
 * (docs/developer/features/character-kind-and-roleplay-defaults.md §5.5).
 *
 * A roleplay character's generated prompt says how they react when the story
 * turns, and must never encode a temperament as an absolute; an assistant's
 * says how they do the work. Flattening is drift for a story character only.
 */

import {
  ASSISTANT_TASK_DIRECTION,
  FLATTENING_DRIFT_SIGNAL,
  STAKES_AND_REACTION_DIRECTION,
  generatorDirectionFor,
  kindDriftSignalFor,
} from '@/lib/services/character-field-semantics'

describe('character-field-semantics — the stakes', () => {
  it('chooses the direction by kind', () => {
    expect(generatorDirectionFor('roleplay')).toBe(STAKES_AND_REACTION_DIRECTION)
    expect(generatorDirectionFor('assistant')).toBe(ASSISTANT_TASK_DIRECTION)
  })

  it('chooses the drift signal by kind', () => {
    expect(kindDriftSignalFor('roleplay')).toBe(FLATTENING_DRIFT_SIGNAL)
    expect(kindDriftSignalFor('assistant')).toBeNull()
  })

  it('the stakes direction forbids absolute temperament rules and keeps danger felt', () => {
    expect(STAKES_AND_REACTION_DIRECTION).toMatch(/Match the stakes/)
    expect(STAKES_AND_REACTION_DIRECTION).toMatch(/A temperament is a default, never an absolute/)
    expect(STAKES_AND_REACTION_DIRECTION).toContain('"never tense"')
    expect(STAKES_AND_REACTION_DIRECTION).toMatch(/Negotiation is a choice under pressure, never a substitute for fear/)
    expect(STAKES_AND_REACTION_DIRECTION).toMatch(/do not drift to the group's consensus/)
    expect(STAKES_AND_REACTION_DIRECTION).toMatch(/Do not invent violence or drama/)
    // In the phase-6 evaluation, characters decided Sam had gone to the boathouse
    // and planned around it for turns (character-kind-and-roleplay-defaults.md §12).
    expect(STAKES_AND_REACTION_DIRECTION).toMatch(/does not decide where \{\{user\}\} is or what \{\{user\}\} has been doing off-screen/)
  })

  it('the task direction keeps an assistant honest and unpadded', () => {
    expect(ASSISTANT_TASK_DIRECTION).toMatch(/never invent facts/)
    expect(ASSISTANT_TASK_DIRECTION).toMatch(/leave the decision to \{\{user\}\}/)
    expect(ASSISTANT_TASK_DIRECTION).toMatch(/no closing offers of further help/)
  })

  it('the flattening signal names the failure and its usual cause', () => {
    expect(FLATTENING_DRIFT_SIGNAL).toMatch(/Flattening is drift, not character/)
    expect(FLATTENING_DRIFT_SIGNAL).toMatch(/absolute temperament rule/)
    expect(FLATTENING_DRIFT_SIGNAL).toMatch(/Never codify unflappable calm as a trait/)
  })
})
