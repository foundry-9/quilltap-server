'use client'

import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { ProfileCard } from './ProfileCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import type { ConnectionProfile, ProviderConfig } from './types'

interface ProfileListProps {
  profiles: ConnectionProfile[]
  cheapDefaultProfileId: string | null
  /** List of provider configurations to check API key requirements */
  providers?: ProviderConfig[]
  showForm: boolean
  deleteConfirming: string | null
  isDeleting: boolean
  onEdit: (profile: ConnectionProfile) => void
  onDelete: (profileId: string) => void
  onDeleteConfirmChange: (profileId: string | null) => void
  onAddClick: () => void
  onReorder?: (order: Array<{ id: string; sortIndex: number }>) => void
  onResetSort?: () => void
  onAutoConfigure?: (profileId: string) => void
  autoConfiguringId?: string | null
}

/**
 * List of connection profile cards with drag-and-drop reordering
 * Displays all profiles sorted by sortIndex with empty state
 */
export function ProfileList({
  profiles,
  cheapDefaultProfileId,
  providers = [],
  showForm,
  deleteConfirming,
  isDeleting,
  onEdit,
  onDelete,
  onDeleteConfirmChange,
  onAddClick,
  onReorder,
  onResetSort,
  onAutoConfigure,
  autoConfiguringId,
}: ProfileListProps) {
  // Helper to check if a provider requires an API key
  const providerRequiresApiKey = (providerName: string): boolean => {
    const provider = providers.find((p) => p.name === providerName)
    // Default to true (safer) if provider not found
    return provider?.configRequirements?.requiresApiKey ?? true
  }

  // Sort profiles by sortIndex (API returns them sorted, but ensure client matches)
  const sortedProfiles = [...profiles].sort((a, b) => {
    const aIndex = a.sortIndex ?? 0
    const bIndex = b.sortIndex ?? 0
    if (aIndex !== bIndex) return aIndex - bIndex
    return a.name.localeCompare(b.name)
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !onReorder) return

      const oldIndex = sortedProfiles.findIndex((p) => p.id === active.id)
      const newIndex = sortedProfiles.findIndex((p) => p.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      // Reorder the array
      const reordered = [...sortedProfiles]
      const [moved] = reordered.splice(oldIndex, 1)
      reordered.splice(newIndex, 0, moved)

      // Build new sort order
      const order = reordered.map((profile, index) => ({
        id: profile.id,
        sortIndex: index,
      }))

      onReorder(order)
    },
    [sortedProfiles, onReorder]
  )

  return (
    <div className="mb-8">
      <SectionHeader
        title="Connection Profiles"
        count={profiles.length}
        level="h2"
        action={{
          label: '+ Add Profile',
          onClick: onAddClick,
          show: !showForm,
        }}
      />

      {/* Reset Sort button */}
      {profiles.length > 1 && onResetSort && (
        <div className="flex justify-end mb-3 -mt-2">
          <button
            onClick={onResetSort}
            className="qt-button-secondary qt-button-sm"
          >
            Reset Sort Order
          </button>
        </div>
      )}

      {profiles.length === 0 ? (
        <EmptyState
          title="No connection profiles yet"
          description="Create one to start chatting."
          action={{
            label: 'Create Profile',
            onClick: onAddClick,
          }}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedProfiles.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {sortedProfiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  cheapDefaultProfileId={cheapDefaultProfileId}
                  providerRequiresApiKey={providerRequiresApiKey(profile.provider)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  deleteConfirming={deleteConfirming}
                  onDeleteConfirmChange={onDeleteConfirmChange}
                  isDeleting={isDeleting}
                  onAutoConfigure={onAutoConfigure}
                  isAutoConfiguring={autoConfiguringId === profile.id}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
