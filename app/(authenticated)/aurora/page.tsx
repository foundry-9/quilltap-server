'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
// Using native img tag instead of next/image because /api/files/* routes
// are dynamic API endpoints that can't go through Next.js image optimization
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import { CharacterDeleteDialog } from '@/components/character-delete-dialog'
import { processTemplate } from '@/lib/templates/processor'

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
  npc: boolean
  defaultPartnerName?: string | null
  createdAt: string
  tags?: string[]
  _count: {
    chats: number
  }
}

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [deleteDialogCharacter, setDeleteDialogCharacter] = useState<Character | null>(null)
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()
  const { refreshSidebar } = useSidebarData()
  const router = useRouter()

  const visibleCharacters = useMemo(
    () => characters
      .filter(character => !shouldHideByIds(character.tags || []))
      .sort((a, b) => {
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

  useEffect(() => {
    fetchCharacters()
  }, [])

  const getAvatarSrc = (character: Character): string | null => {
    if (character.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    }
    return character.avatarUrl || null
  }

  const fetchCharacters = async () => {
    try {
      const res = await fetch('/api/v1/characters')
      if (!res.ok) throw new Error('Failed to fetch characters')
      const data = await res.json()
      setCharacters(data.characters)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const openDeleteDialog = (character: Character) => {
    setDeleteDialogCharacter(character)
  }

  const handleDeleteConfirm = async (options: { cascadeChats: boolean; cascadeImages: boolean }) => {
    if (!deleteDialogCharacter) return

    const id = deleteDialogCharacter.id
    const params = new URLSearchParams()
    if (options.cascadeChats) params.set('cascadeChats', 'true')
    if (options.cascadeImages) params.set('cascadeImages', 'true')

    try {
      const url = `/api/v1/characters/${id}${params.toString() ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete character')

      const result = await res.json()
      setCharacters(characters.filter((c) => c.id !== id))
      setDeleteDialogCharacter(null)

      // Show success message with details
      const deletedItems: string[] = ['Character deleted']
      if (result.deletedChats > 0) {
        deletedItems.push(`${result.deletedChats} chat${result.deletedChats === 1 ? '' : 's'} deleted`)
      }
      if (result.deletedImages > 0) {
        deletedItems.push(`${result.deletedImages} image${result.deletedImages === 1 ? '' : 's'} deleted`)
      }
      if (result.deletedMemories > 0) {
        deletedItems.push(`${result.deletedMemories} memor${result.deletedMemories === 1 ? 'y' : 'ies'} deleted`)
      }
      showSuccessToast(deletedItems.join('. '))

      // Refresh sidebar to reflect deletion (also refreshes chats if cascadeChats was used)
      refreshSidebar()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete character')
    }
  }

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=favorite`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to toggle favorite')
      const data = await res.json()
      setCharacters(characters.map((c) => (c.id === id ? { ...c, isFavorite: data.character.isFavorite } : c)))

      // Refresh sidebar to reflect favorite change (favorites are shown first)
      refreshSidebar()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle favorite')
    }
  }

  const toggleControlledBy = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=toggle-controlled-by`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to toggle controlled-by')
      const data = await res.json()
      setCharacters(characters.map((c) => (c.id === id ? { ...c, controlledBy: data.character.controlledBy } : c)))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle controlled-by')
    }
  }

  const handleCardClick = (e: React.MouseEvent, characterId: string) => {
    // Don't navigate if clicking on a button, link, or interactive element
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    router.push(`/aurora/${characterId}/view`)
  }

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/v1/characters?action=import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to import character')

      const character = await res.json()
      setCharacters([character, ...characters])
      setImportDialogOpen(false)
      showSuccessToast('Character imported successfully!')
    } catch (err) {
      showErrorToast('Failed to import character. Make sure it\'s a valid SillyTavern PNG or JSON file.')
      console.error('Failed to import character', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading characters...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="character-page qt-page-container text-foreground" style={{ '--story-background-url': 'url(/images/aurora.webp)' } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
        <h1 className="text-3xl font-semibold leading-tight">Characters</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button character-toolbar__button inline-flex items-center rounded-lg border border-border bg-muted/70 px-4 py-2 text-sm qt-text-primary shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import
          </button>
          <Link
            href="/aurora/new"
            className="qt-button character-toolbar__button character-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Create Character
          </Link>
        </div>
      </div>

      {visibleCharacters.length === 0 ? (
        <div className="character-empty-state mt-12 rounded-2xl border border-dashed border-border/70 bg-card/80 px-8 py-12 text-center shadow-sm">
          <p className="mb-4 text-lg text-muted-foreground">No characters yet</p>
          <Link
            href="/aurora/new"
            className="qt-text-primary hover:text-primary/80"
          >
            Create your first character
          </Link>
        </div>
      ) : (
        <div className="character-card-grid mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleCharacters.map((character) => (
            <div
              key={character.id}
              className="qt-entity-card character-card cursor-pointer hover:border-primary/50 transition-colors"
              onClick={(e) => handleCardClick(e, character.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center flex-grow gap-4">
                  {getAvatarSrc(character) ? (
                     
                    <img
                      src={getAvatarSrc(character)!}
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
                    <h2 className="text-xl font-semibold text-foreground">{character.name}</h2>
                    {character.title && (
                      <p className="qt-text-small">{character.title}</p>
                    )}
                    <p className="qt-text-small">
                      {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={(e) => toggleFavorite(e, character.id)}
                    className="text-2xl qt-text-favorite transition-transform hover:scale-110"
                    title={character.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {character.isFavorite ? '⭐' : '☆'}
                  </button>
                  <button
                    onClick={(e) => toggleControlledBy(e, character.id)}
                    className="qt-text-favorite transition-transform hover:scale-110"
                    title={character.controlledBy === 'user' ? 'Switch to LLM control' : 'Switch to user control'}
                  >
                    {character.controlledBy === 'user' ? (
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                      </svg>
                    ) : (
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    )}
                  </button>
                </div>
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
                <Link
                  href={`/aurora/${character.id}/view?action=chat`}
                  className="character-card__action character-card__action--chat inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow-sm transition hover:bg-success/90"
                  title="Start a chat with this character"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </Link>
                <a
                  href={`/api/v1/characters/${character.id}?action=export&format=json`}
                  className="character-card__action inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/80 px-3 py-2 text-sm qt-text-primary shadow-sm transition hover:bg-muted"
                  title="Export character data"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v6a2 2 0 002 2h12a2 2 0 002-2v-6m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
                <button
                  onClick={() => openDeleteDialog(character)}
                  className="character-card__action qt-button-destructive shadow-sm"
                  title="Delete this character"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      {importDialogOpen && (
        <div className="character-import-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-foreground">
              Import Character
            </h3>
            <form onSubmit={handleImport}>
              <div className="mb-4">
                <label className="mb-2 block text-sm qt-text-primary">
                  Select SillyTavern character file (PNG or JSON)
                </label>
                <input
                  type="file"
                  name="file"
                  accept=".png,.json"
                  required
                  className="block w-full qt-text-small file:mr-4 file:rounded-md file:border-0 file:bg-primary/20 file:px-4 file:py-2 file:font-semibold file:text-primary hover:file:bg-primary/30"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(false)}
                  className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm qt-text-primary shadow-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
                >
                  Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Character Dialog */}
      {deleteDialogCharacter && (
        <CharacterDeleteDialog
          characterId={deleteDialogCharacter.id}
          characterName={deleteDialogCharacter.name}
          onClose={() => setDeleteDialogCharacter(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

    </div>
  )
}
