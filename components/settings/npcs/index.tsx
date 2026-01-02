'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import Avatar from '@/components/ui/Avatar'

interface NPC {
  id: string
  name: string
  title?: string | null
  description?: string | null
  avatarUrl?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
  createdAt: string
  updatedAt: string
  _count?: {
    chats: number
  }
}

export default function NPCsTab() {
  const [npcs, setNpcs] = useState<NPC[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const router = useRouter()

  const fetchNPCs = useCallback(async () => {
    setLoading(true)
    setError(null)

    const maxAttempts = 3
    let lastError: string | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch('/api/characters?npc=true')
        if (!res.ok) {
          throw new Error('Failed to fetch NPCs')
        }
        const data = await res.json()
        setNpcs(data.characters || [])
        clientLogger.debug('NPCs fetched successfully', { count: data.characters?.length || 0 })
        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'An error occurred'
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt))
          continue
        }
      }
    }

    if (lastError) {
      setError(lastError)
      clientLogger.error('Error fetching NPCs', { error: lastError })
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchNPCs()
  }, [fetchNPCs])

  const handleEdit = useCallback((npcId: string) => {
    clientLogger.debug('Navigating to NPC view page', { npcId })
    router.push(`/characters/${npcId}/view`)
  }, [router])

  const handleDelete = useCallback(async (npcId: string, npcName: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${npcName}"? This action cannot be undone.`
    )

    if (!confirmed) return

    try {
      setDeletingId(npcId)
      clientLogger.debug('Deleting NPC', { npcId, npcName })

      const res = await fetch(`/api/characters/${npcId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete NPC')
      }

      showSuccessToast(`"${npcName}" deleted successfully`)
      clientLogger.info('NPC deleted successfully', { npcId, npcName })

      // Refresh the list
      await fetchNPCs()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete NPC'
      showErrorToast(errorMessage)
      clientLogger.error('Error deleting NPC', { npcId, error: errorMessage })
    } finally {
      setDeletingId(null)
    }
  }, [fetchNPCs])

  const handleConvertToCharacter = useCallback(async (npcId: string, npcName: string) => {
    const confirmed = window.confirm(
      `Convert "${npcName}" to a regular character? This will remove it from the NPCs list.`
    )

    if (!confirmed) return

    try {
      setConvertingId(npcId)
      clientLogger.debug('Converting NPC to character', { npcId, npcName })

      const res = await fetch(`/api/characters/${npcId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npc: false }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to convert NPC')
      }

      showSuccessToast(`"${npcName}" converted to character`)
      clientLogger.info('NPC converted to character successfully', { npcId, npcName })

      // Refresh the list
      await fetchNPCs()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to convert NPC'
      showErrorToast(errorMessage)
      clientLogger.error('Error converting NPC', { npcId, error: errorMessage })
    } finally {
      setConvertingId(null)
    }
  }, [fetchNPCs])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading NPCs...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Non-Player Characters (NPCs)</h2>
        <p className="text-muted-foreground">
          Manage NPCs that have been created when adding characters to chats.
          NPCs can be converted to regular characters or deleted.
        </p>
      </div>

      {npcs.length === 0 ? (
        <div className="qt-text-small border border-dashed border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">
            No NPCs yet. NPCs can be created when adding characters to a chat.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {npcs.map((npc) => {
            const isDeleting = deletingId === npc.id
            const isConverting = convertingId === npc.id
            const isDisabled = isDeleting || isConverting

            return (
              <div
                key={npc.id}
                className="border border-border rounded-lg p-4 bg-card shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex gap-3 mb-3">
                  <Avatar
                    name={npc.name}
                    title={npc.title}
                    src={npc.defaultImage ? { defaultImage: npc.defaultImage } : npc.avatarUrl}
                    size="md"
                    styleOverride="RECTANGULAR"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="qt-text-primary font-semibold truncate">
                      {npc.name}
                    </h3>
                    {npc.title && (
                      <p className="qt-text-xs text-muted-foreground italic truncate">
                        {npc.title}
                      </p>
                    )}
                    {npc._count && npc._count.chats > 0 && (
                      <p className="qt-text-xs text-muted-foreground mt-1">
                        {npc._count.chats} {npc._count.chats === 1 ? 'chat' : 'chats'}
                      </p>
                    )}
                  </div>
                </div>

                {npc.description && (
                  <p className="qt-text-small text-muted-foreground line-clamp-2 mb-3">
                    {npc.description}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(npc.id)}
                    disabled={isDisabled}
                    className="w-full px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => handleConvertToCharacter(npc.id, npc.name)}
                    disabled={isDisabled}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background hover:bg-accent text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isConverting ? 'Converting...' : 'Convert to Character'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(npc.id, npc.name)}
                    disabled={isDisabled}
                    className="w-full px-3 py-2 text-sm rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
