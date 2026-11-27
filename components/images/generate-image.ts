'use client'

/**
 * The pieces every "type a prompt, get a picture" surface shares: the one
 * generate call through an image profile, and the caret-aware placeholder
 * insert behind the `{{me}}` / `{{Name}}` buttons.
 *
 * Callers keep their own counts, toasts and layout; the request (trimmed
 * prompt, the route, the error sentence) is decided here once.
 *
 * @module components/images/generate-image
 */

import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'

/** One picture as `POST /api/v1/image-profiles/{id}?action=generate` returns it. */
export interface GeneratedImageFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  generationPrompt?: string
  generationRevisedPrompt?: string
}

interface GenerateImageResponse {
  success?: boolean
  data?: GeneratedImageFile[]
  /** The prompt after `{{placeholder}}` expansion, when the server expanded one. */
  expandedPrompt?: string
}

export interface GenerateImageInput {
  prompt: string
  count: number
  /** The conversation whose cast `{{me}}` / `{{char}}` resolve against. */
  chatId?: string
}

/**
 * Generate through one image profile. The prompt is trimmed here, so every
 * surface sends the same text for the same typing. Failures reject with an
 * `ApiFetchError`; callers read its sentence with `apiErrorMessage`.
 */
export function useGenerateImage(profileId: string | null) {
  return useMutation({
    mutationFn: ({ prompt, count, chatId }: GenerateImageInput) =>
      apiFetch<GenerateImageResponse>(`/api/v1/image-profiles/${profileId}?action=generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), count, ...(chatId ? { chatId } : {}) }),
      }),
  })
}

/**
 * Insert `{{text}}` at the textarea's caret (replacing any selection), put the
 * caret after it, and return the new value for the caller's state.
 */
export function insertAtCursor(textarea: HTMLTextAreaElement, text: string): string {
  const value = textarea.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const placeholder = `{{${text}}}`
  const next = value.substring(0, start) + placeholder + value.substring(end)

  // After React has written the new value back into the textarea.
  setTimeout(() => {
    textarea.focus()
    const caret = start + placeholder.length
    textarea.setSelectionRange(caret, caret)
  }, 0)

  return next
}
