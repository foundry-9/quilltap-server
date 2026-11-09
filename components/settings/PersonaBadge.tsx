'use client'

/**
 * The persona badge a settings card wears: the responsible member of staff's
 * thumbnail, named in `alt` and described in the tooltip. Reads the
 * theme-resolved subsystem, so a theme that renames or re-images a persona
 * changes every badge.
 *
 * @module components/settings/PersonaBadge
 */

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import type { SettingsPersona } from '@/lib/settings/registry'

export function PersonaBadge({ persona }: { persona: SettingsPersona }) {
  const info = useSubsystemInfo(persona)
  const tooltip = `${info.name} — ${info.description}`
  return (
    <span className="qt-settings-persona-badge" title={tooltip} data-persona={persona}>
      {info.thumbnail ? (
        // Plain <img>: theme art is a runtime URL Next/Image cannot pre-size.
        <img src={info.thumbnail} alt={info.name} />
      ) : (
        <span role="img" aria-label={info.name}>{info.name.replace(/^The /, '').charAt(0)}</span>
      )}
    </span>
  )
}
