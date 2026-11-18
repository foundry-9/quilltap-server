/**
 * The kind-specific generator directions
 * (docs/developer/features/complete/character-kind-and-roleplay-defaults.md §5.5).
 *
 * A roleplay character's generated prompt says how they react when the story
 * turns, and must never encode a temperament as an absolute; an assistant's
 * says how they do the work. Flattening is drift for a story character only.
 */

import {
  ASSISTANT_TASK_DIRECTION,
  COMMITTEE_DRIFT_GUARDRAIL,
  FLATTENING_DRIFT_SIGNAL,
  SANITIZING_DRIFT_SIGNAL,
  STORY_LATITUDE_DIRECTION,
  TRUST_SAFEGUARDS_DIRECTION,
  STAKES_AND_REACTION_DIRECTION,
  generatorDirectionFor,
  kindDriftSignalFor,
} from '@/lib/services/character-field-semantics'

describe('character-field-semantics — the stakes', () => {
  it('chooses the direction by kind', () => {
    expect(generatorDirectionFor('roleplay')).toBe(`${STAKES_AND_REACTION_DIRECTION}\n${STORY_LATITUDE_DIRECTION}`)
    expect(generatorDirectionFor('assistant')).toBe(ASSISTANT_TASK_DIRECTION)
  })

  it('chooses the drift signal by kind', () => {
    expect(kindDriftSignalFor('roleplay')).toBe(`${FLATTENING_DRIFT_SIGNAL}\n${SANITIZING_DRIFT_SIGNAL}`)
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

  // docs/developer/features/roleplay-character-latitude.md §5.4
  it('the latitude direction writes flaws as working parts and keeps the trust line', () => {
    expect(STORY_LATITUDE_DIRECTION).toMatch(/Flaws and bad motives are written as working parts, not softened/)
    expect(STORY_LATITUDE_DIRECTION).toMatch(/Do not add a conscience, a redemption or a hidden kindness/)
    expect(STORY_LATITUDE_DIRECTION).toMatch(/opposition is never votes, sign-offs, conditions or a tally of slips/)
    expect(STORY_LATITUDE_DIRECTION).toMatch(/never invent a fact about a place to win an argument with \{\{user\}\}/)
    expect(STORY_LATITUDE_DIRECTION).toMatch(/never decide what \{\{user\}\} did/)
    expect(STORY_LATITUDE_DIRECTION).toMatch(/a life that presses on them/)
  })

  it('the latitude direction leaves the trust safeguards and the assistant direction as they were', () => {
    expect(TRUST_SAFEGUARDS_DIRECTION).toMatch(/never invents a physical fact about a place to win an argument/)
    expect(generatorDirectionFor('assistant')).not.toContain(STORY_LATITUDE_DIRECTION)
    expect(ASSISTANT_TASK_DIRECTION).toMatch(/never invent facts/)
  })

  it('the sanitizing signal is measured only against the definition and never makes warmth a fault', () => {
    expect(SANITIZING_DRIFT_SIGNAL).toMatch(/Sanitizing is drift, not character/)
    expect(SANITIZING_DRIFT_SIGNAL).toMatch(/Measure this only against the character's own definition/)
    expect(SANITIZING_DRIFT_SIGNAL).toMatch(/Warmth, agreement and going along with \{\{user\}\} are never drift in a character who was not written otherwise/)
    expect(SANITIZING_DRIFT_SIGNAL).toMatch(/nothing here licenses conditions, tallies or approvals aimed at \{\{user\}\}/)
    // The probation guardrail it must not contradict.
    expect(COMMITTEE_DRIFT_GUARDRAIL).toMatch(/never codify agreement, warmth or following \{\{user\}\}'s lead as a weakness or a drift risk/)
  })
})
