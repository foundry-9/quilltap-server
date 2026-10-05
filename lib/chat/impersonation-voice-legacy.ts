/**
 * Translating the retired `impersonationVoiceRewrite` boolean into
 * `impersonationVoiceMode`.
 *
 * During 4.10 development the impersonated-line rehearsal was a single on/off
 * toggle, and "on" meant the model was called the moment the review dialog
 * opened. It became three states (`off` / `ask` / `always`), and an operator
 * who had switched it on is translated to `ask`: the dialog still opens, but
 * nothing is sent to a model until they ask for a restatement. That is the
 * deliberate behaviour change of record — the old eager call spent a request
 * on every impersonated line, including the ones never meant to be restated.
 *
 * One pure translation serves both paths that still meet the old shape: the
 * `impersonation-voice-mode-v1` migration and a backup restore taken during
 * 4.10 development.
 *
 * Pure — no I/O.
 *
 * @module chat/impersonation-voice-legacy
 */

import type { ImpersonationVoiceMode } from '@/lib/schemas/settings.types'

/** The retired column / field, as stored: SQLite INTEGER (0/1) or a JSON boolean. */
export type LegacyImpersonationVoiceRewrite = boolean | number | null | undefined

/** `true` / `1` → `'ask'`; anything else → `'off'`. */
export function impersonationVoiceModeFromLegacy(
  value: LegacyImpersonationVoiceRewrite,
): ImpersonationVoiceMode {
  return value === true || value === 1 ? 'ask' : 'off'
}

/** A settings record that may still carry the retired field. */
export type SettingsWithLegacyImpersonationVoice<T> = T & {
  impersonationVoiceRewrite?: LegacyImpersonationVoiceRewrite
  impersonationVoiceMode?: ImpersonationVoiceMode | null
}

/**
 * For a restore: when the record carries the retired boolean and no mode,
 * derive the mode and drop the old key. Returns the input unchanged (same
 * reference) when there is nothing to translate.
 */
export function withImpersonationVoiceModeFromLegacy<T extends object>(
  settings: SettingsWithLegacyImpersonationVoice<T>,
): SettingsWithLegacyImpersonationVoice<T> {
  if (!('impersonationVoiceRewrite' in settings)) return settings
  const { impersonationVoiceRewrite, ...rest } = settings
  return {
    ...rest,
    impersonationVoiceMode:
      settings.impersonationVoiceMode ?? impersonationVoiceModeFromLegacy(impersonationVoiceRewrite),
  } as SettingsWithLegacyImpersonationVoice<T>
}
