'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { showErrorToast } from '@/lib/toast'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import type { TimestampConfig } from '@/lib/schemas/types'
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
import { SearchReplaceModal } from '@/components/tools/search-replace'

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const { style } = useAvatarDisplay()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0

  const [showChatDialog, setShowChatDialog] = useState(false)
  const [showSearchReplaceModal, setShowSearchReplaceModal] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedUserCharacterId, setSelectedUserCharacterId] = useState<string>('')
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<string>('')
  const [timestampConfig, setTimestampConfig] = useState<TimestampConfig | null>(null)
  const [openedFromQuery, setOpenedFromQuery] = useState(false)
  const [defaultImageProfileId, setDefaultImageProfileId] = useState<string>('')
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingUserCharacter, setSavingUserCharacter] = useState(false)
  const [savingPartner, setSavingPartner] = useState(false)

  const {
    loading,
    error,
    character,
    profiles,
    personas,
    defaultPersonaId,
    userControlledCharacters,
    defaultPartnerId,
    defaultPartnerName,
    avatarRefreshKey,
    templateCounts,
    replacingTemplate,
    fetchCharacter,
    fetchProfiles,
    fetchPersonas,
    fetchDefaultPersona,
    fetchUserControlledCharacters,
    fetchDefaultPartner,
    fetchImageProfiles,
    setCharacter,
    setDefaultPersonaId,
    handleTemplateReplace,
    handleSaveConnectionProfile,
    handleSaveDefaultPersona,
    handleSaveDefaultPartner,
    handleToggleNpc,
    handleToggleFavorite,
    handleToggleControlledBy,
    togglingNpc,
    togglingFavorite,
    togglingControlledBy,
  } = useCharacterView(id)

  const { creatingChat, handleCreateChat } = useChatCreation()

  const characterTagIds = character?.tags || []

  // Initialize data on mount
  useEffect(() => {
    fetchCharacter()
    fetchProfiles()
    fetchPersonas()
    fetchDefaultPersona()
    fetchUserControlledCharacters()
    fetchDefaultPartner()
    fetchImageProfiles()
  }, [fetchCharacter, fetchProfiles, fetchPersonas, fetchDefaultPersona, fetchUserControlledCharacters, fetchDefaultPartner, fetchImageProfiles, id])

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

      // Set default user character if available
      if (defaultPersonaId) {
        setSelectedUserCharacterId(defaultPersonaId)
      }
    }
  }, [searchParams, character?.defaultConnectionProfileId, profiles, defaultPersonaId])

  const handleStartChat = () => {
    if (character?.defaultConnectionProfileId) {
      setSelectedProfileId(character.defaultConnectionProfileId)
    } else if (profiles.length === 0) {
      showErrorToast('No connection profiles available. Please set up a profile first.')
      return
    } else {
      setSelectedProfileId(profiles[0].id)
    }

    if (defaultPersonaId) {
      setSelectedUserCharacterId(defaultPersonaId)
    } else {
      setSelectedUserCharacterId('')
    }

    setShowChatDialog(true)
  }

  const handleCreateChatClick = async () => {
    await handleCreateChat({
      characterId: id,
      characterName: character?.name,
      selectedProfileId,
      selectedUserCharacterId,
      selectedImageProfileId,
      scenario,
      timestampConfig,
    })
    setShowChatDialog(false)
  }

  const handleConnectionProfileSave = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      await handleSaveConnectionProfile(profileId)
    } finally {
      setSavingConnectionProfile(false)
    }
  }

  const handleUserCharacterSave = async (userCharacterId: string) => {
    setSavingUserCharacter(true)
    try {
      await handleSaveDefaultPersona(userCharacterId)
    } finally {
      setSavingUserCharacter(false)
    }
  }

  const handlePartnerSave = async (partnerId: string) => {
    setSavingPartner(true)
    try {
      await handleSaveDefaultPartner(partnerId)
    } finally {
      setSavingPartner(false)
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
            defaultPartnerName={defaultPartnerName}
            onTemplateReplace={handleTemplateReplace}
          />
        )

      case 'system-prompts':
        return (
          <SystemPromptsTab
            characterId={id}
            character={character}
            defaultPartnerName={defaultPartnerName}
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
            userControlledCharacters={userControlledCharacters}
            defaultPartnerId={defaultPartnerId}
            defaultImageProfileId={defaultImageProfileId}
            savingConnectionProfile={savingConnectionProfile}
            savingPartner={savingPartner}
            onConnectionProfileChange={handleConnectionProfileSave}
            onPartnerChange={handlePartnerSave}
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
    <div className="character-view qt-page-container min-h-screen text-foreground">
      <div>
        <Link
          href={character?.npc ? '/settings?tab=npcs' : '/characters'}
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          {character?.npc ? '← Back to NPCs' : '← Back to Characters'}
        </Link>

        <CharacterHeader
          character={character}
          style={style}
          avatarRefreshKey={avatarRefreshKey}
          onStartChat={handleStartChat}
          onToggleNpc={handleToggleNpc}
          onToggleFavorite={handleToggleFavorite}
          onToggleControlledBy={handleToggleControlledBy}
          onSearchReplace={() => setShowSearchReplaceModal(true)}
          togglingNpc={togglingNpc}
          togglingFavorite={togglingFavorite}
          togglingControlledBy={togglingControlledBy}
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
          selectedUserCharacterId={selectedUserCharacterId}
          selectedImageProfileId={selectedImageProfileId}
          scenario={scenario}
          timestampConfig={timestampConfig}
          creatingChat={creatingChat}
          openedFromQuery={openedFromQuery}
          onProfileChange={setSelectedProfileId}
          onUserCharacterChange={setSelectedUserCharacterId}
          onImageProfileChange={setSelectedImageProfileId}
          onScenarioChange={setScenario}
          onTimestampConfigChange={setTimestampConfig}
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

      {/* Search & Replace Modal */}
      <SearchReplaceModal
        isOpen={showSearchReplaceModal}
        onClose={() => setShowSearchReplaceModal(false)}
        initialScope={{ type: 'character', characterId: id }}
        characterName={character?.name}
      />
    </div>
  )
}
