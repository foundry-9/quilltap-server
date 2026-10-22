import { getInterventionSummary } from './system-message-labels'
import type { Message } from '../types'

type Meta = NonNullable<Message['pascalMeta']>

/** A Pascal roll as announced (top level) with the record of what was first dealt. */
function pascal(
  changed: string[],
  final: Partial<Meta> = {},
  dealt: Record<string, unknown> = {},
  sender: Message['systemSender'] = 'pascal',
): Pick<Message, 'systemSender' | 'pascalMeta'> {
  return {
    systemSender: sender,
    pascalMeta: {
      tool: 'wager',
      definitionTier: 'global',
      definitionMountId: 'mount-1',
      params: { bonus: 4 },
      rollForm: 'range',
      raw: 0.8,
      value: 80,
      state: 'success',
      outcomeIndex: 1,
      invokedBy: 'llm',
      intervention: {
        resolvedAt: '2026-05-02T00:00:00.000Z',
        decision: 'deal',
        changed,
        dealt: {
          params: { bonus: 0 },
          raw: 0.123456,
          value: 12,
          outcomeIndex: 0,
          state: 'failure',
          message: 'dealt',
          visibility: 'public',
          announcer: 'pascal',
          ...dealt,
        },
      },
      ...final,
    } as Meta,
  }
}

describe('getInterventionSummary', () => {
  it('is null for a message with no pascalMeta at all', () => {
    expect(getInterventionSummary({ systemSender: 'pascal', pascalMeta: null })).toBeNull()
    expect(getInterventionSummary({ systemSender: 'pascal' })).toBeNull()
  })

  it('is null when the roll was never held (no intervention record)', () => {
    const message = pascal(['roll'])
    delete (message.pascalMeta as Meta).intervention
    expect(getInterventionSummary(message)).toBeNull()
  })

  it('is null when nothing changed', () => {
    expect(getInterventionSummary(pascal([]))).toBeNull()
  })

  it('is null for a message not from Pascal, whatever it carries', () => {
    expect(getInterventionSummary(pascal(['roll'], {}, {}, 'host'))).toBeNull()
  })

  it('lists a roll change as dealt → final, to four significant digits', () => {
    expect(getInterventionSummary(pascal(['roll']))).toBe('Adjusted before it was dealt: roll 0.1235 → 0.8')
  })

  it('lists dice faces when both records have them', () => {
    const message = pascal(['roll'], { diceRolls: [6, 6] }, { diceRolls: [1, 2] })
    expect(getInterventionSummary(message)).toBe('Adjusted before it was dealt: dice [1, 2] → [6, 6]')
  })

  it('lists an outcome change by one-based row number', () => {
    expect(getInterventionSummary(pascal(['outcome']))).toBe('Adjusted before it was dealt: outcome row 1 → 2')
  })

  it('lists parameter changes by name', () => {
    expect(getInterventionSummary(pascal(['params.bonus']))).toBe('Adjusted before it was dealt: bonus 0 → 4')
  })

  it('joins several changes in the order recorded', () => {
    expect(getInterventionSummary(pascal(['roll', 'outcome', 'params.bonus']))).toBe(
      'Adjusted before it was dealt: roll 0.1235 → 0.8; outcome row 1 → 2; bonus 0 → 4',
    )
  })

  it('reads the other fields in words, never quoting a rewritten message', () => {
    const summary = getInterventionSummary(
      pascal(['value', 'state', 'message', 'llmAnswer', 'effects.1'], {}, { message: 'DEALT-TEXT' }),
    )
    expect(summary).toBe(
      "Adjusted before it was dealt: value 12 → 80; verdict failure → success; message rewritten; the oracle's answer replaced; effect 2 changed",
    )
    expect(summary).not.toContain('DEALT-TEXT')
  })

  it('names presentation changes', () => {
    const message = pascal(['visibility', 'announcer', 'title', 'chipLabel'], { toolTitle: 'New', chipLabel: 'B' }, {
      toolTitle: 'Old',
      chipLabel: 'A',
    })
    expect(getInterventionSummary(message)).toBe(
      'Adjusted before it was dealt: public → whisper; announced by the character, not Pascal; title "Old" → "New"; label "A" → "B"',
    )
  })

  it('passes an unknown key through rather than hiding it', () => {
    expect(getInterventionSummary(pascal(['something-new']))).toBe('Adjusted before it was dealt: something-new')
  })
})
