'use client'

import { useState, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

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
  modelName: string
}

interface Character {
  id: string
  name: string
  title?: string | null
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

interface ChatSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  participants: Participant[]
  onSuccess?: () => void
}

interface ParticipantEditorProps {
  participant: Participant
  connectionProfiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  onUpdate: (participantId: string, updates: ParticipantUpdate) => void
  loading: boolean
}

interface ParticipantUpdate {
  connectionProfileId?: string
  imageProfileId?: string | null
  systemPromptOverride?: string | null
  isActive?: boolean
}

function ParticipantEditor({
  participant,
  connectionProfiles,
  imageProfiles,
  onUpdate,
  loading,
}: Readonly<ParticipantEditorProps>) {
  const isCharacter = participant.type === 'CHARACTER'
  const name = isCharacter
    ? participant.character?.name || 'Unknown Character'
    : participant.persona?.name || 'Unknown Persona'

  // Generate unique IDs for form controls
  const connectionProfileId = `connection-profile-${participant.id}`
  const imageProfileId = `image-profile-${participant.id}`
  const systemPromptId = `system-prompt-${participant.id}`
  const activeCheckboxId = `active-${participant.id}`

  const [selectedConnectionProfileId, setSelectedConnectionProfileId] = useState(
    participant.connectionProfile?.id || ''
  )
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(
    participant.imageProfile?.id || ''
  )
  const [systemPromptOverride, setSystemPromptOverride] = useState(
    participant.systemPromptOverride || ''
  )
  const [isActive, setIsActive] = useState(participant.isActive)

  const handleSave = () => {
    const updates: ParticipantUpdate = {}

    if (isCharacter && selectedConnectionProfileId !== participant.connectionProfile?.id) {
      updates.connectionProfileId = selectedConnectionProfileId
    }

    if (selectedImageProfileId !== (participant.imageProfile?.id || '')) {
      updates.imageProfileId = selectedImageProfileId || null
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
          <h4 className="font-medium text-foreground">{name}</h4>
        </div>
        <label htmlFor={activeCheckboxId} className="flex items-center gap-2 text-sm text-muted-foreground">
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
            <label htmlFor={connectionProfileId} className="block text-sm font-medium text-foreground mb-1">
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
              {connectionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.modelName})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label htmlFor={imageProfileId} className="block text-sm font-medium text-foreground mb-1">
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
              {imageProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider})
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="mb-3">
        <label htmlFor={systemPromptId} className="block text-sm font-medium text-foreground mb-1">
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
        className="qt-button-primary qt-button-sm"
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
  onSuccess,
}: Readonly<ChatSettingsModalProps>) {
  const modalRef = useRef<HTMLDivElement>(null)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchProfiles()
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      const [profilesRes, imageProfilesRes] = await Promise.all([
        fetch('/api/profiles'),
        fetch('/api/image-profiles'),
      ])

      if (profilesRes.ok) {
        const data = await profilesRes.json()
        setConnectionProfiles(data)
      }

      if (imageProfilesRes.ok) {
        const data = await imageProfilesRes.json()
        setImageProfiles(data)
      }
    } catch (error) {
      clientLogger.error('Failed to fetch profiles', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to load profiles')
    } finally {
      setLoading(false)
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

  if (!isOpen) return null

  const sortedParticipants = [...participants].sort((a, b) => a.displayOrder - b.displayOrder)

  return (
    <div className="qt-dialog-overlay">
      <div
        ref={modalRef}
        className="qt-dialog max-w-lg max-h-[80vh] flex flex-col"
      >
        <div className="qt-dialog-header">
          <h2 className="qt-dialog-title">Chat Settings</h2>
        </div>
        <div className="qt-dialog-body flex-1 overflow-y-auto">

        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Participants ({participants.length})
          </h3>

          {sortedParticipants.map((participant) => (
            <ParticipantEditor
              key={participant.id}
              participant={participant}
              connectionProfiles={connectionProfiles}
              imageProfiles={imageProfiles}
              onUpdate={handleParticipantUpdate}
              loading={loading}
            />
          ))}
        </div>
        </div>

        <div className="qt-dialog-footer flex justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="qt-button-secondary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
