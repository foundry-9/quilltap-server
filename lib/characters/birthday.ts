/**
 * Character birthdays — a real calendar date, and the age it implies.
 *
 * A birthday is optional. When it is set, the character has a definite age
 * that is CALCULATED, never stored: it goes up by one every year on the day,
 * with nobody having to edit anything. When it is absent the character's age
 * is whatever their prose says, exactly as before this field existed.
 *
 * ## Shape
 *
 * `YYYY-MM-DD`, a calendar date with no time and no zone — a birthday is a day,
 * not an instant. Stored in the character vault's `properties.json` beside the
 * pronouns, so it travels with the vault, exports and shared vaults.
 *
 * ## Which "today"
 *
 * Age is counted against today's date on the instance calendar (the same
 * timezone the Commonplace Book uses), passed in by the caller as a
 * `YYYY-MM-DD` stamp. The wall clock, not a chat's fictional date — a
 * birthday belongs to the character across every chat, the way a progression
 * does.
 *
 * ## 29 February
 *
 * Someone born on a leap day turns a year older on 1 March in common years
 * (they have not yet reached "February 29" on the 28th). Plain month/day
 * comparison gives exactly that.
 *
 * CLIENT-SAFE: Zod and `Intl` only. The Aurora editor previews the age with it.
 */

import { z } from 'zod'

const BIRTHDAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

interface DateParts {
  year: number
  month: number
  day: number
}

/** Parse a `YYYY-MM-DD` stamp into a real calendar date, or null. */
function parseDateStamp(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null
  const match = BIRTHDAY_PATTERN.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return null
  // Day 0 of the next month is the last day of this one — rejects 2023-02-29.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return { year, month, day }
}

/** A real calendar date written `YYYY-MM-DD`. */
export const BirthdaySchema = z
  .string()
  .refine((value) => parseDateStamp(value) !== null, {
    message: 'must be a real calendar date written YYYY-MM-DD',
  })

/**
 * Normalize whatever a vault file holds to a birthday or null. Lenient on
 * purpose: `properties.json` is hand-editable, and a typo here must read as
 * "no birthday" rather than failing the strict parse and hollowing every
 * field that file owns.
 */
export function birthdayOrNull(value: unknown): string | null {
  return parseDateStamp(value) ? (value as string).trim() : null
}

/**
 * Whole years from `birthday` to `today` (both `YYYY-MM-DD`). Null when
 * either is not a real date or the birthday is still in the future.
 */
export function ageOn(birthday: string | null | undefined, today: string): number | null {
  const born = parseDateStamp(birthday)
  const now = parseDateStamp(today)
  if (!born || !now) return null
  let age = now.year - born.year
  if (now.month < born.month || (now.month === born.month && now.day < born.day)) age--
  return age >= 0 ? age : null
}

/** Today's date as `YYYY-MM-DD` in `timeZone` (the runtime's own zone when omitted). */
export function dateStampIn(nowMs: number, timeZone?: string): string {
  const format = (tz?: string) =>
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    }).format(new Date(nowMs))
  try {
    return format(timeZone)
  } catch {
    // An unresolvable zone must not cost the character their age.
    return format()
  }
}

/** The age a character with this birthday is right now, or null. */
export function currentAge(
  birthday: string | null | undefined,
  nowMs: number,
  timeZone?: string,
): number | null {
  if (!birthday) return null
  return ageOn(birthday, dateStampIn(nowMs, timeZone))
}
