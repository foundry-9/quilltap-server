'use client'

/**
 * Group Editor — the body of a single group's page as a props-driven view, so
 * it renders either at `/aurora/groups/[id]` (route wrapper supplies a router
 * `onBack`) or in place inside the Aurora workspace tab (the list view supplies
 * a state `onBack`), keeping the workspace mounted for keep-alive.
 *
 * @module app/aurora/groups/[id]/GroupDetailView
 */

import { useId, useState } from 'react'
import { GroupMembersCard } from '../components/GroupMembersCard'
import { GroupLinkedStoresCard } from '../components/GroupLinkedStoresCard'
import { GroupScenariosCard } from '../components/GroupScenariosCard'
import { useGroupDetail } from '../hooks/useGroupDetail'
import { useGroupMembers } from '../hooks/useGroupMembers'
import { useOwnerStoreLinks } from '@/lib/hooks/use-owner-store-links'
import { Icon } from '@/components/ui/icon'
import StateEditorModal from '@/components/state/StateEditorModal'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import type { DocumentStore } from '../../types'

export interface GroupDetailViewProps {
  groupId: string
  onBack: () => void
}

export function GroupDetailView({ groupId, onBack }: GroupDetailViewProps) {
  const fieldId = useId()
  const [membersExpanded, setMembersExpanded] = useState(false)
  const [storesExpanded, setStoresExpanded] = useState(false)
  const [scenariosExpanded, setScenariosExpanded] = useState(false)
  const [showStateModal, setShowStateModal] = useState(false)

  // Every read here is a query under the `groups` prefix (or the character
  // and store lists), so the Aurora tab's activation refetch refreshes it and
  // never touches an edited form (#170).
  const { group, loading, error, formData, setFormData, saving, save } = useGroupDetail(groupId)
  const { members, allCharacters, addMember, removeMember } = useGroupMembers(groupId)
  const { linkedStores, allStores, linkStore, unlinkStore } = useOwnerStoreLinks<DocumentStore>('group', groupId)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!group) return
    await save()
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text">Loading group...</p>
      </div>
    )
  }

  if (error || !group) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">Error: {error || 'Group not found'}</p>
          <button onClick={onBack} className="qt-text-primary hover:qt-text-brand/80">
            Back to groups
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="qt-page-container qt-text">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-muted/70 p-2 qt-shadow-sm transition hover:qt-bg-muted"
          title="Go back"
        >
          <Icon name="chevron-left" className="w-5 h-5" />
        </button>
        <h1 className="qt-page-title">Edit Group</h1>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="max-w-2xl space-y-6">
        {/* Name */}
        <div>
          <label htmlFor={`${fieldId}-f0`} className="block text-sm font-medium qt-text mb-2">
            Group Name *
          </label>
          <input
            id={`${fieldId}-f0`}
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent qt-text text-sm"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor={`${fieldId}-f1`} className="block text-sm font-medium qt-text mb-2">
            Description
          </label>
          <textarea
            id={`${fieldId}-f1`}
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            rows={3}
            className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent qt-text text-sm resize-none"
            placeholder="Optional description of this group"
          />
        </div>

        {/* Group Instructions — the group's standing prompt. The form only
            renders after the group has loaded, so mounting on groupId is
            enough for the editor to see the fetched value. */}
        <div>
          <PromptFieldLabel hint={PROMPT_FIELD_HINTS.groupInstructions} optional />
          <MarkdownLexicalEditor
            value={formData.instructions}
            onChange={(value) => setFormData(prev => ({ ...prev, instructions: value }))}
            remountKey={groupId}
            namespace="GroupDetailView.instructions"
            ariaLabel="Group instructions"
            minHeight="14rem"
          />
        </div>

        {/* Color */}
        <div>
          <label htmlFor={`${fieldId}-f2`} className="block text-sm font-medium qt-text mb-2">
            Color
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`${fieldId}-f2`}
              type="color"
              value={formData.color || '#808080'}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              className="w-12 h-10 rounded-lg cursor-pointer"
            />
            <input
              aria-label="Group color (hex value)"
              type="text"
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              placeholder="#000000"
              className="flex-1 px-4 py-2 rounded-lg border qt-border-default bg-transparent qt-text text-sm"
            />
          </div>
        </div>

        {/* Icon (emoji) */}
        <div>
          <label htmlFor={`${fieldId}-f3`} className="block text-sm font-medium qt-text mb-2">
            Icon (emoji)
          </label>
          <input
            id={`${fieldId}-f3`}
            type="text"
            value={formData.icon}
            onChange={(e) => setFormData(prev => ({ ...prev, icon: e.target.value }))}
            maxLength={2}
            className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent qt-text text-sm"
            placeholder="e.g., 👥 or 🎭"
          />
        </div>

        {/* Save button */}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="qt-button qt-button-primary inline-flex items-center rounded-lg px-6 py-2 font-semibold qt-shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => setShowStateModal(true)}
            className="qt-button qt-button-secondary inline-flex items-center rounded-lg px-6 py-2 font-semibold qt-shadow-sm"
          >
            Group State
          </button>
        </div>
      </form>

      {/* Management sections */}
      <div className="mt-12 space-y-6">
        <GroupMembersCard
          members={members}
          allCharacters={allCharacters}
          expanded={membersExpanded}
          onToggle={() => setMembersExpanded(!membersExpanded)}
          onAdd={addMember}
          onRemove={removeMember}
        />

        <GroupLinkedStoresCard
          linkedStores={linkedStores}
          allStores={allStores}
          expanded={storesExpanded}
          onToggle={() => setStoresExpanded(!storesExpanded)}
          onLink={linkStore}
          onUnlink={unlinkStore}
        />

        <GroupScenariosCard
          groupId={groupId}
          expanded={scenariosExpanded}
          onToggle={() => setScenariosExpanded(!scenariosExpanded)}
        />
      </div>

      <StateEditorModal
        isOpen={showStateModal}
        onClose={() => setShowStateModal(false)}
        entityType="group"
        entityId={groupId}
        entityName={group.name}
      />
    </div>
  )
}
