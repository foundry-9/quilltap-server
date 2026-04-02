'use client'

import { TagEditor } from '@/components/tags/tag-editor'

interface TagsTabProps {
  characterId: string
}

export function TagsTab({ characterId }: TagsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Character Tags
          </h2>
          <p className="qt-text-small">
            Tags help organize and categorize this character. They can also be used for filtering and searching.
          </p>
        </div>
      </div>
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <TagEditor entityType="character" entityId={characterId} />
      </div>
    </div>
  )
}
