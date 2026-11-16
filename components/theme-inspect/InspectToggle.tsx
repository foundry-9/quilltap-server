'use client'

/**
 * The "Inspect" toggle, in the Atelier and in the specimen gallery. Turns
 * inspect mode on and off; Escape also turns it off.
 *
 * @module components/theme-inspect/InspectToggle
 */

import { Icon } from '@/components/ui/icon'
import { useInspectOptional } from './InspectProvider'

export function InspectToggle({ className = 'qt-button qt-button-sm' }: { className?: string }) {
  const inspect = useInspectOptional()
  if (!inspect) return null
  const on = inspect.active
  return (
    <button
      type="button"
      className={`${className} ${on ? 'qt-button-primary' : 'qt-button-secondary'}`}
      aria-pressed={on}
      onClick={() => inspect.setActive(!on)}
      title={on ? 'Stop inspecting (Escape)' : 'Point at anything in Quilltap to see its hook and tokens'}
    >
      <Icon name="search" className="w-4 h-4" />
      <span className="ml-1">{on ? 'Inspecting' : 'Inspect'}</span>
    </button>
  )
}
