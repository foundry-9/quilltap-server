'use client'

interface GalleryEmptyProps {
  showOnlyTagged: boolean
  entityName: string
}

export function GalleryEmpty({ showOnlyTagged, entityName }: GalleryEmptyProps) {
  return (
    <div className="text-center py-12 border border-dashed border-border rounded-lg">
      <svg
        className="mx-auto h-12 w-12 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
      <p className="mt-2 qt-text-small">
        {showOnlyTagged
          ? `No photos tagged to ${entityName}`
          : 'No photos in your library'
        }
      </p>
      <p className="qt-text-label-xs mt-1">
        {showOnlyTagged
          ? 'Uncheck "Show only tagged" to see all photos and tag them'
          : `Generate or upload images to get started`
        }
      </p>
    </div>
  )
}
