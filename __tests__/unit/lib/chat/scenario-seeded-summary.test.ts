/**
 * The scenario-seeded-summary predicate (bug 158).
 *
 * Chat creation used to write the chosen scenario into `contextSummary` as well
 * as `scenarioText`. Creation is fixed and the migration cleared the rows on
 * disk, but an import or a restore carries whatever the source instance stored,
 * long after that migration has run — so every ingest path strips the seed on
 * the way in. These pin what "the seed" is, and what it is not.
 */

import {
  isScenarioSeededSummary,
  stripScenarioSeededSummary,
} from '@/lib/chat/scenario-seeded-summary'

const SCENARIO = "# Scenario: Amy's Pool\n\nAmy is in her pool, and Charlie walks up the path."

describe('isScenarioSeededSummary', () => {
  it('recognises a summary that is byte-identical to the scenario', () => {
    expect(isScenarioSeededSummary({ contextSummary: SCENARIO, scenarioText: SCENARIO })).toBe(true)
  })

  it('leaves a real summary alone, even one that quotes the scenario', () => {
    expect(
      isScenarioSeededSummary({
        contextSummary: `${SCENARIO}\n\nThen they argued about the spyglass.`,
        scenarioText: SCENARIO,
      })
    ).toBe(false)
  })

  it('is false when the chat has no scenario', () => {
    expect(isScenarioSeededSummary({ contextSummary: SCENARIO, scenarioText: null })).toBe(false)
    expect(isScenarioSeededSummary({ contextSummary: SCENARIO })).toBe(false)
  })

  it('is false when the chat has no summary', () => {
    expect(isScenarioSeededSummary({ contextSummary: null, scenarioText: SCENARIO })).toBe(false)
    expect(isScenarioSeededSummary({ scenarioText: SCENARIO })).toBe(false)
  })

  it('does not treat two empty strings as a seed', () => {
    expect(isScenarioSeededSummary({ contextSummary: '', scenarioText: '' })).toBe(false)
  })

  it('does not match on whitespace differences', () => {
    expect(
      isScenarioSeededSummary({ contextSummary: `${SCENARIO}\n`, scenarioText: SCENARIO })
    ).toBe(false)
  })
})

describe('stripScenarioSeededSummary', () => {
  it('nulls the summary and keeps the scenario', () => {
    const out = stripScenarioSeededSummary({
      title: 'Damp Curtains and Cold Water',
      contextSummary: SCENARIO,
      scenarioText: SCENARIO,
    })

    expect(out.contextSummary).toBeNull()
    expect(out.scenarioText).toBe(SCENARIO)
    expect(out.title).toBe('Damp Curtains and Cold Water')
  })

  it('returns a real summary untouched, by identity', () => {
    const row = { contextSummary: 'They argued about a wall.', scenarioText: SCENARIO }

    expect(stripScenarioSeededSummary(row)).toBe(row)
  })

  it('does not mutate the row it was given', () => {
    const row = { contextSummary: SCENARIO, scenarioText: SCENARIO }

    stripScenarioSeededSummary(row)

    expect(row.contextSummary).toBe(SCENARIO)
  })
})
