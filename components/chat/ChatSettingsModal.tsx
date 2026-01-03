'use client'

import { useState, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  modelName: string
}

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

interface Character {
  id: string
  name: string
  title?: string | null
  systemPrompts?: Array<{
    id: string
    name: string
    isDefault: boolean
  }>
}

interface Persona {
  id: string
  name: string
  title?: string | null
}

interface Participant {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  displayOrder: number
  isActive: boolean
  systemPromptOverride?: string | null
  selectedSystemPromptId?: string | null
  controlledBy?: 'llm' | 'user'
  character?: Character | null
  persona?: Persona | null
  connectionProfile?: {
    id: string
    name: string
    provider?: string
    modelName?: string
  } | null
  imageProfile?: {
    id: string
    name: string
    provider?: string
    modelName?: string
  } | null
}

// Special constant for user impersonation selection
const USER_IMPERSONATION_VALUE = '__user_impersonation__'

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

interface Project {
  id: string
  name: string
  color?: string | null
}

interface ChatSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  participants: Participant[]
  roleplayTemplateId?: string | null
  projectId?: string | null
  onSuccess?: () => void
}

interface ParticipantEditorProps {
  participant: Participant
  connectionProfiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  apiKeys: ApiKey[]
  onUpdate: (participantId: string, updates: ParticipantUpdate) => void
  loading: boolean
}

interface ParticipantUpdate {
  connectionProfileId?: string
  imageProfileId?: string | null
  systemPromptOverride?: string | null
  selectedSystemPromptId?: string | null
  isActive?: boolean
  controlledBy?: 'llm' | 'user'
}

function ParticipantEditor({
  participant,
  connectionProfiles,
  imageProfiles,
  apiKeys,
  onUpdate,
  loading,
}: Readonly<ParticipantEditorProps>) {
  const isCharacter = participant.type === 'CHARACTER'
  const name = isCharacter
    ? participant.character?.name || 'Unknown Character'
    : participant.persona?.name || 'Unknown Persona'

  // Helper to check if a profile has a valid API key
  const profileHasApiKey = (apiKeyId?: string): boolean => {
    if (!apiKeyId) return false
    return apiKeys.some((key) => key.id === apiKeyId)
  }

  // Generate unique IDs for form controls
  const connectionProfileId = `connection-profile-${participant.id}`
  const imageProfileId = `image-profile-${participant.id}`
  const systemPromptSelectId = `system-prompt-select-${participant.id}`
  const systemPromptId = `system-prompt-${participant.id}`
  const activeCheckboxId = `active-${participant.id}`

  // Initialize with USER_IMPERSONATION_VALUE if user-controlled, otherwise profile ID
  const [selectedConnectionProfileId, setSelectedConnectionProfileId] = useState(
    participant.controlledBy === 'user'
      ? USER_IMPERSONATION_VALUE
      : (participant.connectionProfile?.id || '')
  )
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(
    participant.imageProfile?.id || ''
  )
  const [selectedSystemPromptId, setSelectedSystemPromptId] = useState(
    participant.selectedSystemPromptId || ''
  )
  const [systemPromptOverride, setSystemPromptOverride] = useState(
    participant.systemPromptOverride || ''
  )
  const [isActive, setIsActive] = useState(participant.isActive)

  const handleSave = () => {
    const updates: ParticipantUpdate = {}
    const isUserImpersonation = selectedConnectionProfileId === USER_IMPERSONATION_VALUE
    const wasUserControlled = participant.controlledBy === 'user'

    // Handle controlledBy and connectionProfileId changes
    if (isCharacter) {
      if (isUserImpersonation && !wasUserControlled) {
        // Switching TO user control
        updates.controlledBy = 'user'
      } else if (!isUserImpersonation && wasUserControlled) {
        // Switching FROM user control to LLM
        updates.controlledBy = 'llm'
        updates.connectionProfileId = selectedConnectionProfileId
      } else if (!isUserImpersonation && selectedConnectionProfileId !== participant.connectionProfile?.id) {
        // Just changing LLM profile
        updates.connectionProfileId = selectedConnectionProfileId
      }
    }

    if (selectedImageProfileId !== (participant.imageProfile?.id || '')) {
      updates.imageProfileId = selectedImageProfileId || null
    }

    if (isCharacter && participant.character?.systemPrompts) {
      if (selectedSystemPromptId !== (participant.selectedSystemPromptId || '')) {
        clientLogger.debug('System prompt selection changed', {
          participantId: participant.id,
          oldPromptId: participant.selectedSystemPromptId,
          newPromptId: selectedSystemPromptId || null,
        })
        updates.selectedSystemPromptId = selectedSystemPromptId || null
      }
    }

    if (systemPromptOverride !== (participant.systemPromptOverride || '')) {
      updates.systemPromptOverride = systemPromptOverride || null
    }

    if (isActive !== participant.isActive) {
      updates.isActive = isActive
    }

    if (Object.keys(updates).length > 0) {
      onUpdate(participant.id, updates)
    }
  }

  return (
    <div className="qt-card mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs rounded ${
            isCharacter
              ? 'qt-badge-info'
              : 'qt-badge-success'
          }`}>
            {isCharacter ? 'Character' : 'Persona'}
          </span>
          <h4 className="qt-text-primary">{name}</h4>
        </div>
        <label htmlFor={activeCheckboxId} className="flex items-center gap-2 qt-text-small">
          <input
            id={activeCheckboxId}
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-input"
          />
          Active
        </label>
      </div>

      {isCharacter && (
        <>
          <div className="mb-3">
            <label htmlFor={connectionProfileId} className="qt-label mb-1">
              Chat Provider
            </label>
            <select
              id={connectionProfileId}
              value={selectedConnectionProfileId}
              onChange={(e) => setSelectedConnectionProfileId(e.target.value)}
              disabled={loading}
              className="qt-select text-sm"
            >
              <option value="">Select a provider...</option>
              <option value={USER_IMPERSONATION_VALUE}>
                User (you will type for this character)
              </option>
              <optgroup label="LLM Backends">
                {connectionProfiles.map((profile) => {
                  const hasKey = profileHasApiKey(profile.apiKeyId)
                  return (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.modelName}){!hasKey ? ' ⚠️ No API Key' : ''}
                    </option>
                  )
                })}
              </optgroup>
            </select>
          </div>

          <div className="mb-3">
            <label htmlFor={imageProfileId} className="qt-label mb-1">
              Image Provider (Optional)
            </label>
            <select
              id={imageProfileId}
              value={selectedImageProfileId}
              onChange={(e) => setSelectedImageProfileId(e.target.value)}
              disabled={loading}
              className="qt-select text-sm"
            >
              <option value="">None</option>
              {imageProfiles.map((profile) => {
                const hasKey = profileHasApiKey(profile.apiKeyId)
                return (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider}){!hasKey ? ' ⚠️ No API Key' : ''}
                  </option>
                )
              })}
            </select>
          </div>

          {participant.character?.systemPrompts && participant.character.systemPrompts.length > 0 && (
            <div className="mb-3">
              <label htmlFor={systemPromptSelectId} className="qt-label mb-1">
                System Prompt
              </label>
              <select
                id={systemPromptSelectId}
                value={selectedSystemPromptId}
                onChange={(e) => setSelectedSystemPromptId(e.target.value)}
                disabled={loading}
                className="qt-select text-sm"
              >
                <option value="">Use Default</option>
                {participant.character.systemPrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}{prompt.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              <p className="qt-text-xs mt-1">
                Select which of the character&apos;s system prompts to use
              </p>
            </div>
          )}
        </>
      )}

      <div className="mb-3">
        <label htmlFor={systemPromptId} className="qt-label mb-1">
          System Prompt Override (Optional)
        </label>
        <textarea
          id={systemPromptId}
          value={systemPromptOverride}
          onChange={(e) => setSystemPromptOverride(e.target.value)}
          disabled={loading}
          placeholder="Custom scenario or context for this participant..."
          rows={2}
          className="qt-textarea text-sm"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={loading}
        className="qt-button qt-button-primary qt-button-sm"
      >
        Save Changes
      </button>
    </div>
  )
}

export default function ChatSettingsModal({
  isOpen,
  onClose,
  chatId,
  participants,
  roleplayTemplateId: initialRoleplayTemplateId,
  projectId: initialProjectId,
  onSuccess,
}: Readonly<ChatSettingsModalProps>) {
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [roleplayTemplates, setRoleplayTemplates] = useState<RoleplayTemplate[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedRoleplayTemplateId, setSelectedRoleplayTemplateId] = useState<string | null>(
    initialRoleplayTemplateId ?? null
  )
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectId ?? null
  )
  const [roleplayTemplateSaving, setRoleplayTemplateSaving] = useState(false)
  const [projectSaving, setProjectSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const { refreshSidebar } = useSidebarData()

  // Update local state when prop changes
  useEffect(() => {
    setSelectedRoleplayTemplateId(initialRoleplayTemplateId ?? null)
  }, [initialRoleplayTemplateId])

  useEffect(() => {
    setSelectedProjectId(initialProjectId ?? null)
  }, [initialProjectId])

  useEffect(() => {
    if (isOpen) {
      fetchProfiles()
      fetchRoleplayTemplates()
      fetchProjects()
    }
  }, [isOpen])

  // Disable click-outside detection while saving to prevent native select dropdown clicks
  // from closing the modal (browser renders select options in a separate layer)
  const isSaving = loading || roleplayTemplateSaving || projectSaving

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      const [profilesRes, imageProfilesRes, apiKeysRes] = await Promise.all([
        fetch('/api/profiles'),
        fetch('/api/image-profiles'),
        fetch('/api/keys'),
      ])

      if (profilesRes.ok) {
        const data = await profilesRes.json()
        setConnectionProfiles(data)
      }

      if (imageProfilesRes.ok) {
        const data = await imageProfilesRes.json()
        setImageProfiles(data)
      }

      if (apiKeysRes.ok) {
        const data = await apiKeysRes.json()
        setApiKeys(data)
        clientLogger.debug('Fetched API keys for profile validation', { count: data.length })
      }
    } catch (error) {
      clientLogger.error('Failed to fetch profiles', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to load profiles')
    } finally {
      setLoading(false)
    }
  }

  const fetchRoleplayTemplates = async () => {
    try {
      const res = await fetch('/api/roleplay-templates')
      if (res.ok) {
        const data = await res.json()
        setRoleplayTemplates(data)
      }
    } catch (error) {
      clientLogger.error('Failed to fetch roleplay templates', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
      }
    } catch (error) {
      clientLogger.error('Failed to fetch projects', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleProjectChange = async (projectId: string | null) => {
    try {
      setProjectSaving(true)
      clientLogger.debug('Updating chat project', { chatId, projectId })

      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { projectId } }),
      })

      if (!res.ok) {
        let errorMessage = 'Failed to update project'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          errorMessage = `HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errorMessage)
      }

      setSelectedProjectId(projectId)
      showSuccessToast(projectId ? 'Chat moved to project' : 'Chat removed from project')
      clientLogger.info('Project updated for chat', { chatId, projectId })

      // Refresh sidebar to update project chat counts and chat list
      refreshSidebar()

      onSuccess?.()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      clientLogger.error('Failed to update project', {
        chatId,
        projectId,
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to update project')
    } finally {
      setProjectSaving(false)
    }
  }

  const handleRoleplayTemplateChange = async (templateId: string | null) => {
    try {
      setRoleplayTemplateSaving(true)
      clientLogger.debug('Updating roleplay template', { chatId, templateId })

      const res = await fetch(`/api/chats/${chatId}`, {
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
      clientLogger.info('Roleplay template updated for chat', { chatId, templateId })
      onSuccess?.()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      clientLogger.error('Failed to update roleplay template', {
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

  const handleParticipantUpdate = async (participantId: string, updates: ParticipantUpdate) => {
    try {
      setLoading(true)
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateParticipant: {
            participantId,
            ...updates,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to update participant')
      }

      showSuccessToast('Participant settings updated')
      onSuccess?.()
    } catch (error) {
      clientLogger.error('Failed to update participant', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast(error instanceof Error ? error.message : 'Failed to update participant')
    } finally {
      setLoading(false)
    }
  }

  const sortedParticipants = [...participants].sort((a, b) => a.displayOrder - b.displayOrder)

  const footer = (
    <div className="flex justify-end">
      <button
        onClick={onClose}
        disabled={loading}
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
      {/* Project Section */}
      <div className="mb-6">
        <h3 className="qt-text-small font-medium mb-3">
          Project
        </h3>
        <div className="qt-card">
          <label htmlFor="chat-project" className="qt-label mb-1">
            Assign to Project
          </label>
          <select
            id="chat-project"
            value={selectedProjectId || ''}
            onChange={(e) => handleProjectChange(e.target.value || null)}
            disabled={projectSaving || loading}
            className="qt-select text-sm"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <p className="qt-text-xs mt-2">
            Move this chat to a project for better organization.
            {projectSaving && <span className="ml-2">Saving...</span>}
          </p>
        </div>
      </div>

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
            disabled={roleplayTemplateSaving || loading}
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

      <div className="mb-4">
        <h3 className="qt-text-small font-medium mb-3">
          Participants ({participants.length})
        </h3>

        {sortedParticipants.map((participant) => (
          <ParticipantEditor
            key={participant.id}
            participant={participant}
            connectionProfiles={connectionProfiles}
            imageProfiles={imageProfiles}
            apiKeys={apiKeys}
            onUpdate={handleParticipantUpdate}
            loading={loading}
          />
        ))}
      </div>
    </BaseModal>
  )
}
