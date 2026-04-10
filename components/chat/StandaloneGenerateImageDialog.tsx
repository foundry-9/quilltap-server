'use client'

import { useState, useRef } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { useEntitySearch } from './useEntitySearch'
import { EntitySearchDropdown } from './EntitySearchDropdown'

interface Participant {
  id: string
  type: 'CHARACTER'
  controlledBy?: 'llm' | 'user'
  character?: {
    id: string
    name: string
  } | null
}

interface StandaloneGenerateImageDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  participants: Participant[]
  onImagesGenerated?: (images: Array<{ id: string; filename: string; filepath: string; mimeType: string }>, prompt: string) => void
}

export default function StandaloneGenerateImageDialog({
  isOpen,
  onClose,
  chatId,
  participants,
  onImagesGenerated,
}: StandaloneGenerateImageDialogProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [imageCount, setImageCount] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const entitySearch = useEntitySearch(isOpen)

  const insertPlaceholder = (text: string) => {
    const textarea = promptRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = prompt.substring(0, start)
    const after = prompt.substring(end)

    const placeholder = `{{${text}}}`
    const newPrompt = before + placeholder + after
    setPrompt(newPrompt)

    // Set cursor position after the inserted placeholder
    setTimeout(() => {
      textarea.focus()
      const newPosition = start + placeholder.length
      textarea.setSelectionRange(newPosition, newPosition)
    }, 0)
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showErrorToast('Please enter a prompt')
      return
    }

    if (!selectedProfileId) {
      showErrorToast('Please select an image profile')
      return
    }

    setIsGenerating(true)

    try {
      const response = await fetch(`/api/v1/image-profiles/${selectedProfileId}?action=generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          chatId,
          count: imageCount,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.message || errorData.error || 'Failed to generate image'
        showErrorToast(errorMessage)
        return
      }

      const data = await response.json()

      if (data.success && data.data && data.data.length > 0) {
        showSuccessToast(`Generated ${data.data.length} image(s) - attached to next message`)
        // Use the expanded prompt from the API response, or fall back to user's prompt
        const finalPrompt = data.expandedPrompt || prompt
        setPrompt('')
        onImagesGenerated?.(data.data.map((img: any) => ({
          id: img.id,
          filename: img.filename,
          filepath: img.filepath,
          mimeType: img.mimeType,
        })), finalPrompt)
        onClose()
      } else {
        showErrorToast('No images generated')
      }
    } catch (error) {
      // Only log unexpected errors, not API errors
      if (error instanceof Error) {
        showErrorToast(error.message)
      } else {
        console.error('Unexpected error during image generation', { error: String(error) })
        showErrorToast('Failed to generate image')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  if (!isOpen) return null

  // Get current chat participants for quick buttons
  const characterParticipants = participants.filter(p => p.type === 'CHARACTER' && p.controlledBy !== 'user')
  const userCharacterParticipant = participants.find(p => p.controlledBy === 'user')

  return (
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="qt-dialog-header flex items-center justify-between">
          <h2 className="qt-dialog-title">
            Generate Image
          </h2>
          <button
            onClick={onClose}
            className="qt-button qt-button-ghost p-2"
            disabled={isGenerating}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="qt-dialog-body flex-1 overflow-y-auto">
          {/* Image Profile Picker */}
          <div className="mb-4">
            <label className="block text-sm qt-text-primary mb-2">
              Image Profile
            </label>
            <ImageProfilePicker
              value={selectedProfileId}
              onChange={setSelectedProfileId}
              disabled={isGenerating}
            />
          </div>

          <div className="flex gap-4">
            {/* Left side - Quick buttons */}
            <div className="w-48 flex-shrink-0 space-y-2">
              <div className="qt-text-small font-medium mb-3">
                Quick Insert
              </div>

              {/* Me button */}
              {userCharacterParticipant?.character && (
                <button
                  onClick={() => insertPlaceholder('me')}
                  className="w-full px-3 py-2 text-left text-sm qt-bg-primary/10 hover:qt-bg-primary/20 text-primary rounded border qt-border-primary/30 transition-colors"
                  disabled={isGenerating}
                >
                  <div className="font-medium">{userCharacterParticipant.character.name}</div>
                  <div className="text-xs opacity-75">{'{{me}}'}</div>
                </button>
              )}

              {/* Character buttons */}
              {characterParticipants.map(p => (
                p.character && (
                  <button
                    key={p.id}
                    onClick={() => insertPlaceholder(p.character!.name)}
                    className="w-full px-3 py-2 text-left text-sm bg-accent hover:bg-accent/80 text-accent-foreground rounded border border-accent transition-colors"
                    disabled={isGenerating}
                  >
                    <div className="font-medium truncate">{p.character.name}</div>
                    <div className="text-xs opacity-75">{`{{${p.character.name}}}`}</div>
                  </button>
                )
              ))}

              {/* Search dropdown */}
              <EntitySearchDropdown
                isDropdownOpen={entitySearch.isDropdownOpen}
                setIsDropdownOpen={entitySearch.setIsDropdownOpen}
                searchTerm={entitySearch.searchTerm}
                setSearchTerm={entitySearch.setSearchTerm}
                filteredEntities={entitySearch.filteredEntities}
                onEntitySelect={(entity) => entitySearch.handleEntitySelect(entity, insertPlaceholder)}
                dropdownRef={entitySearch.dropdownRef}
                disabled={isGenerating}
              />
            </div>

            {/* Right side - Prompt input */}
            <div className="flex-1">
              <label htmlFor="standalone-image-prompt" className="block text-sm qt-text-primary mb-2">
                Image Prompt
              </label>
              <textarea
                id="standalone-image-prompt"
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate. Use {{placeholders}} for characters and personas.&#10;&#10;Examples:&#10;- {{me}} in a forest clearing at sunset&#10;- {{Alice}} and {{me}} having coffee together&#10;- A serene mountain landscape"
                className="qt-textarea h-64"
                disabled={isGenerating}
              />
              <div className="mt-2 qt-text-xs">
                Click buttons on the left or type {'{{name}}'} to insert placeholders
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label htmlFor="image-count" className="text-sm qt-text-secondary">
              Images:
            </label>
            <select
              id="image-count"
              value={imageCount}
              onChange={(e) => setImageCount(Number(e.target.value))}
              className="qt-input w-16"
              disabled={isGenerating}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="qt-button qt-button-secondary"
              disabled={isGenerating}
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={!selectedProfileId || !prompt.trim() || isGenerating}
              className="qt-button qt-button-primary"
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Generate Image
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
