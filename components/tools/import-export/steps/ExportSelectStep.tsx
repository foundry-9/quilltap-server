'use client'

import { LoadingSpinner } from '../components/LoadingSpinner'
import { SearchInput } from '../components/SearchInput'

interface Entity {
  id: string
  name: string
}

interface ExportSelectStepProps {
  scope: 'all' | 'selected'
  onScopeChange: (scope: 'all' | 'selected') => void
  selectedIds: string[]
  onToggleSelection: (id: string) => void
  availableEntities: Entity[]
  filteredEntities: Entity[]
  searchQuery: string
  onSearchChange: (query: string) => void
  loadingEntities: boolean
}

/**
 * Step 2: Select scope (all or specific entities) and choose entities
 */
export function ExportSelectStep({
  scope,
  onScopeChange,
  selectedIds,
  onToggleSelection,
  availableEntities,
  filteredEntities,
  searchQuery,
  onSearchChange,
  loadingEntities,
}: ExportSelectStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="scope"
            value="all"
            checked={scope === 'all'}
            onChange={() => onScopeChange('all')}
            className="w-4 h-4"
          />
          <span className="font-medium text-foreground">Export All</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="scope"
            value="selected"
            checked={scope === 'selected'}
            onChange={() => onScopeChange('selected')}
            className="w-4 h-4"
          />
          <span className="font-medium text-foreground">Select Specific</span>
        </label>
      </div>

      {scope === 'selected' && (
        <div className="space-y-3 mt-4 pt-4 border-t qt-border-default">
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search entities..."
          />

          {loadingEntities ? (
            <div className="flex justify-center py-6">
              <LoadingSpinner />
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="text-center py-6 qt-text-secondary">
              No entities found
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredEntities.map((entity) => (
                <label
                  key={entity.id}
                  className="flex items-center gap-3 p-2 hover:qt-bg-muted/50 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(entity.id)}
                    onChange={() => onToggleSelection(entity.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-foreground">{entity.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="text-sm qt-text-secondary pt-2">
            {selectedIds.length} of {availableEntities.length} selected
          </div>
        </div>
      )}
    </div>
  )
}
