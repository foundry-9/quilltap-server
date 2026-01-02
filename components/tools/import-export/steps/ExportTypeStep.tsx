'use client'

import { ENTITY_TYPE_LABELS } from '../types'
import type { ExportEntityType } from '@/lib/export/types'

interface ExportTypeStepProps {
  entityType: ExportEntityType | null
  onEntityTypeChange: (type: ExportEntityType) => void
}

// Entity types that can be exported (excludes 'personas' - migrated to characters)
const EXPORTABLE_TYPES: ExportEntityType[] = [
  'characters',
  'chats',
  'roleplay-templates',
  'connection-profiles',
  'image-profiles',
  'embedding-profiles',
  'tags',
]

/**
 * Step 1: Select the type of data to export
 */
export function ExportTypeStep({
  entityType,
  onEntityTypeChange,
}: ExportTypeStepProps) {
  return (
    <div className="space-y-4">
      <p className="qt-text-small text-muted-foreground">
        Select the type of data you want to export.
      </p>
      <div className="space-y-2">
        {EXPORTABLE_TYPES.map((type) => (
          <label
            key={type}
            className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors ${
              entityType === type
                ? 'border-primary bg-accent'
                : 'border-border bg-background hover:border-primary/50'
            }`}
          >
            <input
              type="radio"
              name="entity-type"
              value={type}
              checked={entityType === type}
              onChange={() => onEntityTypeChange(type)}
              className="w-4 h-4"
            />
            <span className="ml-3 font-medium text-foreground">
              {ENTITY_TYPE_LABELS[type]}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
