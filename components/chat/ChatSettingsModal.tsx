'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

interface ImageProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  modelName: string
}

interface ApiKey {
  id: string
  label: string
  provider: string
}

interface ChatSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  imageProfileId?: string | null
  avatarGenerationEnabled?: boolean | null
  alertCharactersOfLanternImages?: boolean | null
  onSuccess?: () => void
}

export default function ChatSettingsModal({
  isOpen,
  onClose,
  chatId,
  imageProfileId: initialImageProfileId,
  avatarGenerationEnabled: initialAvatarGenerationEnabled,
  alertCharactersOfLanternImages: initialAlertCharactersOfLanternImages,
  onSuccess,
}: Readonly<ChatSettingsModalProps>) {
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(
    initialImageProfileId ?? null
  )
  const [avatarGenEnabled, setAvatarGenEnabled] = useState(initialAvatarGenerationEnabled ?? false)
  const [alertImages, setAlertImages] = useState<boolean | null>(initialAlertCharactersOfLanternImages ?? null)
  const [imageProfileSaving, setImageProfileSaving] = useState(false)
  const [avatarGenSaving, setAvatarGenSaving] = useState(false)
  const [alertImagesSaving, setAlertImagesSaving] = useState(false)

  // Sync local state when upstream props change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream <prop> changes (parent renders unconditionally)
    setSelectedImageProfileId(initialImageProfileId ?? null)
  }, [initialImageProfileId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream <prop> changes (parent renders unconditionally)
    setAvatarGenEnabled(initialAvatarGenerationEnabled ?? false)
  }, [initialAvatarGenerationEnabled])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream <prop> changes (parent renders unconditionally)
    setAlertImages(initialAlertCharactersOfLanternImages ?? null)
  }, [initialAlertCharactersOfLanternImages])

  const { data: imageProfilesData, isLoading: profilesLoading } = useSWR<{ profiles: ImageProfile[] }>(
    isOpen ? '/api/v1/image-profiles' : null
  )
  const { data: apiKeysData } = useSWR<{ apiKeys: ApiKey[] }>(
    isOpen ? '/api/v1/api-keys' : null
  )

  const imageProfiles = imageProfilesData?.profiles || []
  const apiKeys = apiKeysData?.apiKeys || []
  const dataLoading = profilesLoading

  // Disable click-outside detection while saving to prevent native select dropdown clicks
  // from closing the modal (browser renders select options in a separate layer)
  const isSaving = dataLoading || imageProfileSaving || avatarGenSaving || alertImagesSaving

  const handleImageProfileChange = async (profileId: string | null) => {
    try {
      setImageProfileSaving(true)

      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageProfileId: profileId }),
      })

      if (!res.ok) {
        let errorMessage = 'Failed to update image profile'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }

      setSelectedImageProfileId(profileId)
      showSuccessToast('Image profile updated')
      onSuccess?.()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to update image profile', {
        chatId,
        profileId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to update image profile')
    } finally {
      setImageProfileSaving(false)
    }
  }

  const handleAlertImagesChange = async (value: boolean | null) => {
    try {
      setAlertImagesSaving(true)

      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertCharactersOfLanternImages: value }),
      })

      if (!res.ok) {
        let errorMessage = 'Failed to update Lantern image announcements'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }

      setAlertImages(value)
      showSuccessToast(
        value === null
          ? 'Lantern announcements will inherit from the project'
          : value
            ? 'Lantern images will be announced to characters'
            : 'Lantern images will stay silent for this chat'
      )
      onSuccess?.()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to update alertCharactersOfLanternImages', {
        chatId,
        value,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to update Lantern image announcements')
    } finally {
      setAlertImagesSaving(false)
    }
  }

  const handleAvatarGenToggle = async () => {
    try {
      setAvatarGenSaving(true)

      const res = await fetch(`/api/v1/chats/${chatId}?action=toggle-avatar-generation`, {
        method: 'POST',
      })

      if (!res.ok) {
        let errorMessage = 'Failed to toggle avatar generation'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }

      const data = await res.json()
      setAvatarGenEnabled(data.avatarGenerationEnabled ?? !avatarGenEnabled)
      showSuccessToast(data.avatarGenerationEnabled ? 'Avatar generation enabled' : 'Avatar generation disabled')
      onSuccess?.()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to toggle avatar generation', {
        chatId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to toggle avatar generation')
    } finally {
      setAvatarGenSaving(false)
    }
  }

  const footer = (
    <div className="flex justify-end">
      <button
        onClick={onClose}
        disabled={dataLoading}
        className="qt-button qt-button-secondary"
      >
        Close
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Chat Settings"
      footer={footer}
      closeOnClickOutside={!isSaving}
      closeOnEscape={!isSaving}
    >
      {/* Image Profile Section */}
      <div className="mb-6">
        <h3 className="qt-text-small font-medium mb-3">
          Image Generation
        </h3>
        <div className="qt-card">
          <label htmlFor="image-profile" className="qt-label mb-1">
            Image Provider
          </label>
          <select
            id="image-profile"
            value={selectedImageProfileId || ''}
            onChange={(e) => handleImageProfileChange(e.target.value || null)}
            disabled={imageProfileSaving || dataLoading}
            className="qt-select text-sm"
          >
            <option value="">None (image generation disabled)</option>
            {imageProfiles.map((profile) => {
              const hasKey = apiKeys.some(key => key.id === profile.apiKeyId)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider}){!hasKey && profile.apiKeyId ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
          <p className="qt-text-xs mt-2">
            Used for generating images in this chat.
            {imageProfileSaving && <span className="ml-2">Saving...</span>}
          </p>
        </div>
      </div>

      {/* Lantern Image Announcements */}
      <div className="mb-6">
        <h3 className="qt-text-small font-medium mb-3">
          Lantern Image Announcements
        </h3>
        <div className="qt-card">
          <label htmlFor="alert-images" className="qt-label mb-1">
            Announce generated images to characters
          </label>
          <select
            id="alert-images"
            value={alertImages === null || alertImages === undefined ? 'inherit' : alertImages ? 'enabled' : 'disabled'}
            onChange={(e) => {
              const v = e.target.value
              handleAlertImagesChange(v === 'inherit' ? null : v === 'enabled')
            }}
            disabled={alertImagesSaving || dataLoading}
            className="qt-select text-sm"
          >
            <option value="inherit">Inherit from project</option>
            <option value="enabled">Announce to characters</option>
            <option value="disabled">Keep silent</option>
          </select>
          <p className="qt-text-xs mt-2">
            When enabled, each generated background, avatar, or character-requested picture drops an announcement into the chat so every character sees it on their next turn.
            {alertImagesSaving && <span className="ml-2">Saving...</span>}
          </p>
        </div>
      </div>

      {/* Avatar Generation Section */}
      <div className="mb-6">
        <h3 className="qt-text-small font-medium mb-3">
          Avatar Generation
        </h3>
        <div className="qt-card">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={avatarGenEnabled}
              onChange={handleAvatarGenToggle}
              disabled={avatarGenSaving || dataLoading}
              className="qt-checkbox"
            />
            <span className="qt-label">Auto-generate character avatars</span>
          </label>
          <p className="qt-text-xs mt-2">
            Generate new character portraits when outfits change. Each generation uses an image API call.
            {avatarGenSaving && <span className="ml-2">Saving...</span>}
          </p>
        </div>
      </div>
    </BaseModal>
  )
}
