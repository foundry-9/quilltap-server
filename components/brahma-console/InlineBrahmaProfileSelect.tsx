'use client'

/**
 * InlineBrahmaProfileSelect
 *
 * A native `<select>` of the user's connection profiles for choosing which model
 * answers an inline `@Brahma:` / `@Brahma?` consultation. Used by the global
 * setting (Settings → Chat → Brahma Console) and the per-project override
 * (Prospero project page → Model Behavior). The empty value means "inherit" —
 * the caller names what is inherited via `inheritLabel`. A saved id that no
 * longer names a profile is shown as such (the server falls through past it).
 *
 * Callers supply the accessible name: a `<label htmlFor={id}>` or
 * `ariaLabelledBy`.
 */

import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'

interface InlineBrahmaProfileSelectProps {
  id?: string
  ariaLabelledBy?: string
  value: string | null | undefined
  onChange: (profileId: string | null) => void
  inheritLabel: string
  disabled?: boolean
  className?: string
}

export function InlineBrahmaProfileSelect({
  id,
  ariaLabelledBy,
  value,
  onChange,
  inheritLabel,
  disabled,
  className = 'qt-select w-full max-w-md',
}: InlineBrahmaProfileSelectProps) {
  const { profiles, loading } = useConnectionProfiles()
  const selected = value ?? ''
  const selectedMissing = !loading && selected !== '' && !profiles.some((p) => p.id === selected)

  return (
    <select
      id={id}
      aria-labelledby={ariaLabelledBy}
      className={className}
      value={selected}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{inheritLabel}</option>
      {selectedMissing && (
        <option value={selected}>(a profile that has since left the building)</option>
      )}
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.provider}
          {p.modelName ? ` • ${p.modelName}` : ''})
          {p.isDefault ? ' — your default' : ''}
          {!p.allowToolUse ? ' — no tools' : ''}
        </option>
      ))}
    </select>
  )
}
