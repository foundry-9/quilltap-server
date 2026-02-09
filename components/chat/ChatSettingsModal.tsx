'use client'

import { useState, useEffect } from 'react'
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

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

interface ChatSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  roleplayTemplateId?: string | null
  imageProfileId?: string | null
  onSuccess?: () => void
}

export default function ChatSettingsModal({
  isOpen,
  onClose,
  chatId,
  roleplayTemplateId: initialRoleplayTemplateId,
  imageProfileId: initialImageProfileId,
  onSuccess,
}: Readonly<ChatSettingsModalProps>) {
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [roleplayTemplates, setRoleplayTemplates] = useState<RoleplayTemplate[]>([])
  const [selectedRoleplayTemplateId, setSelectedRoleplayTemplateId] = useState<string | null>(
    initialRoleplayTemplateId ?? null
  )
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(
    initialImageProfileId ?? null
  )
  const [roleplayTemplateSaving, setRoleplayTemplateSaving] = useState(false)
  const [imageProfileSaving, setImageProfileSaving] = useState(false)
  const [dataLoading, setDataLoading] = useState(false)

  // Update local state when prop changes
  useEffect(() => {
    setSelectedRoleplayTemplateId(initialRoleplayTemplateId ?? null)
  }, [initialRoleplayTemplateId])

  useEffect(() => {
    setSelectedImageProfileId(initialImageProfileId ?? null)
  }, [initialImageProfileId])

  useEffect(() => {
    if (isOpen) {
      fetchProfiles()
      fetchRoleplayTemplates()
    }
  }, [isOpen])

  // Disable click-outside detection while saving to prevent native select dropdown clicks
  // from closing the modal (browser renders select options in a separate layer)
  const isSaving = dataLoading || roleplayTemplateSaving || imageProfileSaving

  const fetchProfiles = async () => {
    try {
      setDataLoading(true)
      const [imageProfilesRes, apiKeysRes] = await Promise.all([
        fetch('/api/v1/image-profiles'),
        fetch('/api/v1/api-keys'),
      ])

      if (imageProfilesRes.ok) {
        const data = await imageProfilesRes.json()
        setImageProfiles(data.profiles || [])
      }

      if (apiKeysRes.ok) {
        const data = await apiKeysRes.json()
        setApiKeys(data.apiKeys || [])
      }
    } catch (error) {
      console.error('Failed to fetch profiles', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to load profiles')
    } finally {
      setDataLoading(false)
    }
  }

  const fetchRoleplayTemplates = async () => {
    try {
      const res = await fetch('/api/v1/roleplay-templates')
      if (res.ok) {
        const data = await res.json()
        setRoleplayTemplates(data)
      }
    } catch (error) {
      console.error('Failed to fetch roleplay templates', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleRoleplayTemplateChange = async (templateId: string | null) => {
    try {
      setRoleplayTemplateSaving(true)

      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleplayTemplateId: templateId }),
      })

      if (!res.ok) {
        let errorMessage = 'Failed to update roleplay template'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          // Response might not be JSON
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }

      setSelectedRoleplayTemplateId(templateId)
      showSuccessToast('Roleplay template updated')
      onSuccess?.()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to update roleplay template', {
        chatId,
        templateId,
        error: errorMessage,
        errorType: error?.constructor?.name || typeof error,
      })
      showErrorToast(errorMessage || 'Failed to update roleplay template')
    } finally {
      setRoleplayTemplateSaving(false)
    }
  }

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
      {/* Roleplay Template Section */}
      <div className="mb-6">
        <h3 className="qt-text-small font-medium mb-3">
          Roleplay Template
        </h3>
        <div className="qt-card">
          <label htmlFor="roleplay-template" className="qt-label mb-1">
            Formatting Style
          </label>
          <select
            id="roleplay-template"
            value={selectedRoleplayTemplateId || ''}
            onChange={(e) => handleRoleplayTemplateChange(e.target.value || null)}
            disabled={roleplayTemplateSaving || dataLoading}
            className="qt-select text-sm"
          >
            <option value="">None (no formatting template)</option>
            {roleplayTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
              </option>
            ))}
          </select>
          <p className="qt-text-xs mt-2">
            Controls how the AI formats dialogue, actions, and thoughts in this chat.
            {roleplayTemplateSaving && <span className="ml-2">Saving...</span>}
          </p>
        </div>
      </div>

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
    </BaseModal>
  )
}
