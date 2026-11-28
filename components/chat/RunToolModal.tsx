'use client'

/**
 * Run Tool Modal
 *
 * Two-phase modal for user-initiated tool execution:
 * Phase 1: Tool selection from available tools list
 * Phase 2: Parameter form + execute button
 */

import { useState, useEffect, useCallback, useMemo, useId, useRef, useLayoutEffect } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import JsonSchemaForm from '@/components/chat/JsonSchemaForm'
import { useQueryClient } from '@tanstack/react-query'
import { showErrorToast } from '@/lib/toast'
import { apiFetch, apiErrorMessage, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { runBuiltInTool, cleanArgs } from '@/components/chat/run-tool-request'
import type { AvailableTool } from '@/app/api/v1/tools/route'
import type { Participant } from '@/app/salon/[id]/types'
import { Spinner } from '@/components/ui/Spinner'

interface RunToolModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Chat participants for character context selection */
  participants: Participant[]
  /** Called after successful tool execution so the chat can refresh */
  onToolExecuted: () => void
  /**
   * Open straight onto this tool's form (the composer's `/<tool id>` command).
   * Re-applied on every open — the nonce changes with each request, so picking
   * the same command twice in a row re-selects.
   */
  initialTool?: { toolId: string; nonce: number } | null
}

/** Category display info */
const CATEGORY_INFO: Record<string, { label: string; icon: string }> = {
  media: { label: 'Media', icon: '🎨' },
  memory: { label: 'Memory', icon: '🧠' },
  search: { label: 'Search', icon: '🔍' },
  project: { label: 'Project', icon: '📋' },
  files: { label: 'Files', icon: '📁' },
  help: { label: 'Help', icon: '📖' },
  utility: { label: 'Utility', icon: '🔧' },
  pascal: { label: "Pascal's Custom Tools", icon: '🎲' },
  shell: { label: 'Shell', icon: '💻' },
  plugin: { label: 'Plugin', icon: '🔌' },
}

export default function RunToolModal({
  isOpen,
  onClose,
  chatId,
  participants,
  onToolExecuted,
  initialTool = null,
}: RunToolModalProps) {
  const id = useId()
  const queryClient = useQueryClient()
  const [tools, setTools] = useState<AvailableTool[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTool, setSelectedTool] = useState<AvailableTool | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formValid, setFormValid] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [isPrivate, setIsPrivate] = useState(false)

  // Active character participants for the character selector
  const activeCharacters = useMemo(() =>
    participants.filter(p => p.type === 'CHARACTER' && p.isActive && !p.removedAt),
    [participants]
  )

  // Stable identifier for the default character (avoids array ref in useEffect deps).
  // The enriched participant doesn't expose a top-level characterId, only `character.id`.
  const defaultCharacterId = activeCharacters[0]?.character?.id || null
  // Read through a ref so a roster change while open never re-runs the reset (#291)
  const defaultCharacterIdRef = useRef(defaultCharacterId)
  useLayoutEffect(() => {
    defaultCharacterIdRef.current = defaultCharacterId
  }, [defaultCharacterId])
  const activeCharacterIds = useMemo(
    () => activeCharacters.map(p => p.character?.id).filter((v): v is string => Boolean(v)),
    [activeCharacters]
  )

  const handleSelectTool = useCallback((tool: AvailableTool) => {
    if (tool.available === false) return
    setSelectedTool(tool)
    // Pre-populate defaults from schema
    const defaults: Record<string, unknown> = {}
    if (tool.parameters && typeof tool.parameters === 'object') {
      const params = tool.parameters as { properties?: Record<string, { default?: unknown }> }
      if (params.properties) {
        for (const [key, prop] of Object.entries(params.properties)) {
          if (prop.default !== undefined) {
            defaults[key] = prop.default
          }
        }
      }
    }
    setFormValues(defaults)
    setFormValid(false)
  }, [])

  const requestedToolId = initialTool?.toolId ?? null
  const requestNonce = initialTool?.nonce ?? 0

  // Fetch tools when modal opens and reset form state
  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open + data fetch; parent renders unconditionally
    setLoading(true)
    setSelectedTool(null)
    setSearchQuery('')
    setFormValues({})
    setSelectedCharacterId(defaultCharacterIdRef.current)
    setIsPrivate(false)

    // Fresh on every open (staleTime 0), through the same cache entry the
    // composer's `/` menu reads.
    queryClient
      .fetchQuery({
        queryKey: queryKeys.tools.byChat(chatId),
        queryFn: ({ signal }) =>
          apiFetch<{ tools?: AvailableTool[] }>(`/api/v1/tools?chatId=${chatId}&includeSchemas=true`, { signal }),
        staleTime: 0,
      })
      .then(data => {
        if (data.tools) {
          // Filter to only user-invocable tools
          const invocable = data.tools.filter(t => t.userInvocable !== false)
          setTools(invocable)
          if (requestedToolId) {
            const requested = invocable.find(t => t.id === requestedToolId)
            if (!requested) {
              showErrorToast(`No tool named "${requestedToolId}" is available in this chat`)
            } else if (requested.available === false) {
              showErrorToast(requested.unavailableReason || `"${requested.name}" is not available in this chat`)
            } else {
              handleSelectTool(requested)
            }
          }
        }
      })
      .catch(err => {
        // A refusal that answered in JSON has always left the list as it was,
        // without a toast; only an unreadable or unreachable answer says so.
        if (err instanceof ApiFetchError && err.info !== undefined) return
        console.error('Failed to load tools:', err)
        showErrorToast('Failed to load available tools')
      })
      .finally(() => setLoading(false))
  }, [isOpen, chatId, requestedToolId, requestNonce, handleSelectTool, queryClient])

  // Keep the speaker valid as the roster changes: fill it when unset, or when
  // the chosen character is no longer active. A still-active pick is left alone.
  useEffect(() => {
    if (!isOpen) return
     
    setSelectedCharacterId(prev =>
      prev && activeCharacterIds.includes(prev) ? prev : defaultCharacterIdRef.current
    )
  }, [isOpen, activeCharacterIds])

  const handleBack = useCallback(() => {
    setSelectedTool(null)
    setFormValues({})
    setFormValid(false)
  }, [])

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return
    setExecuting(true)

    try {
      await runBuiltInTool(chatId, {
        toolName: selectedTool.id,
        arguments: cleanArgs(formValues),
        characterId: selectedCharacterId,
        private: isPrivate,
      })

      onToolExecuted()
      onClose()
    } catch (err) {
      showErrorToast(apiErrorMessage(err, '') || 'Tool execution failed')
    } finally {
      setExecuting(false)
    }
  }, [selectedTool, formValues, chatId, selectedCharacterId, isPrivate, onToolExecuted, onClose])

  // Group tools by category
  const filteredTools = tools.filter(t => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
  })

  const groupedTools = filteredTools.reduce<Record<string, AvailableTool[]>>((acc, tool) => {
    const cat = tool.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(tool)
    return acc
  }, {})

  // Check if the selected tool has a valid schema for the form
  const hasSchema = !!(selectedTool?.parameters &&
    typeof selectedTool.parameters === 'object' &&
    (selectedTool.parameters as { properties?: unknown }).properties &&
    Object.keys((selectedTool.parameters as { properties: Record<string, unknown> }).properties).length > 0)

  // JSON preview of the arguments a run would send
  const cleanPreviewArgs = cleanArgs(formValues)

  const title = selectedTool
    ? `Run Tool: ${selectedTool.name}`
    : 'Run Tool'

  const footer = selectedTool ? (
    <div className="flex justify-between items-center w-full">
      <button
        type="button"
        onClick={handleBack}
        className="qt-button qt-button-secondary"
        disabled={executing}
      >
        Back
      </button>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="qt-button qt-button-secondary"
          disabled={executing}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleExecute}
          className="qt-button qt-button-primary"
          disabled={executing || (hasSchema && !formValid)}
        >
          {executing ? (
            <span className="flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              Running...
            </span>
          ) : 'Run Tool'}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClose}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="xl"
      showCloseButton
      footer={footer}
    >
      {loading ? (
        <div className="qt-loading-state">
          <Spinner className="h-6 w-6 qt-text-secondary" />
        </div>
      ) : !selectedTool ? (
        /* Phase 1: Tool Selection */
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary" />
            <input
              aria-label="Search tools"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools..."
              className="qt-input w-full pl-9 text-sm"
              autoFocus
            />
          </div>

          {/* Tool list grouped by category */}
          {Object.keys(groupedTools).length === 0 ? (
            <p className="text-sm qt-text-secondary text-center py-4">
              {searchQuery ? 'No tools match your search.' : 'No tools available.'}
            </p>
          ) : (
            Object.entries(groupedTools).map(([category, categoryTools]) => {
              const catInfo = CATEGORY_INFO[category] || { label: category.charAt(0).toUpperCase() + category.slice(1), icon: '⚙️' }
              return (
                <div key={category}>
                  <div className="text-xs font-semibold qt-text-secondary uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                    <span>{catInfo.icon}</span>
                    <span>{catInfo.label}</span>
                  </div>
                  <div className="space-y-1">
                    {categoryTools.map((tool) => {
                      const isUnavailable = tool.available === false
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => handleSelectTool(tool)}
                          disabled={isUnavailable}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                            isUnavailable
                              ? 'opacity-50 cursor-not-allowed qt-bg-surface'
                              : 'qt-bg-surface hover:qt-bg-surface-hover cursor-pointer'
                          }`}
                          title={isUnavailable ? tool.unavailableReason : tool.description}
                        >
                          <div className="font-medium qt-text">{tool.name}</div>
                          <div className="text-xs qt-text-secondary mt-0.5">
                            {isUnavailable ? (
                              <span className="qt-text-warning">{tool.unavailableReason}</span>
                            ) : (
                              tool.description
                            )}
                          </div>
                          {tool.source === 'plugin' && (
                            <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded qt-bg-muted qt-text-secondary">
                              plugin{tool.pluginName ? `: ${tool.pluginName}` : ''}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
        /* Phase 2: Parameter Form + Execute */
        <div className="space-y-4">
          {/* Tool description */}
          <div className="text-sm qt-text-secondary">
            {selectedTool.description}
          </div>

          {/* Character selector */}
          {activeCharacters.length > 0 && (
            <div className="border-t qt-border pt-3">
              <label htmlFor={`${id}-character`} className="block text-sm font-medium qt-text mb-1">Run as character</label>
              <select
                id={`${id}-character`}
                className="qt-input w-full text-sm"
                value={selectedCharacterId || ''}
                onChange={(e) => setSelectedCharacterId(e.target.value || null)}
              >
                {activeCharacters.map(p => (
                  <option key={p.id} value={p.character?.id || ''}>
                    {p.character?.name || 'Unknown'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Private (whisper) toggle */}
          <div className="border-t qt-border pt-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-medium qt-text">Private (whisper)</div>
                <div className="text-xs qt-text-secondary">
                  Excluded from every character&apos;s context — the run stays between
                  you and Prospero, and remains in your own view of the salon.
                </div>
              </div>
            </label>
          </div>

          {/* Parameter form */}
          {hasSchema ? (
            <>
              <div className="border-t qt-border pt-3">
                <h4 className="text-sm font-medium qt-text mb-3">Parameters</h4>
                <JsonSchemaForm
                  schema={selectedTool.parameters as {
                    type: string
                    properties: Record<string, any>
                    required?: string[]
                  }}
                  values={formValues}
                  onChange={setFormValues}
                  onValidChange={setFormValid}
                />
              </div>

              {/* JSON preview */}
              <details className="border-t qt-border pt-3">
                <summary className="text-xs qt-text-secondary cursor-pointer select-none">
                  Arguments preview {formValid ? '(valid)' : '(incomplete)'}
                </summary>
                <pre className="mt-2 text-xs qt-bg-muted p-2 rounded overflow-x-auto font-mono max-h-32">
                  {JSON.stringify(cleanPreviewArgs, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-sm qt-text-secondary italic">
              This tool requires no parameters.
            </p>
          )}
        </div>
      )}
    </BaseModal>
  )
}
