/**
 * Locks in the "probation" safeguards in the shared generator directions
 * (docs/developer/features/prompt-trust-the-probation.md §6).
 *
 * The companion trust disposition once told every generated prompt that the
 * character "remembers the times {{user}} was right as readily as the times
 * they slipped" — which models read as an instruction to keep a ledger. These
 * tests keep it out, and keep the positive half of trust in.
 */

import {
  COMMITTEE_DRIFT_GUARDRAIL,
  COMPANION_TRUST_DISPOSITION,
  EXAMPLE_DIALOGUE_COVERAGE,
  GATED_COMPANION_TRUST_DISPOSITION,
  TRUST_SAFEGUARDS_DIRECTION,
} from '@/lib/services/character-field-semantics'
import * as semantics from '@/lib/services/character-field-semantics'

describe('character-field-semantics — the probation', () => {
  it('no exported direction carries the slips ledger', () => {
    for (const [name, value] of Object.entries(semantics)) {
      if (typeof value !== 'string') continue
      expect({ name, hasSlipped: /slipped/i.test(value) }).toEqual({ name, hasSlipped: false })
    }
  })

  it('the companion disposition carries the positive half of trust', () => {
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/keeps no ledger/i)
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/forgiveness given is finished/i)
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/Ordinary requests get a yes/)
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/do not attach conditions/i)
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/received, not corrected/i)
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/never as obedience/i)
    expect(COMPANION_TRUST_DISPOSITION).toMatch(/honest objection/i)
    expect(GATED_COMPANION_TRUST_DISPOSITION).toContain(COMPANION_TRUST_DISPOSITION)
  })

  it('the universal safeguards forbid asserting {{user}}\'s interior and still forbid general deference', () => {
    expect(TRUST_SAFEGUARDS_DIRECTION).toMatch(/Six points/)
    expect(TRUST_SAFEGUARDS_DIRECTION).toMatch(/never tells \{\{user\}\} what \{\{user\}\} really meant/)
    expect(TRUST_SAFEGUARDS_DIRECTION).toMatch(/Do not write any instruction that tells the character to yield/)
  })

  it('example dialogues must model a plain yes', () => {
    expect(EXAMPLE_DIALOGUE_COVERAGE).toMatch(/agreeing plainly/i)
    expect(EXAMPLE_DIALOGUE_COVERAGE).toMatch(/most should not contain an objection/i)
  })

  it('the optimizer guardrail treats probation behaviour as drift', () => {
    expect(COMMITTEE_DRIFT_GUARDRAIL).toMatch(/probation behaviour/i)
    expect(COMMITTEE_DRIFT_GUARDRAIL).toMatch(/never codify agreement, warmth or following/i)
  })
})
