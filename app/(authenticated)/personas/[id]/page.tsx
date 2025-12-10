'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { TagEditor } from '@/components/tags/tag-editor'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { EntityTabs, Tab } from '@/components/tabs'
import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'

interface Persona {
  id: string
  name: string
  title?: string
  description: string
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  tags?: string[]
}

const EDIT_PERSONA_TABS: Tab[] = [
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
]

export default function EditPersonaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [persona, setPersona] = useState<Persona | null>(null)
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    description: '',
  })
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()

  const fetchPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/personas/${id}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        }
      })
      if (!res.ok) throw new Error('Failed to fetch persona')
      const p = await res.json()
      setPersona((prev) => {
        if (prev?.defaultImageId !== p.defaultImageId) {
          setAvatarRefreshKey(k => k + 1)
        }
        return p
      })
      setFormData({
        name: p.name,
        title: p.title || '',
        description: p.description,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchPersona()
  }, [fetchPersona])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/personas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update persona')
      }

      showSuccessToast('Persona saved successfully!')
      router.push('/personas')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const setPersonaAvatar = async (imageId: string) => {
    try {
      const res = await fetch(`/api/personas/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      if (!res.ok) throw new Error('Failed to set avatar')

      await fetchPersona()
      setShowAvatarSelector(false)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to set avatar')
    }
  }

  const getAvatarSrc = () => {
    let src = null
    if (persona?.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = persona.defaultImage.filepath
      src = persona.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    } else {
      src = persona?.avatarUrl
    }
    // Add cache-busting parameter based on defaultImageId to force reload when avatar changes
    if (src && persona?.defaultImageId) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${persona.defaultImageId}`
    }
    return src
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading persona...</p>
      </div>
    )
  }

  if (hiddenTagIds.size > 0 && persona && shouldHideByIds(persona.tags || [])) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <HiddenPlaceholder />
      </div>
    )
  }

  return (
    <div className="persona-edit container mx-auto max-w-5xl px-4 py-8 text-foreground">
      <div className="mb-8">
        <Link
          href="/personas"
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          ← Back to Personas
        </Link>
        <div className="flex items-center gap-4">
          <div className="relative">
            {getAvatarSrc() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${persona?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                src={getAvatarSrc()!}
                alt={persona?.name || ''}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                <span className="text-3xl font-bold text-muted-foreground">
                  {persona?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <button
              onClick={() => setShowAvatarSelector(true)}
              className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground shadow-lg transition hover:bg-primary/90"
              title="Change avatar"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">{persona?.name || 'Loading...'}</h1>
            {persona?.title && (
              <p className="text-muted-foreground">{persona.title}</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="persona-section-card rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
        <EntityTabs tabs={EDIT_PERSONA_TABS} defaultTab="details">
          {(activeTab: string) => {
            switch (activeTab) {
              case 'details':
                return (
                  <div className="space-y-6">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium mb-2 text-foreground">
                        Name *
                      </label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    <div>
                      <label htmlFor="title" className="block text-sm font-medium mb-2 text-foreground">
                        Title (Optional)
                      </label>
                      <input
                        type="text"
                        id="title"
                        name="title"
                        value={formData.title}
                        onChange={handleChange}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="e.g., Student, Teacher, Narrator"
                      />
                    </div>

                    <div>
                      <label htmlFor="description" className="block text-sm font-medium mb-2 text-foreground">
                        Description *
                      </label>
                      <textarea
                        id="description"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        required
                        rows={6}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Describe this persona's characteristics, background, and role"
                      />
                    </div>

                    {/* Tag Editor */}
                    <TagEditor entityType="persona" entityId={id} />
                  </div>
                )

              case 'gallery':
                return (
                  <EmbeddedPhotoGallery
                    entityType="persona"
                    entityId={id}
                    entityName={persona?.name || 'Persona'}
                    currentAvatarId={persona?.defaultImageId}
                    onAvatarChange={(imageId) => {
                      if (imageId) {
                        setPersonaAvatar(imageId)
                      } else {
                        // Clear avatar
                        fetch(`/api/personas/${id}/avatar`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageId: null }),
                        }).then(() => fetchPersona())
                      }
                    }}
                    onRefresh={fetchPersona}
                  />
                )

              case 'descriptions':
                return (
                  <PhysicalDescriptionList
                    entityType="persona"
                    entityId={id}
                  />
                )

              default:
                return null
            }
          }}
        </EntityTabs>

        <div className="mt-8 flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Persona'}
          </button>
          <Link
            href="/personas"
            className="rounded-lg border border-border bg-card px-6 py-3 text-base font-medium text-muted-foreground shadow transition hover:bg-muted/80"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Avatar Selector Modal */}
      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => setShowAvatarSelector(false)}
        onSelect={setPersonaAvatar}
        currentImageId={persona?.defaultImageId}
        contextType="PERSONA"
        contextId={id}
      />

      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={() => {
          setShowUploadDialog(false)
          fetchPersona()
        }}
        contextType="PERSONA"
        contextId={id}
      />
    </div>
  )
}
