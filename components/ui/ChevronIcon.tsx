/**
 * Shared chevron/disclosure icon.
 *
 * @deprecated Thin wrapper around the central <Icon> primitive, kept so the
 * icon migration can proceed incrementally. Prefer
 * `<Icon name="chevron-down" className={expanded ? 'rotate-180' : ''} />`.
 * The rotation is a `className` concern — the icon glyph itself is the shared
 * downward chevron.
 *
 * @module components/ui/ChevronIcon
 */

import { Icon } from '@/components/ui/icon';

interface ChevronIconProps {
  className?: string
  /** Whether the chevron should be rotated 180° (expanded state). */
  expanded?: boolean
  /** Alias for `expanded` — used by sidebar sections. */
  rotated?: boolean
}

export function ChevronIcon({ className, expanded, rotated }: ChevronIconProps) {
  const isRotated = expanded || rotated
  const classes = [
    className ?? '',
    'transition-transform duration-200',
    isRotated ? 'rotate-180' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return <Icon name="chevron-down" className={classes} />
}
