'use client'

/**
 * useConsoleAttachments
 *
 * The Brahma Console composer's pending attachments: files picked, pasted or
 * dropped are uploaded at once (`POST /api/v1/brahma-console?action=upload`,
 * stored under `Brahma/` in Quilltap General) and shown as chips; removing a
 * chip discards the upload (`?action=discard-upload`). Sending hands the
 * finished uploads' ids to the message and clears the list without discarding.
 *
 * @module components/brahma-console/hooks/useConsoleAttachments
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'

/** One attachment waiting in the composer. */
export interface PendingConsoleAttachment {
  /** Client key (stable across the upload). */
  key: string
  filename: string
  mimeType: string
  size: number
  /** Object URL for an image thumbnail while it uploads. */
  previewUrl: string | null
  status: 'uploading' | 'ready' | 'error'
  /** The stored attachment's id (mount-file link id) once uploaded. */
  id: string | null
  error: string | null
}

interface UploadResponse {
  id: string
  filename: string
  mimeType: string
  size: number
  path: string
  isImage: boolean
}

export interface ConsoleAttachmentsApi {
  pending: PendingConsoleAttachment[]
  /** Upload files (picked, pasted or dropped). */
  addFiles: (files: File[]) => void
  /** Remove a chip, discarding its upload. */
  remove: (key: string) => void
  /** True while any upload is in flight. */
  uploading: boolean
  /** Ids of the finished uploads, in order. */
  readyIds: string[]
  /** Clear after a send (the uploads now belong to the message). */
  clearAfterSend: () => void
}

let keyCounter = 0

async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file, file.name)
  return apiFetch<UploadResponse>('/api/v1/brahma-console?action=upload', { method: 'POST', body: form })
}

export function useConsoleAttachments(): ConsoleAttachmentsApi {
  const [pending, setPending] = useState<PendingConsoleAttachment[]>([])
  const pendingRef = useRef(pending)
  useEffect(() => { pendingRef.current = pending }, [pending])

  // Object URLs are released when their chip goes or the composer unmounts.
  useEffect(() => () => {
    for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
  }, [])

  const uploadMutation = useMutation({
    mutationFn: ({ file }: { key: string; file: File }) => uploadFile(file),
    onSuccess: (data, { key }) => {
      setPending(prev => prev.map(p => (p.key === key
        ? { ...p, status: 'ready', id: data.id, filename: data.filename, mimeType: data.mimeType, size: data.size }
        : p)))
    },
    onError: (error, { key }) => {
      setPending(prev => prev.map(p => (p.key === key
        ? { ...p, status: 'error', error: error instanceof Error ? error.message : 'Upload failed' }
        : p)))
    },
  })

  const discardMutation = useMutation({
    mutationFn: (fileId: string) => apiFetch<{ outcome: string }>('/api/v1/brahma-console?action=discard-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    }),
    onError: (error) => {
      console.error('Failed to discard Console upload', { error: error instanceof Error ? error.message : String(error) })
    },
  })

  const { mutate: upload } = uploadMutation
  const { mutate: discard } = discardMutation

  const addFiles = useCallback((files: File[]) => {
    const added: Array<{ key: string; file: File }> = []
    const chips: PendingConsoleAttachment[] = files.map(file => {
      const key = `att-${Date.now()}-${keyCounter++}`
      added.push({ key, file })
      return {
        key,
        filename: file.name || 'pasted image',
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        status: 'uploading',
        id: null,
        error: null,
      }
    })
    setPending(prev => [...prev, ...chips])
    for (const item of added) upload(item)
  }, [upload])

  const remove = useCallback((key: string) => {
    const chip = pendingRef.current.find(p => p.key === key)
    if (!chip) return
    if (chip.previewUrl) URL.revokeObjectURL(chip.previewUrl)
    if (chip.id) discard(chip.id)
    setPending(prev => prev.filter(p => p.key !== key))
  }, [discard])

  const clearAfterSend = useCallback(() => {
    for (const p of pendingRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
    setPending([])
  }, [])

  return {
    pending,
    addFiles,
    remove,
    uploading: pending.some(p => p.status === 'uploading'),
    readyIds: pending.filter(p => p.status === 'ready' && p.id).map(p => p.id as string),
    clearAfterSend,
  }
}
