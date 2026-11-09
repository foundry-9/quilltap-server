'use client'

/**
 * The one character page (`/aurora/[id]`, workspace tab kind `character`).
 *
 * A character has one page, and what it shows is the thing itself, editable
 * where it sits: six sections that answer the questions a user asks — Details
 * (who are they?), Prompts (what are they told?), Appearance (what do they
 * look like?), Abilities (what may they do?), Chat Defaults (how does a chat
 * begin?), History (what has happened?) — under a sticky header with the one
 * save status. Every control saves itself (`useCharacterAutosave`); a modal is
 * the only place a Save button appears.
 *
 * Design of record:
 * `docs/developer/features/complete/aurora-character-page-unification.md`.
 *
 * @module app/aurora/[id]/CharacterPage
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { EntityTabs, type Tab } from '@/components/tabs'
import { Icon } from '@/components/ui/icon'
import { useNewChatModalOptional } from '@/components/providers/new-chat-provider'
import { useRouter } from 'next/navigation'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { AIWizardModal, type GeneratedCharacterData, normalizeGeneratedScenarios } from '@/components/characters/ai-wizard'
import { CharacterOptimizerModal } from '@/components/characters/optimizer'
import { applyCharacterFieldUpdates } from '@/components/characters/apply-character-field-updates'
import { CharacterDeleteDialog } from '@/components/character-delete-dialog'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useInventoryDialogOptional } from '@/components/providers/inventory-dialog-provider'
import { revealAnchor } from '@/hooks/useAnchorReveal'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { triggerUrlDownload } from '@/lib/download-utils'
import {
  DEFAULT_CHARACTER_PAGE_SECTION,
  isCharacterPageSection,
  type CharacterPageSection,
} from '@/lib/characters/page-sections'
import { FIRST_SYSTEM_PROMPT_NAME, buildWizardCurrentData, generatedSystemPrompt, getGeneratedCharacterTextEntries } from '../shared/wizard-text-fields'
import { saveGeneratedWardrobeItems } from '../shared/save-generated-wardrobe'
import { saveGeneratedPhysicalDescription } from '../shared/save-generated-physical-description'
import { saveGeneratedScenarios } from '../shared/save-generated-scenarios'
import { CharacterPageContext, type CharacterPageContextValue } from './CharacterPageContext'
import { CharacterHeader } from './CharacterHeader'
import { useCharacter, useCharacterPageSupport, useCharacterStats } from './hooks/useCharacter'
import { useCharacterAutosave } from './hooks/useCharacterAutosave'
import { ArchiveCharacterDialog } from './components/ArchiveCharacterDialog'
import { VaultRepairCard } from './components/VaultRepairCard'
import { ApiFetchError } from '@/lib/query/fetcher'
import { RehydrateBundleDialog } from './components/RehydrateBundleDialog'
import { ExternalPromptDialog } from './components/ExternalPromptDialog'
import { ExternalPromptResultDialog } from './components/ExternalPromptResultDialog'
import { DetailsSection } from './sections/DetailsSection'
import { PromptsSection } from './sections/PromptsSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { AbilitiesSection } from './sections/AbilitiesSection'
import { ChatDefaultsSection } from './sections/ChatDefaultsSection'
import { HistorySection } from './sections/HistorySection'
import type { Character } from './types'

export const CHARACTER_PAGE_TABS: Tab[] = [
  { id: 'details', label: 'Details', icon: <Icon name="user" className="w-4 h-4" /> },
  { id: 'prompts', label: 'Prompts', icon: <Icon name="code" className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Icon name="photos" className="w-4 h-4" /> },
  { id: 'abilities', label: 'Abilities', icon: <Icon name="wand" className="w-4 h-4" /> },
  { id: 'chat-defaults', label: 'Chat Defaults', icon: <Icon name="settings" className="w-4 h-4" /> },
  { id: 'history', label: 'History', icon: <Icon name="book" className="w-4 h-4" /> },
]

export interface CharacterPageProps {
  characterId: string
  onBack: () => void
  /** Section to open on (a `?section=` deep link, already resolved). */
  initialSection?: CharacterPageSection
  /** Called when the user switches section (the route keeps `?section=` in step). */
  onSectionChange?: (section: CharacterPageSection) => void
  /** Open the New Chat modal once the character loads (`?action=chat`). */
  openChatOnMount?: boolean
}

async function postAction(characterId: string, action: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/v1/characters/${characterId}?action=${action}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error((data.error as string | undefined) || `The ${action} request failed.`)
  return data
}

function LoadedCharacterPage({
  character,
  characterId,
  onBack,
  initialSection,
  onSectionChange,
  openChatOnMount,
}: CharacterPageProps & { character: Character }) {
  const queryClient = useQueryClient()
  const { style: avatarStyle } = useAvatarDisplay()
  const wardrobeDialog = useWardrobeDialogOptional()
  const inventoryDialog = useInventoryDialogOptional()
  const autosave = useCharacterAutosave(characterId)
  const { stats, groups, vault, refetch: refetchStats } = useCharacterStats(characterId)
  const { profiles, userControlledCharacters } = useCharacterPageSupport()

  const [section, setSection] = useState<CharacterPageSection>(initialSection ?? DEFAULT_CHARACTER_PAGE_SECTION)
  const [externalToken, setExternalToken] = useState(0)
  const pendingAnchor = useRef<string | null>(null)

  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [showOptimizer, setShowOptimizer] = useState(false)
  const [showExternalPrompt, setShowExternalPrompt] = useState(false)
  const [externalPromptResult, setExternalPromptResult] = useState<string | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [rehydrating, setRehydrating] = useState(false)
  const [leftoverBundleFileId, setLeftoverBundleFileId] = useState<string | null>(null)

  const readOnly = Boolean(character.archivedAt)
  const defaultPartnerId = character.defaultPartnerId ?? null
  const defaultPartnerName = userControlledCharacters.find((c) => c.id === defaultPartnerId)?.name ?? null

  // A deep link that arrives while the page is already open (a workspace tab
  // re-targeted from a link) moves to its section — adjusted during render,
  // React's pattern for state that follows a prop.
  const [seenInitialSection, setSeenInitialSection] = useState(initialSection)
  if (initialSection !== seenInitialSection) {
    setSeenInitialSection(initialSection)
    if (initialSection) setSection(initialSection)
  }

  // The New Chat dialog is the workspace's one mount; outside the workspace,
  // the /salon/new page stands in for it. Closing it leaves the operator here.
  const newChat = useNewChatModalOptional()
  const router = useRouter()
  const startChat = useCallback(() => {
    if (newChat) {
      newChat.open({ characterId, characterName: character.name })
    } else {
      router.push(`/salon/new?characterId=${encodeURIComponent(characterId)}`)
    }
  }, [newChat, router, characterId, character.name])

  const chatOpened = useRef(false)
  useEffect(() => {
    if (openChatOnMount && !chatOpened.current) {
      chatOpened.current = true
      startChat()
    }
  }, [openChatOnMount, startChat])

  const reload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) }),
      refetchStats(),
    ])
    setExternalToken((n) => n + 1)
  }, [queryClient, characterId, refetchStats])

  // Coming back to the tab re-reads (TabView also invalidates the row's keys);
  // fields with a focus or an unsent draft keep what is on screen.
  useOnTabActivated(() => {
    void refetchStats()
  })

  const changeSection = useCallback(
    (next: CharacterPageSection) => {
      setSection(next)
      onSectionChange?.(next)
    },
    [onSectionChange],
  )

  // Bumped on every stat-link navigation, so a link to a card in the section
  // already showing still scrolls (and reveals) it.
  const [anchorRequest, setAnchorRequest] = useState(0)
  const goToSection = useCallback(
    (next: CharacterPageSection, anchor?: string) => {
      pendingAnchor.current = anchor ?? null
      changeSection(next)
      if (anchor) setAnchorRequest((n) => n + 1)
    },
    [changeSection],
  )

  useEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor) return
    pendingAnchor.current = null
    requestAnimationFrame(() => {
      // A collapsed card opens itself before it is scrolled to.
      revealAnchor(anchor)
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }, [section, anchorRequest])

  const context: CharacterPageContextValue = useMemo(
    () => ({
      characterId,
      character,
      autosave,
      readOnly,
      externalToken,
      reload,
      stats,
      groups,
      vault,
      profiles,
      userControlledCharacters,
      defaultPartnerId,
      defaultPartnerName,
      goToSection,
    }),
    [
      characterId,
      character,
      autosave,
      readOnly,
      externalToken,
      reload,
      stats,
      groups,
      vault,
      profiles,
      userControlledCharacters,
      defaultPartnerId,
      defaultPartnerName,
      goToSection,
    ],
  )

  // ---------------------------------------------------------------- actions

  const invalidateLists = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.characters.all, predicate: (q) => q.queryKey[1] === 'list' })

  const setAvatar = async (imageId: string | null) => {
    const ok = await autosave.run(() => postAction(characterId, 'avatar', { imageId }), 'The avatar could not be set.')
    if (ok) {
      setShowAvatarSelector(false)
      await reload()
      void invalidateLists()
    }
  }

  const toggleFavorite = async () => {
    const data = await autosave.run(() => postAction(characterId, 'favorite'), 'The favourite could not be saved.')
    const isFavorite = (data?.character as { isFavorite?: boolean } | undefined)?.isFavorite
    if (isFavorite !== undefined) autosave.patchCache({ isFavorite })
  }

  const archive = async () => {
    const data = await autosave.run(() => postAction(characterId, 'archive'), 'The character could not be archived.')
    if (!data) return
    setShowArchive(false)
    await reload()
    void invalidateLists()
    showSuccessToast(
      data.pruneComplete === false
        ? `${character.name} is archived, but some effects resisted packing — archive them again to finish the sweep.`
        : `${character.name} rests in the archive, bundle sealed and shelved.`,
    )
  }

  const rehydrate = async () => {
    setRehydrating(true)
    try {
      const data = await autosave.run(() => postAction(characterId, 'rehydrate'), 'The character could not be rehydrated.')
      if (!data) return
      await reload()
      void invalidateLists()
      const restored = data.restored as { memories: number; documents: number; blobs: number } | undefined
      showSuccessToast(
        restored
          ? `${character.name} is awake again — ${restored.memories} memories, ${restored.documents} papers and ${restored.blobs} photographs unpacked.`
          : `${character.name} is awake again.`,
      )
      if (typeof data.archiveBundleFileId === 'string' && data.archiveBundleFileId) {
        setLeftoverBundleFileId(data.archiveBundleFileId)
      }
    } finally {
      setRehydrating(false)
    }
  }

  const deleteCharacter = async (options: { cascadeChats: boolean; cascadeImages: boolean }) => {
    await autosave.flush()
    const params = new URLSearchParams()
    if (options.cascadeChats) params.set('cascadeChats', 'true')
    if (options.cascadeImages) params.set('cascadeImages', 'true')
    const qs = params.toString()
    const result = await autosave.run(async () => {
      const res = await fetch(`/api/v1/characters/${characterId}${qs ? `?${qs}` : ''}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('The character could not be deleted.')
      return (await res.json().catch(() => ({}))) as Record<string, number>
    }, 'The character could not be deleted.')
    if (!result) return
    setShowDelete(false)
    const parts = [`${character.name} deleted`]
    if (result.deletedChats > 0) parts.push(`${result.deletedChats} chat${result.deletedChats === 1 ? '' : 's'} deleted`)
    if (result.deletedImages > 0) parts.push(`${result.deletedImages} image${result.deletedImages === 1 ? '' : 's'} deleted`)
    if (result.deletedMemories > 0)
      parts.push(`${result.deletedMemories} memor${result.deletedMemories === 1 ? 'y' : 'ies'} deleted`)
    showSuccessToast(parts.join('. '))
    void invalidateLists()
    queryClient.removeQueries({ queryKey: queryKeys.characters.detail(characterId) })
    onBack()
  }

  /**
   * AI Wizard apply: every generated piece is written straight through the
   * API — text fields and properties in one character PUT, a generated system
   * prompt as a new *named* prompt (#146), then the physical description,
   * wardrobe and scenarios through their own helpers — and the page reloads.
   */
  const applyWizard = async (data: GeneratedCharacterData) => {
    await autosave.flush()
    const mainUpdates: Record<string, unknown> = {}
    for (const entry of getGeneratedCharacterTextEntries(data)) mainUpdates[entry.field] = entry.value
    if (data.properties?.pronouns && !character.pronouns) mainUpdates.pronouns = data.properties.pronouns
    // The generated aliases join the existing ones; the server drops duplicates.
    if (data.properties && data.properties.aliases.length > 0) {
      mainUpdates.aliases = [...(character.aliases ?? []), ...data.properties.aliases]
    }
    const errors: string[] = []
    if (Object.keys(mainUpdates).length > 0) {
      const result = await autosave.run(
        () => applyCharacterFieldUpdates(characterId, { mainUpdates }),
        'The generated fields could not be saved.',
      )
      if (result) errors.push(...result.errors)
    }

    const systemPrompt = generatedSystemPrompt(data)
    if (systemPrompt) {
      // The server makes a character's first prompt the default; the name is
      // the only thing the page chooses.
      const isFirst = (character.systemPrompts?.length ?? 0) === 0
      const created = await autosave.run(async () => {
        const res = await fetch(`/api/v1/characters/${characterId}/prompts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: isFirst ? FIRST_SYSTEM_PROMPT_NAME : 'AI Wizard', content: systemPrompt }),
        })
        if (!res.ok) throw new Error('The generated system prompt could not be saved.')
        return ((await res.json()) as { prompt: { isDefault: boolean } }).prompt
      }, 'The generated system prompt could not be saved.')
      if (created) showSuccessToast(created.isDefault ? 'System prompt created' : 'Generated system prompt added beside the others')
    }

    if (data.physicalDescription) {
      await saveGeneratedPhysicalDescription(characterId, data.physicalDescription, {
        failureMessage: 'The generated physical description could not be saved.',
      })
    }
    if (data.wardrobeItems && data.wardrobeItems.length > 0) {
      const { saved, outfits } = await saveGeneratedWardrobeItems(characterId, data.wardrobeItems)
      if (saved > 0) {
        const outfitText = outfits > 0 ? ` (including ${outfits} outfit${outfits > 1 ? 's' : ''})` : ''
        showSuccessToast(`${saved} wardrobe item${saved > 1 ? 's' : ''} created${outfitText}`)
      }
    }
    const scenarios = normalizeGeneratedScenarios(data.scenarios)
    if (scenarios.length > 0) {
      const { saved } = await saveGeneratedScenarios(characterId, scenarios)
      if (saved > 0) showSuccessToast(`${saved} scenario${saved > 1 ? 's' : ''} created`)
    }
    if (errors.length > 0) showErrorToast(errors.join(' '))
    await queryClient.invalidateQueries({ queryKey: queryKeys.characters.prompts(characterId) })
    await reload()
    void invalidateLists()
  }

  // The server settles which prompt is the default (exactly one carries the flag).
  const defaultPromptContent = character.systemPrompts?.find((p) => p.isDefault)?.content ?? ''

  const renderSection = (active: string) => {
    switch (active) {
      case 'prompts':
        return <PromptsSection />
      case 'appearance':
        return <AppearanceSection />
      case 'abilities':
        return <AbilitiesSection />
      case 'chat-defaults':
        return <ChatDefaultsSection />
      case 'history':
        return <HistorySection />
      default:
        return <DetailsSection />
    }
  }

  return (
    <CharacterPageContext.Provider value={context}>
      <div className="character-page qt-page-container min-h-screen text-foreground">
        <CharacterHeader
          avatarStyle={avatarStyle}
          rehydrating={rehydrating}
          onBack={onBack}
          onStartChat={startChat}
          onChooseAvatar={() => setShowAvatarSelector(true)}
          onUploadAvatar={() => setShowUpload(true)}
          onGeneratePortrait={() => wardrobeDialog?.open({ characterId })}
          onOpenWardrobe={() => wardrobeDialog?.open({ characterId })}
          onOpenInventory={() => inventoryDialog?.open({ characterId })}
          onAIWizard={() => setShowWizard(true)}
          onOptimize={() => setShowOptimizer(true)}
          onExternalPrompt={() => setShowExternalPrompt(true)}
          onExport={() =>
            void triggerUrlDownload(
              `/api/v1/characters/${characterId}?action=export&format=json`,
              `${character.name.replace(/[^\w.-]+/g, '_') || 'character'}.json`,
            )
          }
          onToggleNpc={() =>
            void autosave.saveNow({ npc: !character.npc }, 'The NPC setting could not be saved.').then((ok) => {
              if (ok) showSuccessToast(character.npc ? 'Converted to character' : 'Converted to NPC')
            })
          }
          onToggleFavorite={() => void toggleFavorite()}
          onArchive={() => setShowArchive(true)}
          onRehydrate={() => void rehydrate()}
          onDelete={() => setShowDelete(true)}
        />

        {readOnly && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border qt-border-default qt-bg-muted/60 p-4">
            <span className="text-2xl" aria-hidden>
              🗄️
            </span>
            <div className="flex-1">
              <p className="qt-text-label text-foreground">{character.name} rests in the archive.</p>
              <p className="qt-text-small qt-text-secondary mt-1">
                Their effects — memories, correspondence, photographs, summaries — are packed into a sealed bundle on
                the shelf. What you see below is kept for the record and may be read but not altered; rehydrate them to
                pick up the pen again. Old conversations keep their words and their face throughout.
              </p>
            </div>
          </div>
        )}

        <EntityTabs
          tabs={CHARACTER_PAGE_TABS}
          activeTab={section}
          onTabChange={(id) => {
            if (isCharacterPageSection(id)) changeSection(id)
          }}
          ariaLabel="Character sections"
        >
          {(active) =>
            // An archived character is a tombstone: every control is inert, the
            // page still readable. The repository write guard is the real lock.
            readOnly ? (
              <fieldset disabled className="min-w-0">
                {renderSection(active)}
              </fieldset>
            ) : (
              renderSection(active)
            )
          }
        </EntityTabs>
      </div>

      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => setShowAvatarSelector(false)}
        onSelect={(imageId) => setAvatar(imageId || null)}
        currentImageId={character.defaultImageId}
        contextType="CHARACTER"
        contextId={characterId}
      />
      <ImageUploadDialog
        isOpen={showUpload}
        onClose={() => setShowUpload(false)}
        contextType="CHARACTER"
        contextId={characterId}
        generateOrientation="portrait"
        onSuccess={() => {
          // The upload lands in the gallery; choosing it is the next step.
          setShowUpload(false)
          void reload()
          setShowAvatarSelector(true)
        }}
      />

      <AIWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        characterId={characterId}
        characterName={character.name}
        currentData={{
          ...buildWizardCurrentData({
            title: character.title ?? '',
            identity: character.identity ?? '',
            description: character.description ?? '',
            manifesto: character.manifesto ?? '',
            personality: character.personality ?? '',
            firstMessage: character.firstMessage ?? '',
            exampleDialogues: character.exampleDialogues ?? '',
            // The default named prompt, so the wizard offers a System Prompt
            // only to a character that has none.
            systemPrompt: defaultPromptContent,
            pronouns: character.pronouns ?? null,
            aliases: character.aliases ?? [],
          }),
          scenarios: character.scenarios,
        }}
        onApply={(data) => void applyWizard(data)}
      />

      {showOptimizer && (
        <CharacterOptimizerModal
          characterId={characterId}
          characterName={character.name}
          profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
          defaultConnectionProfileId={character.defaultConnectionProfileId}
          vaultAvailable={!!character.characterDocumentMountPointId}
          onClose={() => setShowOptimizer(false)}
          onApplied={() => {
            setShowOptimizer(false)
            void autosave.flush().then(reload)
          }}
        />
      )}

      {showExternalPrompt && (
        <ExternalPromptDialog
          characterId={characterId}
          characterName={character.name}
          systemPrompts={character.systemPrompts}
          scenarios={character.scenarios}
          onCancel={() => setShowExternalPrompt(false)}
          onGenerated={(prompt) => {
            setShowExternalPrompt(false)
            setExternalPromptResult(prompt)
          }}
        />
      )}
      {externalPromptResult && (
        <ExternalPromptResultDialog
          characterName={character.name}
          prompt={externalPromptResult}
          onClose={() => setExternalPromptResult(null)}
        />
      )}

      {showArchive && (
        <ArchiveCharacterDialog
          characterName={character.name}
          onConfirm={archive}
          onCancel={() => setShowArchive(false)}
        />
      )}
      {leftoverBundleFileId && (
        <RehydrateBundleDialog
          characterName={character.name}
          bundleFileId={leftoverBundleFileId}
          onClose={() => setLeftoverBundleFileId(null)}
          onDeleted={() => showSuccessToast('The bundle is off the shelf.')}
        />
      )}
      {showDelete && (
        <CharacterDeleteDialog
          characterId={characterId}
          characterName={character.name}
          onClose={() => setShowDelete(false)}
          onConfirm={(options) => void deleteCharacter(options)}
        />
      )}
    </CharacterPageContext.Provider>
  )
}

export function CharacterPage(props: CharacterPageProps) {
  const { character, isLoading, error } = useCharacter(props.characterId)
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()

  if (isLoading && !character) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading character…</p>
      </div>
    )
  }

  // A broken vault answers 503: show its health report and the repair, not a
  // dead page.
  if (!character && error instanceof ApiFetchError && error.status === 503) {
    return <VaultRepairCard characterId={props.characterId} onBack={props.onBack} />
  }

  if (!character) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-lg qt-text-destructive">
            {error instanceof Error ? 'This character could not be loaded.' : 'This character could not be found.'}
          </p>
          <button type="button" onClick={props.onBack} className="font-medium text-primary hover:text-primary/80">
            ← Back to Characters
          </button>
        </div>
      </div>
    )
  }

  if (hiddenTagIds.size > 0 && shouldHideByIds(character.tags ?? [])) {
    return (
      <div className="flex min-h-screen items-center justify-center qt-bg-muted">
        <HiddenPlaceholder />
      </div>
    )
  }

  return <LoadedCharacterPage {...props} character={character} />
}
