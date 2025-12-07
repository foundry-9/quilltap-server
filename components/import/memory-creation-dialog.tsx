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
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          Create Memories from Imported Chat
        </h3>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Create memories for the characters and personas based on this conversation.
          You can customize the memory content before creating.
        </p>

        <div className="space-y-4">
          {candidates.map((candidate, index) => (
            <div
              key={`${candidate.entityType}-${candidate.entityId}`}
              className={`border rounded-lg p-4 ${
                candidate.selected
                  ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-gray-200 dark:border-slate-700'
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
                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                        : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                    }`}>
                      {candidate.entityType === 'character' ? 'Character' : 'Persona'}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {candidate.entityName}
                    </span>
                  </div>

                  {candidate.selected && (
                    <textarea
                      value={candidate.suggestedContent}
                      onChange={(e) => updateContent(index, e.target.value)}
                      rows={3}
                      className="w-full rounded-md border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm px-3 py-2 border"
                      placeholder="Memory content..."
                    />
                  )}
                </div>
              </label>
            </div>
          ))}
        </div>

        {candidates.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No characters or personas found to create memories for
          </div>
        )}

        <div className="flex gap-2 justify-end mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleCreateMemories}
            disabled={creating || selectedCount === 0}
            className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
