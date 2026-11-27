'use client'

import { useState, useRef } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { insertAtCursor, useGenerateImage } from '@/components/images/generate-image'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { useEntitySearch } from './useEntitySearch'
import { EntitySearchDropdown } from './EntitySearchDropdown'
import { Spinner } from '@/components/ui/Spinner'

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
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const entitySearch = useEntitySearch(isOpen)

  const generate = useGenerateImage(selectedProfileId)
  const isGenerating = generate.isPending

  const insertPlaceholder = (text: string) => {
    const textarea = promptRef.current
    if (!textarea) return
    setPrompt(insertAtCursor(textarea, text))
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

    try {
      const data = await generate.mutateAsync({ prompt, chatId, count: imageCount })

      if (data.success && data.data && data.data.length > 0) {
        showSuccessToast(`Generated ${data.data.length} image(s) - attached to next message`)
        // Use the expanded prompt from the API response, or fall back to user's prompt
        const finalPrompt = data.expandedPrompt || prompt
        setPrompt('')
        onImagesGenerated?.(data.data.map((img) => ({
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
      showErrorToast(apiErrorMessage(error, 'Failed to generate image'))
    }
  }

  if (!isOpen) return null

  // Get current chat participants for quick buttons
  const characterParticipants = participants.filter(p => p.type === 'CHARACTER' && p.controlledBy !== 'user')
  const userCharacterParticipant = participants.find(p => p.controlledBy === 'user')

  const footer = (
    <>
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
              <Spinner className="h-4 w-4" />
              Generating...
            </>
          ) : (
            <>
              <Icon name="image" className="w-4 h-4" />
              Generate Image
            </>
          )}
        </button>
      </div>
    </>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate Image"
      maxWidth="3xl"
      busy={isGenerating}
      closeOnClickOutside={false}
      footerClassName="qt-dialog-footer-default flex items-center justify-between"
      headerActions={
        <button
          aria-label="Close"
          onClick={onClose}
          className="qt-button qt-button-ghost p-2"
          disabled={isGenerating}
        >
          <Icon name="close" className="w-6 h-6" />
        </button>
      }
      footer={footer}
    >
      {/* Image Profile Picker */}
      <div className="mb-4">
        <label className="qt-label mb-2">
          Image Profile
        </label>
        <ImageProfilePicker
          value={selectedProfileId}
          onChange={setSelectedProfileId}
          preselectDefault
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
              className="w-full px-3 py-2 text-left text-sm qt-bg-primary/10 hover:qt-bg-primary/20 qt-text-brand rounded border qt-border-primary/30 transition-colors"
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
                className="w-full px-3 py-2 text-left text-sm qt-bg-accent hover:qt-bg-accent/80 qt-text-on-accent rounded border border-accent transition-colors"
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
          <label htmlFor="standalone-image-prompt" className="qt-label mb-2">
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
    </BaseModal>
  )
}
