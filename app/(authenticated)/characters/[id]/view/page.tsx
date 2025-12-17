'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { showErrorToast } from '@/lib/toast'
import { clientLogger } from '@/lib/client-logger'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { EntityTabs } from '@/components/tabs'
import { useCharacterView, useChatCreation } from './hooks'
import {
  CharacterHeader,
  CharacterDetails,
  CharacterGallery,
  SystemPromptsTab,
  TagsTab,
  ProfilesTab,
  ConversationsTab,
  MemoriesTab,
  DescriptionsTab,
  ChatCreationDialog,
} from './components'
import { CHARACTER_TABS } from './constants'

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const { style } = useAvatarDisplay()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0

  const [showChatDialog, setShowChatDialog] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('')
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [openedFromQuery, setOpenedFromQuery] = useState(false)
  const [defaultImageProfileId, setDefaultImageProfileId] = useState<string>('')
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPersona, setSavingPersona] = useState(false)

  const {
    loading,
    error,
    character,
    profiles,
    personas,
    defaultPersonaId,
    avatarRefreshKey,
    templateCounts,
    replacingTemplate,
    fetchCharacter,
    fetchProfiles,
    fetchPersonas,
    fetchDefaultPersona,
    fetchImageProfiles,
    setCharacter,
    setDefaultPersonaId,
    handleTemplateReplace,
    handleSaveConnectionProfile,
    handleSaveDefaultPersona,
  } = useCharacterView(id)

  const { creatingChat, handleCreateChat } = useChatCreation()

  const characterTagIds = character?.tags || []
  const defaultPersona = personas.find(p => p.id === defaultPersonaId)
  const defaultPersonaName = defaultPersona?.name || null

  // Initialize data on mount
  useEffect(() => {
    fetchCharacter()
    fetchProfiles()
    fetchPersonas()
    fetchDefaultPersona()
    fetchImageProfiles()
    clientLogger.debug('Character view page initialized', { characterId: id })
  }, [fetchCharacter, fetchProfiles, fetchPersonas, fetchDefaultPersona, fetchImageProfiles, id])

  // Handle chat dialog opening from query params
  useEffect(() => {
    if (searchParams.get('action') === 'chat') {
      setShowChatDialog(true)
      setOpenedFromQuery(true)

      // Set default profile when opening from query
      if (character?.defaultConnectionProfileId) {
        setSelectedProfileId(character.defaultConnectionProfileId)
      } else if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id)
      }

      // Set default persona if available
      if (defaultPersonaId) {
        setSelectedPersonaId(defaultPersonaId)
      }
    }
  }, [searchParams, character?.defaultConnectionProfileId, profiles, defaultPersonaId])

  const handleStartChat = () => {
    if (character?.defaultConnectionProfileId) {
      setSelectedProfileId(character.defaultConnectionProfileId)
    } else if (profiles.length === 0) {
      showErrorToast('No connection profiles available. Please set up a profile first.')
      clientLogger.warn('Chat start attempted without available profiles', { characterId: id })
      return
    } else {
      setSelectedProfileId(profiles[0].id)
    }

    if (defaultPersonaId) {
      setSelectedPersonaId(defaultPersonaId)
    } else {
      setSelectedPersonaId('')
    }

    setShowChatDialog(true)
    clientLogger.debug('Chat dialog opened', { characterId: id })
  }

  const handleCreateChatClick = async () => {
    await handleCreateChat({
      characterId: id,
      characterName: character?.name,
      selectedProfileId,
      selectedPersonaId,
      selectedImageProfileId,
    })
    setShowChatDialog(false)
  }

  const handleConnectionProfileSave = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      await handleSaveConnectionProfile(profileId)
      clientLogger.info('Connection profile saved', { profileId })
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handlePersonaSave = async (personaId: string) => {
    setSavingPersona(true)
    try {
      await handleSaveDefaultPersona(personaId)
      clientLogger.info('Default persona saved', { personaId })
    } finally {
      setSavingPersona(false)
    }
  }

  const renderTabContent = (activeTab: string) => {
    switch (activeTab) {
      case 'details':
        return (
          <CharacterDetails
            characterId={id}
            character={character}
            templateCounts={templateCounts}
            replacingTemplate={replacingTemplate}
            defaultPersonaName={defaultPersonaName}
            onTemplateReplace={handleTemplateReplace}
          />
        )

      case 'system-prompts':
        return (
          <SystemPromptsTab
            characterId={id}
            character={character}
            defaultPersonaName={defaultPersonaName}
          />
        )

      case 'conversations':
        return (
          <ConversationsTab
            characterId={id}
            characterName={character?.name || 'Character'}
          />
        )

      case 'memories':
        return <MemoriesTab characterId={id} />

      case 'tags':
        return <TagsTab characterId={id} />

      case 'profiles':
        return (
          <ProfilesTab
            characterId={id}
            character={character}
            profiles={profiles}
            personas={personas}
            defaultPersonaId={defaultPersonaId}
            defaultImageProfileId={defaultImageProfileId}
            savingConnectionProfile={savingConnectionProfile}
            savingPersona={savingPersona}
            onConnectionProfileChange={handleConnectionProfileSave}
            onPersonaChange={handlePersonaSave}
            onImageProfileChange={(profileId) => setDefaultImageProfileId(profileId || '')}
          />
        )

      case 'gallery':
        return (
          <CharacterGallery
            characterId={id}
            character={character}
            onAvatarChange={(imageId) => {
              if (character) {
                setCharacter({ ...character, defaultImageId: imageId ?? undefined })
              }
            }}
            onRefresh={fetchCharacter}
          />
        )

      case 'descriptions':
        return <DescriptionsTab characterId={id} />

      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-lg text-destructive">Error: {error}</p>
          <Link
            href="/characters"
            className="font-medium text-primary hover:text-primary/80"
          >
            ← Back to Characters
          </Link>
        </div>
      </div>
    )
  }

  if (quickHideActive && character && shouldHideByIds(characterTagIds)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <HiddenPlaceholder />
      </div>
    )
  }

  return (
    <div className="character-view min-h-screen px-4 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/characters"
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          ← Back to Characters
        </Link>

        <CharacterHeader
          character={character}
          style={style}
          avatarRefreshKey={avatarRefreshKey}
          onStartChat={handleStartChat}
        />

        {/* Tabbed Content */}
        <EntityTabs tabs={CHARACTER_TABS} defaultTab="details">
          {renderTabContent}
        </EntityTabs>
      </div>

      {/* Chat Creation Dialog */}
      {showChatDialog && (
        <ChatCreationDialog
          characterId={id}
          characterName={character?.name}
          profiles={profiles}
          personas={personas}
          selectedProfileId={selectedProfileId}
          selectedPersonaId={selectedPersonaId}
          selectedImageProfileId={selectedImageProfileId}
          creatingChat={creatingChat}
          openedFromQuery={openedFromQuery}
          onProfileChange={setSelectedProfileId}
          onPersonaChange={setSelectedPersonaId}
          onImageProfileChange={setSelectedImageProfileId}
          onCancel={() => {
            if (openedFromQuery) {
              window.location.href = '/characters'
            } else {
              setShowChatDialog(false)
            }
          }}
          onCreateChat={handleCreateChatClick}
        />
      )}
    </div>
  )
}
