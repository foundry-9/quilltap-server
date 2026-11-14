/**
 * Character birthdays — the date rule and the age it implies.
 *
 * @jest-environment node
 */

import { BirthdaySchema, ageOn, birthdayOrNull, currentAge, dateStampIn } from '@/lib/characters/birthday'

describe('BirthdaySchema / birthdayOrNull', () => {
  it('takes a real YYYY-MM-DD date', () => {
    expect(BirthdaySchema.safeParse('1992-03-04').success).toBe(true)
    expect(BirthdaySchema.safeParse('2000-02-29').success).toBe(true)
    expect(birthdayOrNull('1992-03-04')).toBe('1992-03-04')
  })

  it('refuses dates that do not exist and other shapes', () => {
    for (const bad of ['2023-02-29', '1992-13-01', '1992-04-31', '1992-3-4', '04/03/1992', '', 'soon']) {
      expect(BirthdaySchema.safeParse(bad).success).toBe(false)
      expect(birthdayOrNull(bad)).toBeNull()
    }
    expect(birthdayOrNull(null)).toBeNull()
    expect(birthdayOrNull(19920304)).toBeNull()
  })
})

describe('ageOn', () => {
  it('counts whole years, turning over on the day itself', () => {
    expect(ageOn('1992-03-04', '2026-03-03')).toBe(33)
    expect(ageOn('1992-03-04', '2026-03-04')).toBe(34)
    expect(ageOn('1992-03-04', '2026-11-05')).toBe(34)
  })

  it('turns a leap-day birthday over on 1 March in common years', () => {
    expect(ageOn('2000-02-29', '2027-02-28')).toBe(26)
    expect(ageOn('2000-02-29', '2027-03-01')).toBe(27)
    expect(ageOn('2000-02-29', '2028-02-29')).toBe(28)
  })

  it('is null for a future birthday or an unreadable date', () => {
    expect(ageOn('2030-01-01', '2026-11-05')).toBeNull()
    expect(ageOn('nonsense', '2026-11-05')).toBeNull()
    expect(ageOn(null, '2026-11-05')).toBeNull()
    expect(ageOn('2026-11-05', '2026-11-05')).toBe(0)
  })
})

describe('dateStampIn / currentAge', () => {
  // 03:00 UTC on 5 November is still 4 November in Chicago.
  const NOW = Date.parse('2026-11-05T03:00:00Z')

  it('reads today on the given calendar', () => {
    expect(dateStampIn(NOW, 'UTC')).toBe('2026-11-05')
    expect(dateStampIn(NOW, 'America/Chicago')).toBe('2026-11-04')
  })

  it('falls back to the runtime zone for an unknown one rather than throwing', () => {
    expect(dateStampIn(NOW, 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('ages a character on their birthday in the calendar that is asked', () => {
    expect(currentAge('1992-11-05', NOW, 'UTC')).toBe(34)
    expect(currentAge('1992-11-05', NOW, 'America/Chicago')).toBe(33)
    expect(currentAge(null, NOW, 'UTC')).toBeNull()
  })
})
