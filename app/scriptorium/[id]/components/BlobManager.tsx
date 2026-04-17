'use client'

/**
 * Blob Manager
 *
 * Upload, list, describe, and delete binary blobs (images for v1) attached
 * to a document store. Blobs are transcoded to WebP server-side via sharp
 * and stored encrypted inside quilltap-mount-index.db.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentStoreBlob } from '../../types'

interface BlobManagerProps {
  mountPointId: string
  mountPointName: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function BlobManager({ mountPointId, mountPointName }: BlobManagerProps) {
  const [blobs, setBlobs] = useState<DocumentStoreBlob[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadBlobs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/mount-points/${mountPointId}/blobs`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBlobs(data.blobs ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [mountPointId])

  useEffect(() => {
    void loadBlobs()
  }, [loadBlobs])

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.set('file', file)
        // Default path: images/<filename> so Markdown references work out of the box
        form.set('path', `images/${file.name}`)
        form.set('description', '')
        const res = await fetch(`/api/v1/mount-points/${mountPointId}/blobs`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || `Upload failed (${res.status})`)
        }
      }
      await loadBlobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (blob: DocumentStoreBlob) => {
    if (!confirm(`Delete ${blob.relativePath}? Markdown references to this blob will 404 until re-uploaded.`)) return
    try {
      const res = await fetch(
        `/api/v1/mount-points/${mountPointId}/blobs/${blob.relativePath.split('/').map(encodeURIComponent).join('/')}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      setBlobs(prev => prev.filter(b => b.id !== blob.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDescriptionSave = async (blob: DocumentStoreBlob, description: string) => {
    try {
      const res = await fetch(
        `/api/v1/mount-points/${mountPointId}/blobs/${blob.relativePath.split('/').map(encodeURIComponent).join('/')}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        }
      )
      if (!res.ok) throw new Error(`Update failed (${res.status})`)
      const data = await res.json()
      if (data?.blob) {
        setBlobs(prev => prev.map(b => (b.id === blob.id ? data.blob : b)))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const copyMarkdown = async (blob: DocumentStoreBlob) => {
    const markdown = `![${blob.description || blob.originalFileName}](${blob.relativePath})`
    try {
      await navigator.clipboard.writeText(markdown)
    } catch {
      // Swallow — browsers without clipboard access just won't copy.
    }
  }

  return (
    <div className="mt-8 border-t qt-border-default/60 pt-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Blobs</h2>
          <p className="text-xs qt-text-secondary mt-1">
            Images attached to <strong>{mountPointName}</strong> — stored encrypted, transcoded to WebP, and referenceable from Markdown.
          </p>
        </div>
        <label className="qt-button-primary inline-flex items-center gap-1.5 cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
            disabled={uploading}
          />
          {uploading ? 'Uploading…' : 'Upload Blob'}
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-xl qt-border-destructive/30 qt-bg-destructive/10 border p-3">
          <p className="text-sm qt-text-destructive">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm qt-text-secondary">Loading blobs…</p>
      ) : blobs.length === 0 ? (
        <p className="text-sm qt-text-secondary italic">No blobs yet. Drop an image above to add one.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {blobs.map(blob => (
            <BlobCard
              key={`${blob.id}:${blob.updatedAt}`}
              blob={blob}
              mountPointId={mountPointId}
              onDelete={() => handleDelete(blob)}
              onCopy={() => copyMarkdown(blob)}
              onSaveDescription={(description: string) => handleDescriptionSave(blob, description)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface BlobCardProps {
  blob: DocumentStoreBlob
  mountPointId: string
  onDelete: () => void
  onCopy: () => void
  onSaveDescription: (description: string) => void
}

function BlobCard({ blob, mountPointId, onDelete, onCopy, onSaveDescription }: BlobCardProps) {
  // Reset local edit state whenever a different blob version comes in by keying
  // the description off of blob.updatedAt. Using a key avoids the lint warning
  // about setState inside useEffect and keeps the edit buffer in sync with the
  // latest server-persisted description.
  const [description, setDescription] = useState(blob.description)
  const [dirty, setDirty] = useState(false)

  const href = `/api/v1/mount-points/${mountPointId}/blobs/${blob.relativePath.split('/').map(encodeURIComponent).join('/')}`

  const isImage = blob.storedMimeType.startsWith('image/')

  return (
    <div className="rounded-xl qt-bg-card border qt-border-default p-3 flex flex-col gap-2">
      {isImage ? (
        <img src={href} alt={blob.description || blob.originalFileName} className="w-full h-32 object-cover rounded" />
      ) : (
        <div className="w-full h-32 flex items-center justify-center rounded qt-bg-muted text-xs qt-text-secondary">
          {blob.storedMimeType}
        </div>
      )}
      <div className="font-mono text-xs break-all">{blob.relativePath}</div>
      <div className="text-xs qt-text-secondary">
        {formatBytes(blob.sizeBytes)} · {blob.storedMimeType}
        {blob.originalMimeType !== blob.storedMimeType && ` (from ${blob.originalMimeType})`}
      </div>
      <textarea
        className="qt-input text-xs"
        value={description}
        placeholder="Description / transcript (searchable)"
        rows={2}
        onChange={e => {
          setDescription(e.target.value)
          setDirty(e.target.value !== blob.description)
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCopy} className="qt-button-secondary text-xs">
          Copy Markdown
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => { onSaveDescription(description); setDirty(false) }}
            className="qt-button-primary text-xs"
          >
            Save
          </button>
        )}
        <button type="button" onClick={onDelete} className="qt-button-destructive text-xs ml-auto">
          Delete
        </button>
      </div>
    </div>
  )
}
