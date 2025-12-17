'use client'

import { use } from 'react'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { EntityTabs, Tab } from '@/components/tabs'
import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { RenameReplaceTab } from '@/components/characters/RenameReplaceTab'
import { SystemPromptsEditor } from '@/components/characters/SystemPromptsEditor'
import { useCharacterEdit } from './hooks'
import { CharacterBasicInfo, CharacterSettings } from './components'
import { clientLogger } from '@/lib/client-logger'

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
    id: 'profiles',
    label: 'Associated Profiles',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'gallery',
    label: 'Photo Gallery',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'descriptions',
    label: 'Physical Descriptions',
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
    personas,
    profiles,
    defaultPersonaId,
    loadingPersonas,
    showAvatarSelector,
    showUploadDialog,
    avatarRefreshKey,
    handleChange,
    handleDefaultPersonaChange,
    handleSubmit,
    handleCancel,
    setCharacterAvatar,
    getAvatarSrc,
    toggleAvatarSelector,
    toggleUploadDialog,
    clearAvatar,
    fetchCharacter,
    hasChanges,
  } = useCharacterEdit(id)

  clientLogger.debug('Rendering EditCharacterPage', { characterId: id, loading })

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character...</p>
      </div>
    )
  }

  const avatarSrc = getAvatarSrc()

  return (
    <div className="character-edit container mx-auto max-w-5xl px-4 py-8 text-foreground">
      {/* Header Section */}
      <div className="mb-8">
        <button
          onClick={handleCancel}
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          ← Back
        </button>
        <div className="flex items-center gap-4">
          {/* Avatar Display */}
          <div className="relative">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                src={avatarSrc}
                alt={character?.name || ''}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <span className="text-3xl font-bold text-muted-foreground">
                  {character?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <button
              onClick={() => toggleAvatarSelector(true)}
              className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground shadow-lg transition hover:bg-primary/90"
              title="Change avatar"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>

          {/* Title */}
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Edit: {character?.name || 'Loading...'}
            </h1>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
          {error}
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit}>
        <EntityTabs tabs={EDIT_CHARACTER_TABS} defaultTab="details">
          {(activeTab: string) => {
            switch (activeTab) {
              case 'details':
                return <CharacterBasicInfo characterId={id} formData={formData} onChange={handleChange} />

              case 'system-prompts':
                return (
                  <SystemPromptsEditor
                    characterId={id}
                    characterName={character?.name || 'Character'}
                    onUpdate={fetchCharacter}
                  />
                )

              case 'profiles':
                return (
                  <CharacterSettings
                    formData={formData}
                    onChange={(e) => handleChange(e as React.ChangeEvent<HTMLSelectElement>)}
                    profiles={profiles}
                    personas={personas}
                    defaultPersonaId={defaultPersonaId}
                    onDefaultPersonaChange={handleDefaultPersonaChange}
                    loadingPersonas={loadingPersonas}
                  />
                )

              case 'gallery':
                return (
                  <EmbeddedPhotoGallery
                    entityType="character"
                    entityId={id}
                    entityName={character?.name || 'Character'}
                    currentAvatarId={character?.defaultImageId}
                    onAvatarChange={(imageId) => {
                      if (imageId) {
                        setCharacterAvatar(imageId)
                      } else {
                        clearAvatar()
                      }
                    }}
                    onRefresh={fetchCharacter}
                  />
                )

              case 'descriptions':
                return (
                  <PhysicalDescriptionList
                    entityType="character"
                    entityId={id}
                  />
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
            className="flex-1 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Character'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-border bg-card px-6 py-3 text-base font-medium text-muted-foreground shadow transition hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </form>

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
    </div>
  )
}
