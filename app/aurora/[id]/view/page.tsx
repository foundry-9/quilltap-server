'use client'

import { use, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { EntityTabs } from '@/components/tabs'
import { NewChatModal } from '@/components/new-chat'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useCharacterView } from './hooks'
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
  ExternalPromptDialog,
  ExternalPromptResultDialog,
} from './components'
import { CHARACTER_TABS } from './constants'
import { SearchReplaceModal } from '@/components/tools/search-replace'
import type { SearchReplaceResult } from '@/components/tools/search-replace/types'
import { CharacterOptimizerModal } from '@/components/characters/optimizer'

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const { style } = useAvatarDisplay()
  const wardrobeDialog = useWardrobeDialogOptional()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0

  const [showChatDialog, setShowChatDialog] = useState(false)
  const [showSearchReplaceModal, setShowSearchReplaceModal] = useState(false)
  const [showOptimizerModal, setShowOptimizerModal] = useState(false)
  const [showExternalPromptDialog, setShowExternalPromptDialog] = useState(false)
  const [externalPromptResult, setExternalPromptResult] = useState<string | null>(null)
  const [dataRefreshKey, setDataRefreshKey] = useState(0)
  const [openedFromQuery, setOpenedFromQuery] = useState(false)
  const chatDialogInitializedRef = useRef(false)
  const [savingConnectionProfile, setSavingConnectionProfile] = useState(false)
  const [savingPartner, setSavingPartner] = useState(false)
  const [savingImageProfile, setSavingImageProfile] = useState(false)

  const {
    loading,
    error,
    character,
    profiles,
    userControlledCharacters,
    defaultPartnerId,
    defaultPartnerName,
    defaultImageProfileId,
    avatarRefreshKey,
    templateCounts,
    replacingTemplate,
    fetchCharacter,
    fetchProfiles,
    fetchUserControlledCharacters,
    fetchDefaultPartner,
    fetchImageProfiles,
    setCharacter,
    handleTemplateReplace,
    handleSaveConnectionProfile,
    handleSaveDefaultPartner,
    handleSaveImageProfile,
    handleSaveAgentMode,
    handleSaveHelpTools,
    handleSaveCanDressThemselves,
    handleSaveCanCreateOutfits,
    handleSaveTimestampConfig,
    handleSaveDefaultScenario,
    handleSaveDefaultSystemPrompt,
    handleToggleNpc,
    handleToggleFavorite,
    handleToggleControlledBy,
    togglingNpc,
    togglingFavorite,
    togglingControlledBy,
    savingAgentMode,
    savingHelpTools,
    savingCanDressThemselves,
    savingCanCreateOutfits,
    savingTimestampConfig,
    savingDefaultScenario,
    savingDefaultSystemPrompt,
  } = useCharacterView(id)

  const characterTagIds = character?.tags || []

  // Initialize data on mount
  useEffect(() => {
    fetchCharacter()
    fetchProfiles()
    fetchUserControlledCharacters()
    fetchDefaultPartner()
    fetchImageProfiles()
  }, [fetchCharacter, fetchProfiles, fetchUserControlledCharacters, fetchDefaultPartner, fetchImageProfiles, id])

  // Open the chat modal when arriving via ?action=chat (initialize once)
  useEffect(() => {
    if (searchParams.get('action') === 'chat' && !chatDialogInitializedRef.current && character) {
      chatDialogInitializedRef.current = true
      setShowChatDialog(true)
      setOpenedFromQuery(true)
    }
  }, [searchParams, character])

  const handleStartChat = () => {
    setOpenedFromQuery(false)
    setShowChatDialog(true)
  }

  const handleConnectionProfileSave = async (profileId: string) => {
    setSavingConnectionProfile(true)
    try {
      await handleSaveConnectionProfile(profileId)
    } finally {
      setSavingConnectionProfile(false)
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

  const handleImageProfileSave = async (profileId: string | null) => {
    setSavingImageProfile(true)
    try {
      await handleSaveImageProfile(profileId)
    } finally {
      setSavingImageProfile(false)
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
            refreshKey={dataRefreshKey}
          />
        )

      case 'memories':
        return <MemoriesTab characterId={id} refreshKey={dataRefreshKey} />

      case 'tags':
        return <TagsTab characterId={id} />

      case 'wardrobe':
        return (
          <div className="space-y-2">
            <p className="qt-text-small qt-text-secondary">
              The wardrobe lives in a global dialog so it travels with you —
              edit, layer, and save outfits from anywhere, including from
              inside a chat.
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

      case 'defaults':
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
            savingImageProfile={savingImageProfile}
            savingAgentMode={savingAgentMode}
            savingTimestampConfig={savingTimestampConfig}
            savingDefaultScenario={savingDefaultScenario}
            savingDefaultSystemPrompt={savingDefaultSystemPrompt}
            onConnectionProfileChange={handleConnectionProfileSave}
            onPartnerChange={handlePartnerSave}
            onImageProfileChange={handleImageProfileSave}
            onAgentModeChange={handleSaveAgentMode}
            savingHelpTools={savingHelpTools}
            onHelpToolsChange={handleSaveHelpTools}
            savingCanDressThemselves={savingCanDressThemselves}
            onCanDressThemselvesChange={handleSaveCanDressThemselves}
            savingCanCreateOutfits={savingCanCreateOutfits}
            onCanCreateOutfitsChange={handleSaveCanCreateOutfits}
            onTimestampConfigChange={handleSaveTimestampConfig}
            onDefaultScenarioChange={handleSaveDefaultScenario}
            onDefaultSystemPromptChange={handleSaveDefaultSystemPrompt}
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
        return (
          <DescriptionsTab
            characterId={id}
            overlayActive={character?.readPropertiesFromDocumentStore === true}
          />
        )

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
          <p className="mb-4 text-lg qt-text-destructive">Error: {error}</p>
          <Link
            href="/aurora"
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
      <div className="flex min-h-screen items-center justify-center qt-bg-muted">
        <HiddenPlaceholder />
      </div>
    )
  }

  return (
    <div className="character-view qt-page-container min-h-screen text-foreground">
      <div>
        <Link
          href="/aurora"
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          ← Back to Characters
        </Link>

        <CharacterHeader
          character={character}
          style={style}
          avatarRefreshKey={avatarRefreshKey}
          onStartChat={handleStartChat}
          onToggleNpc={handleToggleNpc}
          onToggleFavorite={handleToggleFavorite}
          onToggleControlledBy={handleToggleControlledBy}
          onOptimize={() => setShowOptimizerModal(true)}
          onSearchReplace={() => setShowSearchReplaceModal(true)}
          onGenerateExternalPrompt={() => setShowExternalPromptDialog(true)}
          togglingNpc={togglingNpc}
          togglingFavorite={togglingFavorite}
          togglingControlledBy={togglingControlledBy}
        />

        {/* Tabbed Content */}
        <EntityTabs tabs={CHARACTER_TABS} defaultTab="details">
          {renderTabContent}
        </EntityTabs>
      </div>

      {/* Chat Creation Modal */}
      {showChatDialog && character && (
        <NewChatModal
          isOpen={true}
          onClose={() => setShowChatDialog(false)}
          characterId={id}
          characterName={character.name}
          openedFromQuery={openedFromQuery}
        />
      )}

      {/* Character Optimizer Modal */}
      {showOptimizerModal && (
        <CharacterOptimizerModal
          characterId={id}
          characterName={character?.name || 'Character'}
          profiles={profiles}
          defaultConnectionProfileId={character?.defaultConnectionProfileId}
          vaultAvailable={
            !!character?.readPropertiesFromDocumentStore &&
            !!character?.characterDocumentMountPointId
          }
          onClose={() => setShowOptimizerModal(false)}
          onApplied={() => {
            fetchCharacter()
            setShowOptimizerModal(false)
          }}
        />
      )}

      {/* Search & Replace Modal */}
      <SearchReplaceModal
        isOpen={showSearchReplaceModal}
        onClose={() => setShowSearchReplaceModal(false)}
        initialScope={{ type: 'character', characterId: id }}
        characterName={character?.name}
        onComplete={(result: SearchReplaceResult) => {
          // Refresh data if any changes were made
          if (result.messagesUpdated > 0 || result.memoriesUpdated > 0) {
            setDataRefreshKey(prev => prev + 1)
          }
        }}
      />

      {/* External Prompt Generator */}
      {showExternalPromptDialog && (
        <ExternalPromptDialog
          characterId={id}
          characterName={character?.name}
          systemPrompts={character?.systemPrompts}
          scenarios={character?.scenarios}
          onCancel={() => setShowExternalPromptDialog(false)}
          onGenerated={(prompt) => {
            setShowExternalPromptDialog(false)
            setExternalPromptResult(prompt)
          }}
        />
      )}

      {externalPromptResult && (
        <ExternalPromptResultDialog
          characterName={character?.name}
          prompt={externalPromptResult}
          onClose={() => setExternalPromptResult(null)}
        />
      )}
    </div>
  )
}
