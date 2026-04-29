'use client'

import { use, useEffect, useState } from 'react'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { EntityTabs, Tab } from '@/components/tabs'
import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { ClothingRecordList } from '@/components/clothing-records'
import { WardrobeItemList } from '@/components/wardrobe'
import { RenameReplaceTab } from '@/components/characters/RenameReplaceTab'
import { SystemPromptsEditor } from '@/components/characters/SystemPromptsEditor'
import { AIWizardModal, type GeneratedCharacterData, normalizeGeneratedScenarios } from '@/components/characters/ai-wizard'
import LLMLogsSection from '@/components/characters/LLMLogsSection'
import { useCharacterEdit } from './hooks'
import { CharacterBasicInfo } from './components'
import type { CharacterScenario } from './types'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

/**
 * Tab configuration for character edit page
 */
const EDIT_CHARACTER_TABS: Tab[] = [
  {
    id: 'details',
    label: 'Details',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'system-prompts',
    label: 'System Prompts',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
  {
    id: 'descriptions',
    label: 'Appearance',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'rename',
    label: 'Rename/Replace',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
]

/**
 * Main character edit page component
 * Orchestrates the editing of character information across multiple tabs
 */
export default function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const {
    loading,
    saving,
    error,
    character,
    formData,
    showAvatarSelector,
    showUploadDialog,
    avatarRefreshKey,
    handleChange,
    handleAliasesChange,
    handlePronounsChange,
    handleScenariosChange,
    handleSystemTransparencyChange,
    handleSubmit,
    handleCancel,
    handleReadFromDocStoreToggle,
    handleSyncPropertiesFromVault,
    handleSyncPropertiesToVault,
    setCharacterAvatar,
    getAvatarSrc,
    toggleAvatarSelector,
    toggleUploadDialog,
    fetchCharacter,
    isNpc,
  } = useCharacterEdit(id)

  const [showWizard, setShowWizard] = useState(false)
  const [physicalDescriptionsRefreshKey, setPhysicalDescriptionsRefreshKey] = useState(0)
  const [wardrobeRefreshKey, setWardrobeRefreshKey] = useState(0)

  // Wrap the sync-from-vault handler so the child lists that fetch their own
  // data (physical descriptions, wardrobe items, outfit presets) re-query
  // after the DB is updated. handleSyncPropertiesFromVault itself refetches
  // the character row; these lists hang off refreshKey props instead.
  const handleSyncPropertiesFromVaultAndRefreshLists = async () => {
    await handleSyncPropertiesFromVault()
    setPhysicalDescriptionsRefreshKey((prev) => prev + 1)
    setWardrobeRefreshKey((prev) => prev + 1)
  }

  // The reverse direction doesn't change the DB, but when the overlay is on,
  // the overlaid values the child lists read are derived from vault files;
  // pushing DB→vault therefore needs the same refresh so lists reflect the
  // freshly-written vault state.
  const handleSyncPropertiesToVaultAndRefreshLists = async () => {
    await handleSyncPropertiesToVault()
    setPhysicalDescriptionsRefreshKey((prev) => prev + 1)
    setWardrobeRefreshKey((prev) => prev + 1)
  }


  // Handle applying wizard-generated data
  const handleWizardApply = async (data: GeneratedCharacterData) => {
    // Apply text fields by creating synthetic events
    const fieldsToApply: Array<{ name: string; value: string }> = []

    if (data.name) fieldsToApply.push({ name: 'name', value: data.name })
    if (data.title) fieldsToApply.push({ name: 'title', value: data.title })
    if (data.identity) fieldsToApply.push({ name: 'identity', value: data.identity })
    if (data.description) fieldsToApply.push({ name: 'description', value: data.description })
    if (data.personality) fieldsToApply.push({ name: 'personality', value: data.personality })
    if (data.exampleDialogues) fieldsToApply.push({ name: 'exampleDialogues', value: data.exampleDialogues })
    if (data.systemPrompt) fieldsToApply.push({ name: 'systemPrompt', value: data.systemPrompt })

    // Apply each field
    for (const field of fieldsToApply) {
      const syntheticEvent = {
        target: { name: field.name, value: field.value },
      } as React.ChangeEvent<HTMLInputElement>
      handleChange(syntheticEvent)
    }

    // Handle physical description if generated
    if (data.physicalDescription) {
      try {
        // Use the correct API endpoint for character physical descriptions
        const response = await fetch(`/api/v1/characters/${id}/descriptions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.physicalDescription.name,
            shortPrompt: data.physicalDescription.shortPrompt,
            mediumPrompt: data.physicalDescription.mediumPrompt,
            longPrompt: data.physicalDescription.longPrompt,
            completePrompt: data.physicalDescription.completePrompt,
            fullDescription: data.physicalDescription.fullDescription,
          }),
        })

        if (response.ok) {
          showSuccessToast('Physical description created')
          // Trigger refresh of PhysicalDescriptionList without wiping form state
          setPhysicalDescriptionsRefreshKey((prev) => prev + 1)
        } else {
          const errorData = await response.json()
          showErrorToast(errorData.error || 'Failed to create physical description')
        }
      } catch (err) {
        console.error('Failed to create physical description', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast('Failed to create physical description')
      }
    }

    // Handle wizard-generated wardrobe items
    if (data.wardrobeItems && data.wardrobeItems.length > 0) {
      let wardrobeItemsSaved = 0
      for (const item of data.wardrobeItems) {
        try {
          const res = await fetch(`/api/v1/characters/${id}/wardrobe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: item.title,
              description: item.description || null,
              types: item.types,
              appropriateness: item.appropriateness || null,
            }),
          })
          if (res.ok) {
            wardrobeItemsSaved++
          }
        } catch (err) {
          console.error('Failed to create wardrobe item', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (wardrobeItemsSaved > 0) {
        showSuccessToast(`${wardrobeItemsSaved} wardrobe item${wardrobeItemsSaved > 1 ? 's' : ''} created`)
        setWardrobeRefreshKey((prev) => prev + 1)
      }
    }

    // Handle wizard-generated scenarios
    const normalizedScenarios = normalizeGeneratedScenarios(data.scenarios)
    if (normalizedScenarios.length > 0) {
      let scenariosSaved = 0
      const savedScenarios: CharacterScenario[] = []
      for (const scenario of normalizedScenarios) {
        try {
          const res = await fetch(`/api/v1/characters/${id}/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: scenario.title, content: scenario.content }),
          })
          if (res.ok) {
            const resData = await res.json()
            scenariosSaved++
            // Collect saved scenario with its server-assigned ID
            if (resData.scenario) {
              savedScenarios.push({
                id: resData.scenario.id,
                title: resData.scenario.title,
                content: resData.scenario.content,
                createdAt: resData.scenario.createdAt,
                updatedAt: resData.scenario.updatedAt,
              })
            }
          }
        } catch (err) {
          console.error('Failed to create scenario', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (scenariosSaved > 0) {
        showSuccessToast(`${scenariosSaved} scenario${scenariosSaved > 1 ? 's' : ''} created`)
        // Update scenarios in form state directly instead of re-fetching
        // (fetchCharacter would overwrite wizard-applied text fields that haven't been saved yet)
        handleScenariosChange([...(formData.scenarios || []), ...savedScenarios])
      }
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character...</p>
      </div>
    )
  }

  const avatarSrc = getAvatarSrc()

  return (
    <div className="character-edit qt-page-container text-foreground">
      {/* Header Section */}
      <div className="mb-8">
        <button
          onClick={handleCancel}
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          {isNpc ? '← Back to NPCs' : '← Back'}
        </button>
        <div className="flex items-center gap-4">
          {/* Avatar Display */}
          <div className="relative">
            {avatarSrc ? (
               
              <img
                key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                src={avatarSrc}
                alt={character?.name || ''}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full qt-bg-muted">
                <span className="qt-heading-1 qt-text-secondary">
                  {character?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <button
              onClick={() => toggleAvatarSelector(true)}
              className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground qt-shadow-lg transition hover:qt-bg-primary/90"
              title="Change avatar"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>

          {/* Title and AI Wizard Button */}
          <div className="flex-1 flex items-center justify-between">
            <h1 className="qt-heading-1">
              Edit: {character?.name || 'Loading...'}
            </h1>
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="qt-button-secondary flex items-center gap-2"
              title="Use AI to generate character details"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI Wizard
            </button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 rounded border qt-border-destructive/40 qt-bg-destructive/10 px-4 py-3 qt-text-destructive">
          {error}
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit}>
        <EntityTabs tabs={EDIT_CHARACTER_TABS} defaultTab="details">
          {(activeTab: string) => {
            switch (activeTab) {
              case 'details':
                return (
                  <CharacterBasicInfo
                    characterId={id}
                    formData={formData}
                    hasLinkedVault={!!character?.characterDocumentMountPointId}
                    onChange={handleChange}
                    onAliasesChange={handleAliasesChange}
                    onPronounsChange={handlePronounsChange}
                    onScenariosChange={handleScenariosChange}
                    onSystemTransparencyChange={handleSystemTransparencyChange}
                    onReadFromDocStoreToggle={handleReadFromDocStoreToggle}
                    onSyncPropertiesFromVault={handleSyncPropertiesFromVaultAndRefreshLists}
                    onSyncPropertiesToVault={handleSyncPropertiesToVaultAndRefreshLists}
                  />
                )

              case 'system-prompts':
                return (
                  <SystemPromptsEditor
                    characterId={id}
                    characterName={character?.name || 'Character'}
                    onUpdate={fetchCharacter}
                  />
                )

              case 'descriptions':
                return (
                  <div className="space-y-8">
                    <PhysicalDescriptionList
                      entityType="character"
                      entityId={id}
                      refreshKey={physicalDescriptionsRefreshKey}
                    />
                    <ClothingRecordList
                      entityId={id}
                    />
                    <WardrobeItemList
                      characterId={id}
                      refreshKey={wardrobeRefreshKey}
                    />
                  </div>
                )

              case 'rename':
                return (
                  <RenameReplaceTab
                    characterId={id}
                    characterName={character?.name || ''}
                    onRenameComplete={() => {
                      fetchCharacter()
                    }}
                  />
                )

              default:
                return null
            }
          }}
        </EntityTabs>

        {/* Form Action Buttons */}
        <div className="flex gap-4 mt-8">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow transition hover:qt-bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Character'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border qt-border-default qt-bg-card px-6 py-3 text-base font-medium qt-text-secondary shadow transition hover:qt-bg-muted"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* LLM Logs Section */}
      <LLMLogsSection characterId={id} />

      {/* Avatar Selector Modal */}
      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => toggleAvatarSelector(false)}
        onSelect={setCharacterAvatar}
        currentImageId={character?.defaultImageId}
        contextType="CHARACTER"
        contextId={id}
      />

      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => toggleUploadDialog(false)}
        contextType="CHARACTER"
        contextId={id}
        onSuccess={() => {
          toggleUploadDialog(false)
          fetchCharacter()
        }}
      />

      {/* AI Wizard Modal */}
      <AIWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        characterId={id}
        characterName={character?.name || ''}
        currentData={{
          title: formData.title,
          identity: formData.identity,
          description: formData.description,
          personality: formData.personality,
          scenarios: formData.scenarios,
          exampleDialogues: formData.exampleDialogues,
          systemPrompt: formData.systemPrompt,
        }}
        onApply={handleWizardApply}
      />
    </div>
  )
}
