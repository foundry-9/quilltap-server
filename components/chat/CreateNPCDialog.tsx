'use client'

/**
 * CreateNPCDialog Component
 * Ad-hoc NPC Feature - Phase 2
 *
 * Dialog for creating temporary NPCs directly from a chat.
 * Features:
 * - Simple creation form with essential fields
 * - Automatic addition to current chat
 * - Avatar upload support
 * - Connection profile selection
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface CreateNPCDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  onNPCCreated: (characterId: string) => void
}

export default function CreateNPCDialog({
  isOpen,
  onClose,
  chatId,
  onNPCCreated,
}: CreateNPCDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [physicalDescription, setPhysicalDescription] = useState('')
  const [scenario, setScenario] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [selectedConnectionProfileId, setSelectedConnectionProfileId] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load connection profiles when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadConnectionProfiles()
      // Focus name input after loading
      setTimeout(() => {
        nameInputRef.current?.focus()
      }, 100)
    } else {
      // Reset state when dialog closes
      setName('')
      setDescription('')
      setPhysicalDescription('')
      setScenario('')
      setSystemPrompt('')
      setSelectedConnectionProfileId(null)
      setAvatarFile(null)
    }
  }, [isOpen])

  // Handle escape key to close dialog
  useEffect(() => {
    if (!isOpen || isCreating) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isCreating, onClose])

  // Handle overlay click to close dialog
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // Only close if clicking directly on the overlay, not on the dialog content
    if (e.target === e.currentTarget && !isCreating) {
      onClose()
    }
  }, [isCreating, onClose])

  const loadConnectionProfiles = async () => {
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/connection-profiles')

      if (!response.ok) {
        throw new Error('Failed to load connection profiles')
      }

      const profilesData = await response.json()
      const loadedProfiles = profilesData.profiles || []

      setConnectionProfiles(loadedProfiles)

      // Auto-select first profile if available
      if (loadedProfiles.length > 0) {
        setSelectedConnectionProfileId(loadedProfiles[0].id)
      }
    } catch (error) {
      console.error('[CreateNPCDialog] Error loading connection profiles', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast('Failed to load connection profiles')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        showErrorToast('Please select an image file')
        return
      }
      setAvatarFile(file)
    }
  }

  const handleCreateNPC = async () => {
    // Validation
    if (!name.trim()) {
      showErrorToast('Please enter a name for the NPC')
      return
    }

    if (!description.trim()) {
      showErrorToast('Please enter a description for the NPC')
      return
    }

    if (!selectedConnectionProfileId) {
      showErrorToast('Please select a connection profile')
      return
    }

    setIsCreating(true)

    try {
      let uploadedImageId: string | null = null

      // Step 1: Upload avatar if provided
      if (avatarFile) {
        const formData = new FormData()
        formData.append('file', avatarFile)
        formData.append('referenceType', 'CHARACTER')
        formData.append('referenceId', 'pending')

        const uploadResponse = await fetch('/api/v1/images', {
          method: 'POST',
          body: formData,
        })

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json()
          throw new Error(errorData.error || 'Failed to upload avatar')
        }

        const uploadData = await uploadResponse.json()
        uploadedImageId = uploadData.id
      }

      // Step 2: Create character with npc flag
      const now = new Date().toISOString()
      const characterData: any = {
        npc: true,
        name: name.trim(),
        description: description.trim(),
        personality: description.trim(), // Copy description to personality
        defaultConnectionProfileId: selectedConnectionProfileId,
      }

      // Add optional fields
      if (scenario.trim()) {
        characterData.scenario = scenario.trim()
      }

      // Add system prompt if provided
      if (systemPrompt.trim()) {
        characterData.systemPrompts = [
          {
            id: crypto.randomUUID(),
            name: 'Default',
            content: systemPrompt.trim(),
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          },
        ]
      }

      // Add physical description if provided
      if (physicalDescription.trim()) {
        characterData.physicalDescriptions = [
          {
            id: crypto.randomUUID(),
            name: 'Default',
            fullDescription: physicalDescription.trim(),
            createdAt: now,
            updatedAt: now,
          },
        ]
      }

      const createResponse = await fetch('/api/v1/characters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(characterData),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(errorData.error || 'Failed to create NPC')
      }

      const createdCharacter = await createResponse.json()
      const characterId = createdCharacter.id

      // Step 3: Set avatar if it was uploaded
      if (uploadedImageId) {
        const avatarResponse = await fetch(`/api/v1/characters/${characterId}?action=avatar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageId: uploadedImageId,
          }),
        })

        if (!avatarResponse.ok) {
          // Log error but don't fail the whole operation
          console.error('[CreateNPCDialog] Failed to set avatar', {
            characterId,
            imageId: uploadedImageId,
          })
        }
      }

      showSuccessToast(`NPC "${name}" created successfully`)

      onNPCCreated(characterId)
      onClose()
    } catch (error) {
      console.error('[CreateNPCDialog] Error creating NPC', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to create NPC')
    } finally {
      setIsCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="qt-dialog-overlay p-4" onClick={handleOverlayClick}>
      <div
        className="qt-dialog max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="qt-dialog-header flex items-center justify-between">
          <h2 className="qt-dialog-title">
            Create Ad-hoc NPC
          </h2>
          <button
            onClick={onClose}
            className="qt-button qt-button-ghost p-2"
            disabled={isCreating}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="qt-dialog-body flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Name (required) */}
              <div>
                <label htmlFor="npc-name" className="block text-sm qt-text-primary mb-2">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id="npc-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter NPC name"
                  className="qt-input"
                  disabled={isCreating}
                />
              </div>

              {/* Description (required) */}
              <div>
                <label htmlFor="npc-description" className="block text-sm qt-text-primary mb-2">
                  Description <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="npc-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the NPC's personality and characteristics"
                  rows={4}
                  className="qt-textarea"
                  disabled={isCreating}
                />
                <p className="qt-text-xs mt-1">
                  This will be used as both description and personality
                </p>
              </div>

              {/* Physical Description (optional) */}
              <div>
                <label htmlFor="npc-physical" className="block text-sm qt-text-primary mb-2">
                  Physical Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  id="npc-physical"
                  value={physicalDescription}
                  onChange={(e) => setPhysicalDescription(e.target.value)}
                  placeholder="Describe the NPC's physical appearance"
                  rows={3}
                  className="qt-textarea"
                  disabled={isCreating}
                />
              </div>

              {/* Scenario (optional) */}
              <div>
                <label htmlFor="npc-scenario" className="block text-sm qt-text-primary mb-2">
                  Scenario <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  id="npc-scenario"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  placeholder="Describe the scenario or context for this NPC"
                  rows={3}
                  className="qt-textarea"
                  disabled={isCreating}
                />
              </div>

              {/* System Prompt (optional) */}
              <div>
                <label htmlFor="npc-system-prompt" className="block text-sm qt-text-primary mb-2">
                  System Prompt <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  id="npc-system-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Custom system prompt for this NPC"
                  rows={3}
                  className="qt-textarea"
                  disabled={isCreating}
                />
              </div>

              {/* Connection Profile (required) */}
              <div>
                <label htmlFor="npc-profile" className="block text-sm qt-text-primary mb-2">
                  Connection Profile <span className="text-destructive">*</span>
                </label>
                <select
                  id="npc-profile"
                  value={selectedConnectionProfileId || ''}
                  onChange={(e) => setSelectedConnectionProfileId(e.target.value || null)}
                  className="qt-select"
                  disabled={isCreating}
                >
                  <option value="">Select a connection profile...</option>
                  {connectionProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.provider}: {profile.modelName})
                    </option>
                  ))}
                </select>
                {connectionProfiles.length === 0 && (
                  <p className="text-sm text-warning mt-1">
                    No connection profiles available. Please create one in Settings.
                  </p>
                )}
              </div>

              {/* Avatar (optional) */}
              <div>
                <label className="block text-sm qt-text-primary mb-2">
                  Avatar <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCreating}
                    className="qt-button qt-button-secondary"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Choose Image
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarFileChange}
                    className="hidden"
                    disabled={isCreating}
                  />
                  {avatarFile ? (
                    <span className="text-sm text-success flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {avatarFile.name}
                    </span>
                  ) : (
                    <span className="qt-text-muted text-sm">No image selected</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateNPC}
            disabled={isCreating || !name.trim() || !description.trim() || !selectedConnectionProfileId}
            className="qt-button qt-button-primary"
          >
            {isCreating ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create NPC
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
