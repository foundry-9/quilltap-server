'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useClickOutside } from '@/hooks/useClickOutside'

interface EntityOption {
  id: string
  name: string
  type: 'character'
}

interface Participant {
  id: string
  type: 'CHARACTER'
  controlledBy?: 'llm' | 'user'
  character?: {
    id: string
    name: string
  } | null
}

interface GenerateImageDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  participants: Participant[]
  imageProfileId?: string
  onImagesGenerated?: (images: Array<{ id: string; filename: string; filepath: string; mimeType: string }>, prompt: string) => void
}

export default function GenerateImageDialog({
  isOpen,
  onClose,
  chatId,
  participants,
  imageProfileId,
  onImagesGenerated,
}: GenerateImageDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: charactersData } = useSWR<{ characters: Array<{ id: string; name: string }> }>(
    isOpen ? '/api/v1/characters' : null
  )

  const allEntities: EntityOption[] = charactersData?.characters
    ? charactersData.characters
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: 'character' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    : []

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

  const handleEntitySelect = (entity: EntityOption) => {
    insertPlaceholder(entity.name)
    setIsDropdownOpen(false)
    setSearchTerm('')
  }

  const filteredEntities = allEntities.filter(e =>
    e.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showErrorToast('Please enter a prompt')
      return
    }

    if (!imageProfileId) {
      showErrorToast('No image profile configured for this chat. Please configure an image profile for one of the chat participants.')
      return
    }

    setIsGenerating(true)

    try {
      const response = await fetch(`/api/v1/image-profiles/${imageProfileId}?action=generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          chatId,
          count: 1,
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

  // Close dropdown when clicking outside
  useClickOutside(dropdownRef, () => setIsDropdownOpen(false), {
    enabled: isDropdownOpen,
  })

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
              <div className="relative pt-4" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-full px-3 py-2 text-sm text-foreground qt-bg-muted hover:qt-bg-muted/80 rounded border border-input transition-colors flex items-center justify-between"
                  disabled={isGenerating}
                >
                  <span>Other Characters...</span>
                  <svg className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border qt-border-default rounded-lg qt-shadow-lg max-h-64 overflow-hidden flex flex-col z-10">
                    <div className="p-2 border-b qt-border-default">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="qt-input"
                      />
                    </div>
                    <div className="overflow-y-auto">
                      {filteredEntities.map(entity => (
                        <button
                          key={entity.id}
                          onClick={() => handleEntitySelect(entity)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
                        >
                          <span className={`px-1.5 py-0.5 text-xs rounded ${
                            entity.type === 'character'
                              ? 'bg-accent text-accent-foreground'
                              : 'qt-bg-primary/20 text-primary'
                          }`}>
                            {entity.type === 'character' ? 'C' : 'P'}
                          </span>
                          <span className="text-foreground">{entity.name}</span>
                        </button>
                      ))}
                      {filteredEntities.length === 0 && (
                        <div className="px-3 py-4 qt-text-small text-center">
                          No matches found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right side - Prompt input */}
            <div className="flex-1">
              <label htmlFor="image-prompt" className="block text-sm qt-text-primary mb-2">
                Image Prompt
              </label>
              <textarea
                id="image-prompt"
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
          {!imageProfileId && (
            <p className="text-sm qt-text-warning">
              Configure an image profile in Chat Settings to generate images
            </p>
          )}
          <div className="flex gap-3 ml-auto">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || !imageProfileId}
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
