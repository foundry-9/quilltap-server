'use client'

import type { SVGProps } from 'react'

/**
 * The app's drawn loading spinner: a faint ring with a bright quarter-arc,
 * turning. It takes the colour of the text around it (`currentColor`), so a
 * caller sets the colour with a `qt-text-*` class and the size with `w-*`/`h-*`.
 *
 * The CSS-only `qt-spinner` (a bordered ring the theme can recolour) is the
 * other spinner; this one is for places that want the glyph to follow text.
 */
export function Spinner({ className, ...rest }: Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox' | 'fill'>) {
  return (
    <svg className={className ? `animate-spin ${className}` : 'animate-spin'} fill="none" viewBox="0 0 24 24" {...rest}>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export default Spinner
