'use client'

/**
 * CustomToolsDropdown Component
 *
 * Dropdown menu for manual invocation of Pascal's custom tools from the
 * composer gutter. Mirrors {@link RngDropdown}'s shape (outside-click ref,
 * upward-opening menu, `variant` for gutter vs palette) but is wider and
 * scrollable, because each tool expands into a parameter form generated from
 * its definition.
 *
 * The roster is fetched fresh on every open (`enabled: isOpen`) — custom-tool
 * definitions live in the user's document stores and can change mid-chat.
 *
 * Deliberate omission: odds and outcome tables are never shown. The roster
 * payload doesn't carry them, and this UI must not surface them — parity with
 * what a tabletop screen hides from the players.
 */

import { useMemo, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useClickOutside } from '@/hooks/useClickOutside'
import { Icon } from '@/components/ui/icon'
import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

/** A single declared parameter of a custom-tool definition. */
export interface CustomToolParameter {
  type: 'number' | 'integer' | 'string' | 'boolean'
  default: number | string | boolean
  description?: string
  min?: number
  max?: number
}

/** A runnable tool in the resolved roster. */
export interface CustomTool {
  name: string
  description: string
  parameters: Record<string, CustomToolParameter>
  defaultVisibility: 'public' | 'whisper'
  sourceTier: string
  /** Present on per-character variants that shadow a broader definition. */
  characterLabel?: string
  /** Disambiguates a character-labeled variant on the run call. */
  asCharacterId?: string
  definitionPath: string
  mountName: string
}

/** A definition file that failed load-time validation and stayed out of the roster. */
export interface CustomToolError {
  definitionPath: string
  mountName: string
  tier: string
  reason: string
}

interface CustomToolsRosterResponse {
  tools: CustomTool[]
  errors: CustomToolError[]
  /** Tools dropped because the roster hit its cap — surfaced, never silent. */
  droppedForCap?: string[]
}

interface CustomToolsDropdownProps {
  /** Chat ID for the roster + run API calls */
  chatId: string
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Called after a successful run so the Salon can refetch the chat */
  onRan?: () => void
  /** Called to close the parent ToolPalette */
  onClose?: () => void
  /** Button variant: 'palette' (default) for tool palette, 'gutter' for composer gutter */
  variant?: 'palette' | 'gutter'
}

/** Form values are held loosely (text inputs yield strings) and coerced on run. */
type ParameterFormValues = Record<string, string | boolean>

/**
 * Identity of a roster entry. `name` alone isn't unique — a per-character
 * variant shadows a broader definition under the same name.
 */
function toolKey(tool: CustomTool): string {
  return `${tool.name}::${tool.asCharacterId ?? ''}`
}

/** Seed a tool's form from its declared defaults. */
function initialValues(tool: CustomTool): ParameterFormValues {
  const values: ParameterFormValues = {}
  for (const [name, param] of Object.entries(tool.parameters)) {
    values[name] = param.type === 'boolean' ? Boolean(param.default) : String(param.default)
  }
  return values
}

/**
 * Coerce the form's loose values back to the declared types. Blank or
 * unparseable numbers fall back to the declared default rather than sending
 * NaN — the server validates properly; this only keeps the payload well-typed.
 */
function coerceParameters(
  tool: CustomTool,
  values: ParameterFormValues,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [name, param] of Object.entries(tool.parameters)) {
    const raw = values[name]
    if (param.type === 'boolean') {
      out[name] = Boolean(raw)
      continue
    }
    if (param.type === 'string') {
      out[name] = typeof raw === 'string' ? raw : String(param.default)
      continue
    }
    const parsed = param.type === 'integer'
      ? parseInt(String(raw), 10)
      : parseFloat(String(raw))
    out[name] = Number.isFinite(parsed) ? parsed : Number(param.default)
  }
  return out
}

export function CustomToolsDropdown({
  chatId,
  disabled = false,
  onRan,
  onClose,
  variant = 'palette',
}: Readonly<CustomToolsDropdownProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, ParameterFormValues>>({})
  const [privateByKey, setPrivateByKey] = useState<Record<string, boolean>>({})
  const dropdownRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  useClickOutside(dropdownRef, () => {
    setIsOpen(false)
    setExpandedKey(null)
  }, {
    enabled: isOpen,
  })

  // Refetched on every open: definitions live in document stores the user edits
  // mid-chat, so a stale roster is worse than a round-trip.
  const rosterQuery = useQuery({
    queryKey: queryKeys.customTools.byChat(chatId),
    queryFn: ({ signal }) =>
      apiFetch<CustomToolsRosterResponse>(`/api/v1/chats/${chatId}/custom-tools`, { signal }),
    enabled: isOpen,
  })

  const tools = useMemo(() => rosterQuery.data?.tools ?? [], [rosterQuery.data])
  const errors = rosterQuery.data?.errors ?? []
  const droppedForCap = rosterQuery.data?.droppedForCap ?? []

  const runMutation = useMutation({
    mutationFn: (vars: {
      tool: string
      parameters: Record<string, number | string | boolean>
      private: boolean
      asCharacterId?: string
    }) =>
      apiFetch(`/api/v1/chats/${chatId}/custom-tools?action=run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: (_data, vars) => {
      showSuccessToast(`Pascal has settled ${vars.tool}.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.customTools.byChat(chatId) })
      onRan?.()
      setIsOpen(false)
      setExpandedKey(null)
      onClose?.()
    },
    onError: (err) => {
      showErrorToast(extractErrorMessage(err))
    },
  })

  const isRunning = runMutation.isPending

  const handleToggle = () => {
    if (disabled) return
    setIsOpen(!isOpen)
    setExpandedKey(null)
  }

  /** Expand a tool, seeding its form + privacy default the first time it opens. */
  const handleExpand = (tool: CustomTool) => {
    const key = toolKey(tool)
    if (expandedKey === key) {
      setExpandedKey(null)
      return
    }
    setFormValues((prev) => (key in prev ? prev : { ...prev, [key]: initialValues(tool) }))
    setPrivateByKey((prev) =>
      key in prev ? prev : { ...prev, [key]: tool.defaultVisibility === 'whisper' },
    )
    setExpandedKey(key)
  }

  const handleValueChange = (key: string, param: string, value: string | boolean) => {
    setFormValues((prev) => ({ ...prev, [key]: { ...prev[key], [param]: value } }))
  }

  const handleRun = (tool: CustomTool) => {
    if (disabled || isRunning) return
    const key = toolKey(tool)
    runMutation.mutate({
      tool: tool.name,
      parameters: coerceParameters(tool, formValues[key] ?? initialValues(tool)),
      private: privateByKey[key] ?? tool.defaultVisibility === 'whisper',
      asCharacterId: tool.asCharacterId,
    })
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main button - different styling for gutter vs palette */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={variant === 'gutter' ? 'qt-composer-gutter-button' : 'qt-tool-palette-button'}
        title="Custom tools"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Custom tools"
      >
        <Icon name="wand" className={variant === 'gutter' ? 'w-5 h-5' : 'w-4 h-4'} />
        {variant === 'palette' && (
          <>
            <span>Tools</span>
            <Icon name="chevron-down" className={`w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {/* Dropdown menu — opens upward; wider than the RNG menu to fit param forms */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 mb-1 w-72 max-h-96 overflow-y-auto qt-card qt-shadow-lg rounded-lg border z-50"
          role="menu"
        >
          <div className="py-1">
            {rosterQuery.isLoading && (
              <div className="px-3 py-2 text-sm qt-text-secondary">
                Consulting Pascal&rsquo;s ledger&hellip;
              </div>
            )}

            {rosterQuery.isError && (
              <div className="px-3 py-2 text-xs qt-text-destructive">
                {extractErrorMessage(rosterQuery.error)}
              </div>
            )}

            {!rosterQuery.isLoading && !rosterQuery.isError && tools.length === 0 && (
              <div className="px-3 py-2 text-sm qt-text-secondary">
                No custom tools are laid out on the table.
              </div>
            )}

            {tools.map((tool) => {
              const key = toolKey(tool)
              const isExpanded = expandedKey === key
              const values = formValues[key] ?? initialValues(tool)
              const params = Object.entries(tool.parameters)

              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => handleExpand(tool)}
                    disabled={isRunning}
                    className="w-full px-3 py-2 text-left hover:qt-bg-muted transition-colors disabled:opacity-50 flex items-start justify-between gap-2"
                    role="menuitem"
                    aria-expanded={isExpanded}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm truncate">
                        {tool.name}
                        {tool.characterLabel ? ` (${tool.characterLabel})` : ''}
                      </span>
                      {tool.description && (
                        <span className="block text-xs qt-text-secondary">{tool.description}</span>
                      )}
                    </span>
                    <Icon
                      name="chevron-down"
                      className={`w-3 h-3 mt-1 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {/* Parameter form — generated from the definition's `parameters` */}
                  {isExpanded && (
                    <div className="px-3 py-2 space-y-2 border-t">
                      {params.map(([name, param]) => {
                        const inputId = `custom-tool-${key}-${name}`
                        if (param.type === 'boolean') {
                          return (
                            <label key={name} className="flex items-center gap-2 text-sm">
                              <input
                                id={inputId}
                                type="checkbox"
                                checked={Boolean(values[name])}
                                onChange={(e) => handleValueChange(key, name, e.target.checked)}
                                disabled={isRunning}
                              />
                              <span title={param.description}>{name}</span>
                            </label>
                          )
                        }
                        return (
                          <div key={name} className="flex items-center justify-between gap-2">
                            <label htmlFor={inputId} className="text-sm" title={param.description}>
                              {name}
                            </label>
                            <input
                              id={inputId}
                              type={param.type === 'string' ? 'text' : 'number'}
                              value={String(values[name] ?? '')}
                              onChange={(e) => handleValueChange(key, name, e.target.value)}
                              min={param.type === 'string' ? undefined : param.min}
                              max={param.type === 'string' ? undefined : param.max}
                              disabled={isRunning}
                              className={param.type === 'string' ? 'qt-input w-40' : 'qt-input w-20'}
                            />
                          </div>
                        )
                      })}

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={privateByKey[key] ?? tool.defaultVisibility === 'whisper'}
                          onChange={(e) =>
                            setPrivateByKey((prev) => ({ ...prev, [key]: e.target.checked }))
                          }
                          disabled={isRunning}
                        />
                        <span>Roll privately</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => handleRun(tool)}
                        disabled={isRunning}
                        className="w-full px-2 py-1 text-sm qt-button qt-button-primary rounded"
                      >
                        {isRunning ? 'Running…' : `Run ${tool.name}`}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Definition files that failed validation — named, never swallowed */}
            {errors.length > 0 && (
              <div className="border-t mt-1 pt-1">
                {errors.map((err) => (
                  <div
                    key={`${err.mountName}:${err.definitionPath}`}
                    className="px-3 py-2 text-xs qt-text-destructive"
                  >
                    <span className="block break-all">{err.definitionPath}</span>
                    <span className="block">{err.reason}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Roster cap — say so rather than truncate silently */}
            {droppedForCap.length > 0 && (
              <div className="px-3 py-2 text-xs qt-text-destructive border-t">
                Too many tools on the table; these were left off:{' '}
                {droppedForCap.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Pull a human message out of an ApiFetchError's parsed `{ error }` body. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiFetchError) {
    const info = err.info
    if (info && typeof info === 'object') {
      const record = info as Record<string, unknown>
      if (typeof record.error === 'string') return record.error
      if (typeof record.message === 'string') return record.message
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'The tool could not be run.'
}

export default CustomToolsDropdown
