'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import { TagBadge } from '@/components/tags/tag-badge'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { clientLogger } from '@/lib/client-logger'

interface Persona {
  id: string
  name: string
  title: string | null
  description: string
  personalityTraits: string | null
  avatarUrl: string | null
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  createdAt: string
  characters: Array<{
    character: {
      id: string
      name: string
    }
  }>
  tags: Array<{
    tagId: string
    tag: {
      id: string
      name: string
    }
  }>
}

export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [galleryPersona, setGalleryPersona] = useState<{ id: string; name: string } | null>(null)
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()

  const visiblePersonas = useMemo(
    () => personas.filter(persona => !shouldHideByIds(persona.tags.map(tagLink => tagLink.tag.id))),
    [personas, shouldHideByIds]
  )

  const getAvatarSrc = (persona: Persona): string | null => {
    if (persona.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = persona.defaultImage.filepath
      return persona.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    }
    return persona.avatarUrl || null
  }

  useEffect(() => {
    fetchPersonas()
  }, [])

  const fetchPersonas = async () => {
    try {
      const response = await fetch('/api/personas')
      if (!response.ok) throw new Error('Failed to fetch personas')
      const data = await response.json()
      setPersonas(data)
    } catch (err) {
      setError('Failed to load personas')
      clientLogger.error('Failed to fetch personas', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this persona?')
    if (!confirmed) return

    try {
      const response = await fetch(`/api/personas/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete persona')

      setPersonas(personas.filter((p) => p.id !== id))
    } catch (err) {
      showErrorToast('Failed to delete persona')
      clientLogger.error('Failed to delete persona', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const file = formData.get('file') as File

    if (!file) return

    try {
      const text = await file.text()
      const personaData = JSON.parse(text)

      const response = await fetch('/api/personas/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ personaData }),
      })

      if (!response.ok) throw new Error('Failed to import persona')

      const result = await response.json()

      // Check if this is a multi-persona import or single persona import
      if (result.personas && Array.isArray(result.personas)) {
        // Multi-persona import
        setPersonas([...result.personas, ...personas])
        setImportDialogOpen(false)
        showSuccessToast(result.message || `Successfully imported ${result.count} persona(s)!`)
      } else {
        // Single persona import
        setPersonas([result, ...personas])
        setImportDialogOpen(false)
        showSuccessToast('Persona imported successfully!')
      }
    } catch (err) {
      showErrorToast('Failed to import persona. Make sure it\'s a valid SillyTavern persona JSON file.')
      clientLogger.error('Failed to import persona', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading personas...</p>
      </div>
    )
  }

  return (
    <div className="persona-page container mx-auto max-w-5xl px-4 py-8 text-foreground">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Personas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the user personas that represent you in conversations.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button persona-toolbar__button inline-flex items-center rounded-lg border border-border bg-muted/70 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import
          </button>
          <Link
            href="/personas/new"
            className="qt-button persona-toolbar__button persona-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Create Persona
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {visiblePersonas.length === 0 ? (
        <div className="persona-empty-state mt-12 rounded-2xl border border-dashed border-border/70 bg-card/80 px-8 py-12 text-center shadow-sm">
          <svg
            className="mx-auto h-12 w-12 text-muted-foreground/70"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <h3 className="mt-4 text-base font-semibold text-foreground">No personas yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a persona to represent yourself or import one from SillyTavern.
          </p>
          <div className="mt-6">
            <Link
              href="/personas/new"
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              Create Persona
            </Link>
          </div>
        </div>
      ) : (
        <div className="persona-card-grid mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {visiblePersonas.map((persona) => (
            <div
              key={persona.id}
              className="qt-entity-card persona-card"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center flex-grow gap-4">
                  {getAvatarSrc(persona) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getAvatarSrc(persona)!}
                      alt={persona.name}
                      width={48}
                      height={60}
                      className={getAvatarClasses(style, 'md').imageClass}
                    />
                  ) : (
                    <div className={getAvatarClasses(style, 'md').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                      <span className={getAvatarClasses(style, 'md').fallbackClass}>
                        {persona.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-grow">
                    <h2 className="text-xl font-semibold text-foreground">{persona.name}</h2>
                    {persona.title && (
                      <p className="text-sm text-muted-foreground">{persona.title}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-grow">
                <p className="mb-4 line-clamp-3 text-sm text-muted-foreground">
                  {persona.description}
                </p>

                {persona.characters.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Linked to:</p>
                    <div className="flex flex-wrap gap-1">
                      {persona.characters.map((link) => (
                        <span
                          key={link.character.id}
                          className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                        >
                          {link.character.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {persona.tags.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Tags:</p>
                    <div className="flex flex-wrap gap-1">
                      {persona.tags.map((tagLink) => (
                        <TagBadge
                          key={tagLink.tag.id}
                          tag={tagLink.tag}
                          size="sm"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="qt-entity-card-actions persona-card-actions">
                <Link
                  href={`/personas/${persona.id}`}
                  className="persona-card__action inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
                >
                  Edit
                </Link>
                <button
                  onClick={() => setGalleryPersona({ id: persona.id, name: persona.name })}
                  className="persona-card__action inline-flex items-center justify-center rounded-lg border border-border bg-muted/80 px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted"
                  title="Photos"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <a
                  href={`/api/personas/${persona.id}/export`}
                  className="persona-card__action inline-flex items-center justify-center rounded-lg border border-border bg-muted/80 px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted"
                  title="Export"
                >
                  ↓
                </a>
                <button
                  onClick={() => handleDelete(persona.id)}
                  className="persona-card__action inline-flex items-center justify-center rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow-sm transition hover:bg-destructive/90"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      {importDialogOpen && (
        <div className="persona-import-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-foreground">
              Import Persona
            </h3>
            <form onSubmit={handleImport}>
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Select SillyTavern persona JSON file
                </label>
                <input
                  type="file"
                  name="file"
                  accept=".json"
                  required
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary/20 file:px-4 file:py-2 file:font-semibold file:text-primary hover:file:bg-primary/30"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(false)}
                  className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
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

      {/* Persona Photo Gallery Modal */}
      {galleryPersona && (
        <PhotoGalleryModal
          mode="persona"
          isOpen={true}
          onClose={() => setGalleryPersona(null)}
          personaId={galleryPersona.id}
          personaName={galleryPersona.name}
        />
      )}
    </div>
  )
}
