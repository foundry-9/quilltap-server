'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { EmptyStatePanel } from '@/components/ui/EmptyState'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useCharactersList } from '@/lib/hooks/use-characters-list'
// Using native img tag instead of next/image because /api/files/* routes
// are dynamic API endpoints that can't go through Next.js image optimization
import dynamic from 'next/dynamic'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { CharacterDeleteDialog } from '@/components/character-delete-dialog'
import { deleteCharacter, deletionSummary, type CharacterDeleteOptions } from '@/components/characters/delete-character'
import { characterAvatarSrc } from '@/lib/characters/avatar-src'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { processTemplate } from '@/lib/templates/processor'
import { useGroups } from '@/app/aurora/hooks/useGroups'
import { GroupsGrid } from '@/app/aurora/components/GroupsGrid'
import { confirmAndDeleteGroup } from '@/app/aurora/shared/confirm-delete-group'
import { Icon } from '@/components/ui/icon'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import { useInTabDrilldown } from '@/components/workspace/useInTabDrilldown'
import { workspaceInPlaceProps } from '@/components/workspace/WorkspaceLinkInterceptor'

const AIImportWizard = dynamic(() => import('@/components/settings/ai-import/AIImportWizard'), {
  loading: () => <p className="qt-text-muted p-8 text-center">Loading wizard...</p>,
})

// Lazy so the list bundle doesn't pull in the character detail (chat modal,
// optimizer, editors) until a character is actually opened in place.
const CharacterPage = dynamic(
  () => import('./[id]/CharacterPage').then((m) => m.CharacterPage),
  { ssr: false, loading: () => <p className="qt-text-muted p-8 text-center">Loading character…</p> }
)

const GroupDetailView = dynamic(
  () => import('./groups/[id]/GroupDetailView').then((m) => m.GroupDetailView),
  { ssr: false, loading: () => <p className="qt-text-muted p-8 text-center">Loading group…</p> }
)

interface Character {
  id: string
  name: string
  title?: string | null
  description: string
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  isFavorite: boolean
  controlledBy: 'llm' | 'user'
  canBeCarina?: boolean
  npc: boolean
  archivedAt?: string | null
  defaultPartnerName?: string | null
  createdAt: string
  tags?: string[]
  defaultConnectionProfileId?: string | null
  _count: {
    chats: number
  }
}

export interface AuroraViewProps {
  /** Deep-link target: open with this group's editor shown (workspace tab only). */
  initialGroupId?: string
}

export function AuroraView({ initialGroupId }: AuroraViewProps = {}) {
  const fieldId = useId()
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [aiImportDialogOpen, setAIImportDialogOpen] = useState(false)
  const [resetBuiltinsDialogOpen, setResetBuiltinsDialogOpen] = useState(false)
  const [resetBuiltinsInProgress, setResetBuiltinsInProgress] = useState(false)
  const [deleteDialogCharacter, setDeleteDialogCharacter] = useState<Character | null>(null)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const { getProfileProvider } = useConnectionProfiles()
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()
  const router = useRouter()
  const { groups, deleteGroup, createGroup } = useGroups()
  const bgStyle = useSubsystemBackgroundStyle('aurora')
  // In a workspace tab, drilling into a character renders in place (keep-alive)
  // instead of navigating to /aurora/[id]. (Group detail still routes.)
  const {
    inTab,
    selectedId: selectedGroupId,
    setSelectedId: setSelectedGroupId,
  } = useInTabDrilldown(initialGroupId)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [openChatForSelected, setOpenChatForSelected] = useState(false)

  const queryClient = useQueryClient()
  // "Show archived" opts into the tombstones the API hides by default; the two
  // filter states cache under distinct keys so they never cross-contaminate.
  const [showArchived, setShowArchived] = useState(false)
  const charactersListKey = useMemo(
    () => queryKeys.characters.list(showArchived ? { archived: 'include' } : undefined),
    [showArchived]
  )
  const { data, isLoading: loading, error: loadError } = useCharactersList<Character>(
    showArchived ? { archived: 'include' } : undefined,
  )
  // Cache writer for the handlers below: with an updater it edits the cached
  // list (`charactersListKey` is the key `useCharactersList` reads) and
  // revalidates unless `{ revalidate: false }`; with no args it revalidates.
  const mutateCharacters = useCallback(
    async (
      updater?: (prev: { characters: Character[] } | undefined) => { characters: Character[] } | undefined,
      opts?: { revalidate?: boolean }
    ): Promise<void> => {
      if (updater) {
        queryClient.setQueryData<{ characters: Character[] }>(charactersListKey, updater)
        if (opts?.revalidate !== false) {
          // Prefix invalidation so the other archived-filter variant refreshes too.
          await queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
        }
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
    },
    [queryClient, charactersListKey]
  )
  const characters = useMemo(() => data ?? [], [data])
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'An error occurred') : null

  const visibleCharacters = useMemo(
    () => characters
      .filter(character => !shouldHideByIds(character.tags || []))
      .sort((a, b) => {
        // 0. Archived characters at the very end of the shelf
        const aArchived = Boolean(a.archivedAt)
        const bArchived = Boolean(b.archivedAt)
        if (aArchived !== bArchived) {
          return aArchived ? 1 : -1
        }
        // 1. NPCs last
        if (a.npc !== b.npc) {
          return a.npc ? 1 : -1
        }
        // 2. Favorites first
        if (a.isFavorite !== b.isFavorite) {
          return a.isFavorite ? -1 : 1
        }
        // 3. Then by chat count (descending)
        if (a._count.chats !== b._count.chats) {
          return b._count.chats - a._count.chats
        }
        // 4. Then alphabetically by name (case-insensitive)
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      }),
    [characters, shouldHideByIds]
  )

  const openDeleteDialog = (character: Character) => {
    setDeleteDialogCharacter(character)
  }

  const handleDeleteConfirm = async (options: CharacterDeleteOptions) => {
    if (!deleteDialogCharacter) return

    try {
      const result = await deleteCharacter(deleteDialogCharacter.id, options, 'Failed to delete character')
      await mutateCharacters()
      setDeleteDialogCharacter(null)
      showSuccessToast(deletionSummary(result, 'Character'))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete character')
    }
  }

  // The card's three switches: one action route each, answered with the
  // updated row, whose one flag is folded into the cached list.
  const toggleFlag = async (
    e: React.MouseEvent,
    id: string,
    action: 'favorite' | 'toggle-controlled-by' | 'toggle-carina',
    field: 'isFavorite' | 'controlledBy' | 'canBeCarina',
    failureMessage: string,
  ) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=${action}`, { method: 'POST' })
      if (!res.ok) throw new Error(failureMessage)
      const data = await res.json()
      await mutateCharacters(
        (prev) => prev && { characters: prev.characters.map((c) => (c.id === id ? { ...c, [field]: data.character[field] } : c)) },
        { revalidate: false }
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : failureMessage)
    }
  }

  const toggleFavorite = (e: React.MouseEvent, id: string) =>
    toggleFlag(e, id, 'favorite', 'isFavorite', 'Failed to toggle favorite')
  const toggleControlledBy = (e: React.MouseEvent, id: string) =>
    toggleFlag(e, id, 'toggle-controlled-by', 'controlledBy', 'Failed to toggle controlled-by')
  const toggleCarina = (e: React.MouseEvent, id: string) =>
    toggleFlag(e, id, 'toggle-carina', 'canBeCarina', 'Failed to toggle Carina eligibility')

  const handleCardClick = (e: React.MouseEvent, characterId: string) => {
    // Don't navigate if clicking on a button, link, or interactive element
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    if (inTab) {
      setOpenChatForSelected(false)
      setSelectedCharacterId(characterId)
    } else {
      router.push(`/aurora/${characterId}`)
    }
  }

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return

    try {
      setCreatingGroup(true)
      const newGroup = await createGroup(newGroupName, newGroupDescription || null)
      if (newGroup) {
        setCreateGroupDialogOpen(false)
        setNewGroupName('')
        setNewGroupDescription('')
        // Open the new group — in place if we're a workspace tab, else navigate.
        if (inTab) setSelectedGroupId(newGroup.id)
        else router.push(`/aurora/groups/${newGroup.id}`)
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to create group')
    } finally {
      setCreatingGroup(false)
    }
  }

  // The trash icon on a group card asks first, naming the group (#272).
  const handleDeleteGroup = useCallback((groupId: string) => {
    void confirmAndDeleteGroup(groupId, groups, deleteGroup)
  }, [groups, deleteGroup])

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/v1/characters?action=import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to import character')

      await res.json()
      await mutateCharacters()
      setImportDialogOpen(false)
      showSuccessToast('Character imported successfully!')
    } catch (err) {
      showErrorToast('Failed to import character. Make sure it\'s a valid SillyTavern PNG or JSON file.')
      console.error('Failed to import character', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleResetBuiltins = async () => {
    setResetBuiltinsInProgress(true)

    try {
      const res = await fetch('/api/v1/characters?action=reset-builtins', {
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error('Failed to reset built-in characters')
      }

      await res.json()
      await mutateCharacters()
      setResetBuiltinsDialogOpen(false)
      showSuccessToast('Built-in characters reset successfully.')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to reset built-in characters')
      console.error('Failed to reset built-in characters', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setResetBuiltinsInProgress(false)
    }
  }

  const closeCreateGroupDialog = () => {
    setCreateGroupDialogOpen(false)
    setNewGroupName('')
    setNewGroupDescription('')
  }

  // Workspace tab, drilled into a character or group: render its detail in place
  // (the detail views manage their own loading, so this precedes the list gate).
  if (inTab && selectedCharacterId) {
    return (
      <CharacterPage
        characterId={selectedCharacterId}
        onBack={() => {
          setSelectedCharacterId(null)
          setOpenChatForSelected(false)
        }}
        openChatOnMount={openChatForSelected}
      />
    )
  }

  if (inTab && selectedGroupId) {
    return (
      <GroupDetailView
        groupId={selectedGroupId}
        onBack={() => setSelectedGroupId(null)}
      />
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text">Loading characters...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="character-page qt-page-container qt-text" style={bgStyle}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <h1 className="qt-page-title">Characters</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`qt-button character-toolbar__button inline-flex items-center gap-1.5 rounded-lg border qt-border-default px-4 py-2 text-sm qt-shadow-sm transition focus-visible:outline-none focus-visible:ring-2 qt-focus-ring ${showArchived ? 'qt-bg-primary/20 qt-text-primary' : 'qt-bg-muted/70 qt-text-primary hover:qt-bg-muted'}`}
            title={showArchived ? 'Tuck the archived characters back out of sight' : 'Show characters resting in the archive'}
          >
            <Icon name="folder" className="w-4 h-4" />
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button
            onClick={() => setResetBuiltinsDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 qt-focus-ring"
            title="Reset built-in characters to first-run defaults"
          >
            Reset Built-in Characters
          </button>
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 qt-focus-ring"
          >
            Import from SillyTavern
          </button>
          <button
            onClick={() => setAIImportDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 qt-focus-ring"
            title="AI generation of character from any text source"
          >
            Summon From Lore
          </button>
          <button
            onClick={() => setCreateGroupDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 qt-focus-ring"
            title="Create a new group"
          >
            Create Group
          </button>
          <Link
            href="/aurora/new"
            className="qt-button character-toolbar__button character-toolbar__button--primary qt-button-primary"
          >
            Create Character
          </Link>
        </div>
      </div>

      {/* Groups Section — rendered unconditionally so GroupsGrid can show its
          empty state ("No groups yet") for first-time users. */}
      <div className="mt-8">
        <h2 className="qt-heading-2 mb-6 qt-text">Groups</h2>
        <GroupsGrid
          groups={groups}
          onCreateClick={() => setCreateGroupDialogOpen(true)}
          onDeleteClick={handleDeleteGroup}
          onOpenGroup={inTab ? setSelectedGroupId : undefined}
        />
      </div>

      {/* Characters Section */}
      {visibleCharacters.length === 0 ? (
        <EmptyStatePanel className="character-empty-state">
          <p className="mb-4 text-lg qt-text-secondary">No characters yet</p>
          <Link
            href="/aurora/new"
            className="qt-text-primary hover:qt-text-brand/80"
          >
            Create your first character
          </Link>
        </EmptyStatePanel>
      ) : (
        <div className="character-card-grid mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleCharacters.map((character) => (
            <div
              key={character.id}
              className="qt-entity-card character-card cursor-pointer hover:qt-border-primary/50 transition-colors"
              onClick={(e) => handleCardClick(e, character.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center flex-grow gap-4">
                  {characterAvatarSrc(character) ? (
                    <img
                      src={characterAvatarSrc(character)!}
                      alt={character.name}
                      width={48}
                      height={48}
                      className={getAvatarClasses(style, 'md').imageClass}
                    />
                  ) : (
                    <div className={getAvatarClasses(style, 'md').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                      <span className={getAvatarClasses(style, 'md').fallbackClass}>
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-grow">
                    <h2 className="qt-heading-3 qt-text flex items-center gap-2">
                      <Link
                        href={`/aurora/${character.id}`}
                        {...workspaceInPlaceProps(inTab)}
                        onClick={inTab ? (e) => {
                          e.preventDefault()
                          setOpenChatForSelected(false)
                          setSelectedCharacterId(character.id)
                        } : undefined}
                      >
                        {character.name}
                      </Link>
                      {character.archivedAt && (
                        <span
                          className="qt-badge inline-flex items-center rounded-full border qt-border-default qt-bg-muted px-2 py-0.5 text-xs font-medium qt-text-secondary"
                          title={`Resting in the archive since ${new Date(character.archivedAt).toLocaleDateString()}`}
                        >
                          Archived
                        </span>
                      )}
                    </h2>
                    {character.title && (
                      <p className="qt-text-small">{character.title}</p>
                    )}
                    <p className="qt-text-small">
                      {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
                    </p>
                    {character.defaultConnectionProfileId && (() => {
                      const profileInfo = getProfileProvider(character.defaultConnectionProfileId!)
                      return profileInfo ? (
                        <ProviderModelBadge provider={profileInfo.provider} modelName={profileInfo.modelName} size="sm" />
                      ) : null
                    })()}
                  </div>
                </div>
                {!character.archivedAt && (
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={(e) => toggleFavorite(e, character.id)}
                      className="text-2xl qt-text-favorite transition-transform hover:scale-110 inline-flex items-center justify-center min-w-6 min-h-6"
                      title={character.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      aria-label={`Favorite ${character.name}`}
                      aria-pressed={!!character.isFavorite}
                    >
                      <span aria-hidden="true">{character.isFavorite ? '⭐' : '☆'}</span>
                    </button>
                    <button
                      onClick={(e) => toggleCarina(e, character.id)}
                      className={`transition hover:scale-110 ${character.canBeCarina ? 'qt-text-favorite' : 'qt-text-secondary'}`}
                      title={character.canBeCarina ? 'Disable Carina answers (@-queries)' : 'Enable Carina answers (@-queries)'}
                      aria-label={`Carina answers (@-queries) for ${character.name}`}
                      aria-pressed={!!character.canBeCarina}
                    >
                      <Icon name="monitor" className="w-6 h-6" />
                    </button>
                    <button
                      onClick={(e) => toggleControlledBy(e, character.id)}
                      className={`transition hover:scale-110 ${character.controlledBy === 'user' ? 'qt-text-favorite' : 'qt-text-secondary'}`}
                      title={character.controlledBy === 'user' ? 'Switch to LLM control' : 'Switch to user control'}
                      aria-label={`You play ${character.name}`}
                      aria-pressed={character.controlledBy === 'user'}
                    >
                      <Icon name="user" className="w-6 h-6" />
                    </button>
                  </div>
                )}
              </div>

              <p className="line-clamp-3 qt-text-small">
                {processTemplate(character.description || '', {
                  char: character.name,
                  user: character.controlledBy === 'user'
                    ? character.name
                    : (character.defaultPartnerName || 'User')
                })}
              </p>

              <div className="qt-entity-card-actions character-card-actions">
                {character.archivedAt ? (
                  <span
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border qt-border-default qt-bg-muted/50 px-4 py-2 text-sm qt-text-secondary"
                    title="An archived character neither chats nor exports; open their page to rehydrate them."
                  >
                    Resting in the archive
                  </span>
                ) : (
                  <>
                    <Link
                      href={`/aurora/${character.id}?action=chat`}
                      {...workspaceInPlaceProps(inTab)}
                      onClick={inTab ? (e) => {
                        e.preventDefault()
                        setOpenChatForSelected(true)
                        setSelectedCharacterId(character.id)
                      } : undefined}
                      className="character-card__action character-card__action--chat inline-flex flex-1 items-center justify-center gap-2 rounded-lg qt-bg-success px-4 py-2 text-sm font-semibold qt-text-on-success qt-shadow-sm transition hover:qt-bg-success/90"
                      title="Start a chat with this character"
                    >
                      <Icon name="chat" className="w-5 h-5" />
                      Chat
                    </Link>
                    <a
                      href={`/api/v1/characters/${character.id}?action=export&format=json`}
                      className="character-card__action inline-flex items-center justify-center gap-2 rounded-lg border qt-border-default qt-bg-muted/80 px-3 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted"
                      title="Export character data"
                      aria-label={`Export ${character.name}`}
                    >
                      <Icon name="download" className="w-5 h-5" />
                    </a>
                  </>
                )}
                <button
                  onClick={() => openDeleteDialog(character)}
                  className="character-card__action qt-button-destructive qt-shadow-sm"
                  title="Delete this character"
                  aria-label={`Delete ${character.name}`}
                >
                  <Icon name="trash" className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      <BaseModal
        isOpen={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        headerless
        maxWidth="md"
        className="rounded-2xl border qt-border-default qt-bg-card shadow-2xl"
        bodyClassName="p-6 overflow-y-auto"
        overlayClassName="character-import-dialog"
      >
        <ModalTitle className="mb-4 qt-dialog-title qt-text">
          Import from SillyTavern
        </ModalTitle>
        <form onSubmit={handleImport}>
          <div className="mb-4">
            <label htmlFor={`${fieldId}-f0`} className="mb-2 qt-label">
              Select SillyTavern character file (PNG or JSON)
            </label>
            <input
              id={`${fieldId}-f0`}
              type="file"
              name="file"
              accept=".png,.json"
              required
              className="block w-full qt-text-small file:mr-4 file:rounded-md file:border-0 file:qt-bg-primary/20 file:px-4 file:py-2 file:font-semibold file:text-primary hover:file:qt-bg-primary/30"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setImportDialogOpen(false)}
              className="qt-button-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="qt-button qt-button-primary"
            >
              Import
            </button>
          </div>
        </form>
      </BaseModal>

      {/* Reset Built-ins Dialog */}
      <BaseModal
        isOpen={resetBuiltinsDialogOpen}
        onClose={() => setResetBuiltinsDialogOpen(false)}
        role="alertdialog"
        busy={resetBuiltinsInProgress}
        headerless
        maxWidth="md"
        className="rounded-2xl border qt-border-default qt-bg-card shadow-2xl"
        bodyClassName="p-6 overflow-y-auto"
        overlayClassName="character-import-dialog"
      >
        <ModalTitle className="mb-3 qt-dialog-title qt-text">
          Reset Built-in Characters
        </ModalTitle>
        <p className="mb-5 qt-text-small">
          This will delete existing Lorian and Riya records if present, then re-import their first-run versions.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setResetBuiltinsDialogOpen(false)}
            disabled={resetBuiltinsInProgress}
            className="qt-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleResetBuiltins}
            disabled={resetBuiltinsInProgress}
            className="qt-button qt-button-primary"
          >
            {resetBuiltinsInProgress ? 'Resetting...' : 'Reset Built-ins'}
          </button>
        </div>
      </BaseModal>

      {/* AI Import Dialog */}
      {/* Summon From Lore is a wizard the user types into: a stray backdrop
          click must not throw the draft away. */}
      <BaseModal
        isOpen={aiImportDialogOpen}
        onClose={() => setAIImportDialogOpen(false)}
        headerless
        maxWidth="4xl"
        className="rounded-2xl border qt-border-default qt-bg-card shadow-2xl"
        bodyClassName="p-6 overflow-y-auto"
        overlayClassName="character-import-dialog"
        closeOnClickOutside={false}
      >
        <div className="flex items-center justify-between mb-4">
          <ModalTitle className="qt-dialog-title qt-text">
            Summon From Lore
          </ModalTitle>
          <button
            onClick={() => setAIImportDialogOpen(false)}
            className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 text-sm qt-text-primary qt-shadow-sm hover:qt-bg-muted"
          >
            Close
          </button>
        </div>
        <AIImportWizard
          onClose={() => setAIImportDialogOpen(false)}
          onImportSuccess={() => {
            mutateCharacters()
          }}
        />
      </BaseModal>

      {/* Delete Character Dialog */}
      {deleteDialogCharacter && (
        <CharacterDeleteDialog
          characterId={deleteDialogCharacter.id}
          characterName={deleteDialogCharacter.name}
          onClose={() => setDeleteDialogCharacter(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

      {/* Create Group Dialog */}
      <BaseModal
        isOpen={createGroupDialogOpen}
        onClose={closeCreateGroupDialog}
        busy={creatingGroup}
        headerless
        maxWidth="md"
        className="rounded-2xl border qt-border-default qt-bg-card shadow-2xl"
        bodyClassName="p-6 overflow-y-auto"
       
        closeOnClickOutside={false}
      >
        <ModalTitle className="mb-4 qt-dialog-title qt-text">
          Create Group
        </ModalTitle>
        <form onSubmit={handleCreateGroup}>
          <div className="mb-4">
            <label htmlFor={`${fieldId}-f1`} className="mb-2 block text-sm font-medium qt-text">
              Group Name *
            </label>
            <input
              id={`${fieldId}-f1`}
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g., Adventuring Party"
              className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent qt-text text-sm"
              autoFocus
              required
            />
          </div>
          <div className="mb-6">
            <label htmlFor={`${fieldId}-f2`} className="mb-2 block text-sm font-medium qt-text">
              Description (optional)
            </label>
            <textarea
              id={`${fieldId}-f2`}
              value={newGroupDescription}
              onChange={(e) => setNewGroupDescription(e.target.value)}
              placeholder="Optional description of this group"
              rows={3}
              className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent qt-text text-sm resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={closeCreateGroupDialog}
              disabled={creatingGroup}
              className="qt-button-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingGroup || !newGroupName.trim()}
              className="qt-button qt-button-primary"
            >
              {creatingGroup ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </BaseModal>

    </div>
  )
}
