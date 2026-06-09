'use client'

import { Icon } from '@/components/ui/icon'

interface GalleryEmptyProps {
  /** Retained for API compatibility; ignored post-Phase-3. */
  showOnlyTagged?: boolean
  entityName: string
}

export function GalleryEmpty({ entityName }: GalleryEmptyProps) {
  return (
    <div className="text-center py-12 border border-dashed qt-border-default rounded-lg">
      <Icon name="image" className="mx-auto h-12 w-12 qt-text-secondary" />
      <p className="mt-2 qt-text-small">No photos in {entityName}&rsquo;s album yet</p>
      <p className="qt-text-label-xs mt-1">
        Upload one with the button above, or have {entityName} <code>keep_image</code> a generated image to start the album
      </p>
    </div>
  )
}
