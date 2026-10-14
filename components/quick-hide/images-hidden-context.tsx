'use client'

/**
 * Images-hidden context
 *
 * Carries the quick-hide "Salon Images" switch down a subtree without
 * plumbing a prop through every row. The Salon provides it from
 * `useQuickHide().hideSalonImages`; everywhere else the default (`false`)
 * applies, so shared components such as `Avatar` keep painting images on
 * every page but the one the operator asked to veil.
 *
 * @module components/quick-hide/images-hidden-context
 */

import { createContext, useContext, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'

const ImagesHiddenContext = createContext<boolean>(false)

export function ImagesHiddenProvider({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <ImagesHiddenContext.Provider value={hidden}>{children}</ImagesHiddenContext.Provider>
}

/** True when the surrounding subtree has asked for its images to be withheld. */
export function useImagesHidden(): boolean {
  return useContext(ImagesHiddenContext)
}

/**
 * Stand-in for an image thumbnail while images are hidden. Fills its parent
 * box, so it drops into the same sized container the `<img>` occupied.
 */
export function HiddenImageTile({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span
      className={`w-full h-full flex items-center justify-center qt-bg-muted qt-text-secondary ${className}`}
      title={label ? `Image hidden: ${label}` : 'Image hidden'}
      role="img"
      aria-label={label ? `Image hidden: ${label}` : 'Image hidden'}
    >
      <Icon name="eye-off" className="w-6 h-6" />
    </span>
  )
}

/** Inline stand-in for an image embedded in message prose. */
export function HiddenInlineImage({ alt }: { alt?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded qt-bg-muted qt-text-secondary text-xs align-middle"
      role="img"
      aria-label={alt ? `Image hidden: ${alt}` : 'Image hidden'}
    >
      <Icon name="eye-off" className="w-3 h-3" />
      {alt ? `Image hidden: ${alt}` : 'Image hidden'}
    </span>
  )
}
