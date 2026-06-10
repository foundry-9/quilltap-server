'use client'

import { use, useEffect, useState } from 'react'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { EntityTabs, Tab } from '@/components/tabs'
import { Icon } from '@/components/ui/icon'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { RenameReplaceTab } from '@/components/characters/RenameReplaceTab'
import { SystemPromptsEditor } from '@/components/characters/SystemPromptsEditor'
import { AIWizardModal, type GeneratedCharacterData, normalizeGeneratedScenarios } from '@/components/characters/ai-wizard'
import LLMLogsSection from '@/components/characters/LLMLogsSection'
import { DescriptionsTab } from '../view/components/DescriptionsTab'
import { useCharacterEdit } from './hooks'
import { CharacterBasicInfo } from './components'
import { AestheticEditorField } from '@/components/settings/AestheticEditorField'
import type { CharacterScenario } from './types'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { buildWizardCurrentData, getGeneratedCharacterTextEntries } from '../../shared/wizard-text-fields'

/**
 * Tab configuration for character edit page
 */
const EDIT_CHARACTER_TABS: Tab[] = [
  {
    id: 'details',
    label: 'Details',
    icon: <Icon name="user" className="w-4 h-4" />,
  },
  {
    id: 'system-prompts',
    label: 'System Prompts',
    icon: <Icon name="code" className="w-4 h-4" />,
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    icon: <Icon name="wardrobe" className="w-4 h-4" />,
  },
  {
    id: 'descriptions',
    label: 'Appearance',
    icon: <Icon name="file" className="w-4 h-4" />,
  },
  {
    id: 'rename',
    label: 'Rename/Replace',
    icon: <Icon name="pencil" className="w-4 h-4" />,
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
    externalUpdateCount,
    handleChange,
    handleAliasesChange,
    handlePronounsChange,
    handleScenariosChange,
    handleSystemTransparencyChange,
    handleCanBeCarinaChange,
    handleCoreWhisperEnabledChange,
    handleSubmit,
    handleCancel,
    setCharacterAvatar,
    getAvatarSrc,
    toggleAvatarSelector,
    toggleUploadDialog,
    fetchCharacter,
    bumpExternalUpdateCount,
    isNpc,
  } = useCharacterEdit(id)

  const [showWizard, setShowWizard] = useState(false)
  const wardrobeDialog = useWardrobeDialogOptional()

  // Handle applying wizard-generated data
  const handleWizardApply = async (data: GeneratedCharacterData) => {
    // Apply text fields by creating synthetic events
    const textEntries = getGeneratedCharacterTextEntries(data)
    for (const field of textEntries) {
      const syntheticEvent = {
        target: { name: field.field, value: field.value },
      } as React.ChangeEvent<HTMLInputElement>
      handleChange(syntheticEvent)
    }
    // Remount markdown editors so they pick up the wizard-written values
    // instead of staying on whatever was on screen before.
    if (textEntries.length > 0) {
      bumpExternalUpdateCount()
    }

    // Handle physical description if generated. The cutover collapsed the
    // multi-record array to a single record; PATCH the character row directly
    // and the repository's write overlay routes it into the vault.
    if (data.physicalDescription) {
      try {
        const response = await fetch(`/api/v1/characters/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            physicalDescription: {
              name: data.physicalDescription.name,
              shortPrompt: data.physicalDescription.shortPrompt,
              mediumPrompt: data.physicalDescription.mediumPrompt,
              longPrompt: data.physicalDescription.longPrompt,
              completePrompt: data.physicalDescription.completePrompt,
              fullDescription: data.physicalDescription.fullDescription,
            },
          }),
        })

        if (response.ok) {
          showSuccessToast('Physical description saved')
        } else {
          const errorData = await response.json().catch(() => ({}))
          showErrorToast(errorData.error || 'Failed to save physical description')
        }
      } catch (err) {
        console.error('Failed to save physical description', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast('Failed to save physical description')
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
                    externalUpdateCount={externalUpdateCount}
                    onChange={handleChange}
                    onAliasesChange={handleAliasesChange}
                    onPronounsChange={handlePronounsChange}
                    onScenariosChange={handleScenariosChange}
                    onSystemTransparencyChange={handleSystemTransparencyChange}
                    onCanBeCarinaChange={handleCanBeCarinaChange}
                    onCoreWhisperEnabledChange={handleCoreWhisperEnabledChange}
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

              case 'wardrobe':
                return (
                  <div className="space-y-2">
                    <p className="qt-text-small qt-text-secondary">
                      The wardrobe is managed in the global Wardrobe dialog so
                      you can drop in from anywhere — including from inside a
                      chat — and edit, layer, or save outfits without leaving
                      the page you&apos;re on.
                    </p>
                    <button
                      type="button"
                      onClick={() => wardrobeDialog?.open({ characterId: id })}
                      disabled={!wardrobeDialog}
                      className="qt-button-primary"
                    >
                      Open wardrobe for {character?.name || 'this character'}
                    </button>
                  </div>
                )

              case 'descriptions':
                return (
                  <div className="space-y-6">
                    <DescriptionsTab characterId={id} />
                    <div className="qt-card qt-bg-card qt-border rounded-lg p-4">
                      <AestheticEditorField
                        label="Depiction Guidelines (the Ariel Clause)"
                        description="This character's own rules about how they may or may not be depicted in story backgrounds and ad-hoc images. These are mandatory constraints, passed to the image-prompt generator whenever this character appears — they are never applied to plain avatars."
                        loadUrl={`/api/v1/characters/${id}?action=depiction-guidelines`}
                        namespace={`DepictionGuidelines-${id}`}
                        disabledHint={
                          character?.characterDocumentMountPointId
                            ? undefined
                            : 'This character has no document vault yet, so depiction guidelines cannot be stored. Save the character once to provision its vault, then return here.'
                        }
                      />
                    </div>
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
            className="qt-button qt-button-primary qt-button-lg flex-1"
          >
            {saving ? 'Saving...' : 'Save Character'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="qt-button qt-button-secondary qt-button-lg"
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
          ...buildWizardCurrentData(formData),
          scenarios: formData.scenarios,
        }}
        onApply={handleWizardApply}
      />
    </div>
  )
}
