'use client'

import { useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

/**
 * Props for MemoryCreationDialog
 */
interface MemoryCreationDialogProps {
  chat: {
    id: string
    title: string
    participants: Array<{
      type: 'CHARACTER' | 'PERSONA'
      characterId?: string | null
      personaId?: string | null
      character?: { id: string; name: string } | null
      persona?: { id: string; name: string } | null
    }>
    messages: Array<{
      role: string
      content: string
      rawResponse?: { speakerName?: string } | null
    }>
    createdEntities?: {
      characters: Array<{ id: string; name: string }>
      personas: Array<{ id: string; name: string }>
    }
  }
  onClose: () => void
}

interface MemoryCandidate {
  entityType: 'character' | 'persona'
  entityId: string
  entityName: string
  selected: boolean
  suggestedContent: string
}

/**
 * Dialog for creating memories from an imported chat
 */
export function MemoryCreationDialog({ chat, onClose }: MemoryCreationDialogProps) {
  const [creating, setCreating] = useState(false)

  // Build memory candidates from participants
  const initialCandidates = useMemo(() => {
    const candidates: MemoryCandidate[] = []

    // Get unique character and persona names from participants
    const characterNames = new Map<string, { id: string; name: string }>()
    const personaNames = new Map<string, { id: string; name: string }>()

    for (const participant of chat.participants) {
      if (participant.type === 'CHARACTER' && participant.character) {
        characterNames.set(participant.character.id, {
          id: participant.character.id,
          name: participant.character.name,
        })
      } else if (participant.type === 'PERSONA' && participant.persona) {
        personaNames.set(participant.persona.id, {
          id: participant.persona.id,
          name: participant.persona.name,
        })
      }
    }

    // Get the persona name for relationship context
    const personaName = Array.from(personaNames.values())[0]?.name || 'the user'

    // Generate suggestions for characters
    for (const character of characterNames.values()) {
      // Count messages from this character
      const messageCount = chat.messages.filter(m =>
        m.rawResponse?.speakerName === character.name && m.role === 'ASSISTANT'
      ).length

      candidates.push({
        entityType: 'character',
        entityId: character.id,
        entityName: character.name,
        selected: true,
        suggestedContent: `Participated in a chat titled "${chat.title}" with ${personaName}. ${
          messageCount > 0 ? `Contributed ${messageCount} messages.` : ''
        } This chat was imported from SillyTavern.`,
      })
    }

    // Generate suggestions for personas
    for (const persona of personaNames.values()) {
      const characterNamesList = Array.from(characterNames.values()).map(c => c.name)
      const characterNamesStr = characterNamesList.length > 0
        ? characterNamesList.join(', ')
        : 'unknown characters'

      candidates.push({
        entityType: 'persona',
        entityId: persona.id,
        entityName: persona.name,
        selected: true,
        suggestedContent: `Had a conversation with ${characterNamesStr} in a chat titled "${chat.title}". This chat was imported from SillyTavern.`,
      })
    }

    return candidates
  }, [chat])

  const [candidates, setCandidates] = useState<MemoryCandidate[]>(initialCandidates)

  /**
   * Toggle candidate selection
   */
  const toggleCandidate = useCallback((index: number) => {
    setCandidates(prev => {
      const newCandidates = [...prev]
      newCandidates[index] = {
        ...newCandidates[index],
        selected: !newCandidates[index].selected,
      }
      return newCandidates
    })
  }, [])

  /**
   * Update candidate content
   */
  const updateContent = useCallback((index: number, content: string) => {
    setCandidates(prev => {
      const newCandidates = [...prev]
      newCandidates[index] = {
        ...newCandidates[index],
        suggestedContent: content,
      }
      return newCandidates
    })
  }, [])

  /**
   * Create memories for selected candidates
   */
  const handleCreateMemories = useCallback(async () => {
    const selectedCandidates = candidates.filter(c => c.selected)
    if (selectedCandidates.length === 0) {
      onClose()
      return
    }

    setCreating(true)

    let successCount = 0
    let failCount = 0

    for (const candidate of selectedCandidates) {
      try {
        // For characters, we use the memory API directly
        // For personas, we need to create a memory linked to the first character
        if (candidate.entityType === 'character') {
          const response = await fetch(`/api/characters/${candidate.entityId}/memories`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: candidate.suggestedContent,
              summary: `Imported chat: ${chat.title}`,
              keywords: ['imported', 'chat', chat.title.toLowerCase()],
              importance: 0.5,
              source: 'AUTO',
              chatId: chat.id,
            }),
          })

          if (!response.ok) {
            throw new Error(`Failed to create memory for ${candidate.entityName}`)
          }
          successCount++
        } else {
          // For personas, we create a memory on the first character with the persona ID
          const firstCharacter = candidates.find(c => c.entityType === 'character')
          if (firstCharacter) {
            const response = await fetch(`/api/characters/${firstCharacter.entityId}/memories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: candidate.suggestedContent,
                summary: `Imported chat: ${chat.title} (${candidate.entityName}'s perspective)`,
                keywords: ['imported', 'chat', chat.title.toLowerCase(), candidate.entityName.toLowerCase()],
                importance: 0.5,
                source: 'AUTO',
                chatId: chat.id,
                personaId: candidate.entityId,
              }),
            })

            if (!response.ok) {
              throw new Error(`Failed to create memory for ${candidate.entityName}`)
            }
            successCount++
          }
        }

        clientLogger.info('Created memory', {
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          entityName: candidate.entityName,
        })
      } catch (err) {
        failCount++
        clientLogger.error('Failed to create memory', {
          entityType: candidate.entityType,
          entityId: candidate.entityId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    setCreating(false)

    if (successCount > 0) {
      showSuccessToast(`Created ${successCount} memor${successCount === 1 ? 'y' : 'ies'}`)
    }
    if (failCount > 0) {
      showErrorToast(`Failed to create ${failCount} memor${failCount === 1 ? 'y' : 'ies'}`)
    }

    onClose()
  }, [candidates, chat.id, chat.title, onClose])

  const selectedCount = candidates.filter(c => c.selected).length

  return (
    <div className="qt-dialog-overlay !z-[60] p-4">
      <div className="qt-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="qt-dialog-header">
          <h3 className="qt-dialog-title">
            Create Memories from Imported Chat
          </h3>
          <p className="qt-dialog-description">
            Create memories for the characters and personas based on this conversation.
            You can customize the memory content before creating.
          </p>
        </div>

        <div className="qt-dialog-body">

        <div className="space-y-4">
          {candidates.map((candidate, index) => (
            <div
              key={`${candidate.entityType}-${candidate.entityId}`}
              className={`border rounded-lg p-4 ${
                candidate.selected
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border'
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={candidate.selected}
                  onChange={() => toggleCandidate(index)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      candidate.entityType === 'character'
                        ? 'qt-badge-primary'
                        : 'qt-badge-success'
                    }`}>
                      {candidate.entityType === 'character' ? 'Character' : 'Persona'}
                    </span>
                    <span className="font-medium text-foreground">
                      {candidate.entityName}
                    </span>
                  </div>

                  {candidate.selected && (
                    <textarea
                      value={candidate.suggestedContent}
                      onChange={(e) => updateContent(index, e.target.value)}
                      rows={3}
                      className="qt-textarea"
                      placeholder="Memory content..."
                    />
                  )}
                </div>
              </label>
            </div>
          ))}
        </div>

        {candidates.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No characters or personas found to create memories for
          </div>
        )}
        </div>

        <div className="qt-dialog-footer">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="qt-button qt-button-secondary"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleCreateMemories}
            disabled={creating || selectedCount === 0}
            className="qt-button qt-button-primary"
          >
            {creating ? (
              <>
                <span className="animate-spin inline-block mr-2">⌛</span>
                Creating...
              </>
            ) : (
              `Create ${selectedCount} Memor${selectedCount === 1 ? 'y' : 'ies'}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
