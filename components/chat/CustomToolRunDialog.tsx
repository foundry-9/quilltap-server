'use client'

/**
 * CustomToolRunDialog — the operator's side of Pascal's table.
 *
 * A two-phase modal, replacing the cramped upward-opening popover this used to
 * be. Phase one lists the roster; choosing a tool replaces the dialog's body
 * with that tool's form, and a "Choose another tool" button goes back. The
 * whole thing is cancellable — Escape, the backdrop, or the Cancel button.
 *
 * The roster is fetched fresh on every open (`enabled: isOpen`) — custom-tool
 * definitions live in the user's document stores and can change mid-chat.
 *
 * ## What it remembers
 *
 * Everything you last set, for as long as the composer stays mounted: the
 * parameter values per tool, the privacy toggle per tool, and which tool you
 * were on. Reopening therefore lands you back on the last tool with its values
 * intact — the old popover's one genuinely good habit, and the reason the back
 * button is always in reach rather than the picker being forced on you.
 *
 * ## What it discloses
 *
 * Odds and outcome tables are never shown; the roster payload doesn't carry
 * them. What it does carry is each tool's `references` — the metadata keys and
 * state paths the definition quotes — which the reference panel lists so a user
 * can see what the tool reads about their character. Vocabulary, not odds.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { buildMountFileItemUrl } from '@/components/files/mountBlobUrl'
import {
  PRESET_NAME_PATTERN,
  presetSettingsPath,
  sanitizePresetNameInput,
} from '@/lib/pascal/tool-presets'
import {
  CustomToolParamsForm,
  coerceParamValues,
  initialParamValues,
  type CustomToolParameterSpec,
  type ParameterFormValues,
} from '@/components/custom-tools/CustomToolParamsForm'

/** A single declared parameter of a custom-tool definition. */
export type CustomToolParameter = CustomToolParameterSpec

/**
 * What a tool actually quotes. Mirrors `ToolVocabulary` on the server
 * (`lib/pascal/tool-vocabulary.ts`) — every field is an occurrence, not an
 * availability, so a tool that rolls dice but never writes `{{dice}}` reports
 * `dice: false`.
 */
export interface CustomToolReferences {
  /** The tool quotes `{{value}}`. */
  value: boolean
  /** The tool quotes `{{roll}}`. */
  roll: boolean
  /** The tool quotes `{{dice}}`. */
  dice: boolean
  /** The tool quotes `{{llm}}`. */
  llm: boolean
  /** Declared parameters the tool quotes as `{{params.name}}`. */
  params: string[]
  /** Keys of the invoking character's `metadata.json` this tool reads. */
  metadata: string[]
  /** Paths into the merged persistent state this tool reads. */
  state: string[]
  /** State paths this tool's effects may WRITE. Absent on rosters from an older server. */
  stateWrites?: string[]
  /** Metadata keys this tool's effects may WRITE on the rolling character. Absent on older servers. */
  metadataWrites?: string[]
  /**
   * Progression IDS this tool reads — ids rather than `<id>.<field>` keys, so
   * the panel says "consults your cannon" and never edges toward the odds the
   * roster deliberately withholds. Absent on older servers.
   */
  progress?: string[]
  /** Progression ids this tool's effects may WRITE. Absent on older servers. */
  progressWrites?: string[]
  /** The tool quotes `{{now}}`. Absent on older servers. */
  now?: boolean
  /** The tool quotes `{{character}}`. Absent on older servers. */
  character?: boolean
  /** Item references this tool's wardrobe effects may put on, verbatim. Absent on older servers. */
  wears?: string[]
  /** Item references this tool's wardrobe effects may take off, verbatim. Absent on older servers. */
  takesOff?: string[]
  /** Slots this tool's wardrobe effects may clear. Absent on older servers. */
  clearsSlots?: string[]
  /** Inventory object references this tool reads (tests, quotes, draws from). Absent on older servers. */
  inventoryReads?: string[]
  /** `inventoryAggregate` keys this tool tests (`equipped.names`, …). Absent on older servers. */
  inventoryAggregates?: string[]
  /** References this tool's inventory effects may equip, verbatim. Absent on older servers. */
  equips?: string[]
  /** References this tool's inventory effects may unequip, verbatim. Absent on older servers. */
  unequips?: string[]
  /** Archetype references this tool's inventory effects may pick up, verbatim. Absent on older servers. */
  picksUp?: string[]
}

/** A runnable tool in the resolved roster. */
export interface CustomTool {
  /** Identity — what the run call names. Never displayed. */
  name: string
  /** What to display. Server-resolved, so `title` is always present. */
  title: string
  description: string
  parameters: Record<string, CustomToolParameter>
  /** Absent on a roster from an older server; treated as "quotes nothing". */
  references?: CustomToolReferences
  defaultVisibility: 'public' | 'whisper'
  sourceTier: string
  /** Present on per-character variants that shadow a broader definition. */
  characterLabel?: string
  /** Disambiguates a character-labeled variant on the run call. */
  asCharacterId?: string
  /**
   * The running character's vault mount — the presets section's default save
   * destination. Null when the vault could not be resolved, in which case the
   * nearest shared store is offered first instead.
   */
  vaultMountPointId?: string | null
  definitionPath: string
  /** Which store holds the file — the Workbench edits it by this pair. */
  mountPointId?: string
  mountName: string
}

/** A definition file that failed load-time validation and stayed out of the roster. */
export interface CustomToolError {
  definitionPath: string
  mountPointId?: string
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

interface CustomToolRunDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when the dialog should close */
  onClose: () => void
  /** Chat ID for the roster + run API calls */
  chatId: string
  /** Called after a successful run so the Salon can refetch the chat */
  onRan?: () => void
  /**
   * Open straight onto this tool's form (the composer's `/<name>` command).
   * Applied once per nonce, after the fresh roster arrives; it lands on the
   * remembered values for that tool like any other selection.
   */
  initialTool?: { name: string; asCharacterId: string | null; nonce: number } | null
}

/** Above this many tools, the picker earns a search box. */
const SEARCH_THRESHOLD = 6

/**
 * Identity of a roster entry. `name` alone isn't unique — a per-character
 * variant shadows a broader definition under the same name.
 */
function toolKey(tool: CustomTool): string {
  return `${tool.name}::${tool.asCharacterId ?? ''}`
}

/** What the picker matches a search against. */
function searchHaystack(tool: CustomTool): string {
  return `${tool.title} ${tool.name} ${tool.description} ${tool.characterLabel ?? ''}`.toLowerCase()
}

export function CustomToolRunDialog({
  isOpen,
  onClose,
  chatId,
  onRan,
  initialTool = null,
}: Readonly<CustomToolRunDialogProps>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, ParameterFormValues>>({})
  const [privateByKey, setPrivateByKey] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()
  const workspace = useWorkspaceOptional()
  const router = useRouter()

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

  // Derived rather than stored, so a remembered tool that has since been
  // renamed, disabled, or shadowed simply drops the dialog back to the picker
  // instead of leaving it pointed at a tool that is no longer dealt.
  const selectedTool = useMemo(
    () => tools.find((tool) => toolKey(tool) === selectedKey) ?? null,
    [tools, selectedKey],
  )

  const visibleTools = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query === '') return tools
    return tools.filter((tool) => searchHaystack(tool).includes(query))
  }, [tools, search])

  const runMutation = useMutation({
    mutationFn: ({ title: _title, ...vars }: {
      tool: string
      /** Display only — the toast's, not the API's. */
      title: string
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
      showSuccessToast(`Pascal has settled ${vars.title}.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.customTools.byChat(chatId) })
      onRan?.()
      // The selection survives the close on purpose — see the file header.
      onClose()
    },
    onError: (err) => {
      showErrorToast(extractErrorMessage(err))
    },
  })

  const isRunning = runMutation.isPending

  /** Open Pascal's Workbench — as a tab inside the workspace, a route outside. */
  const openWorkbench = (payload?: { mountPointId?: string; path?: string; create?: boolean }) => {
    onClose()
    if (workspace) {
      workspace.openTab('custom-tools', payload)
      return
    }
    const params = new URLSearchParams()
    if (payload?.create) params.set('new', '1')
    if (payload?.mountPointId) params.set('mount', payload.mountPointId)
    if (payload?.path) params.set('path', payload.path)
    router.push(params.size > 0 ? `/custom-tools?${params.toString()}` : '/custom-tools')
  }

  /** Choose a tool, seeding its form + privacy default the first time it opens. */
  const handleSelect = (tool: CustomTool) => {
    const key = toolKey(tool)
    setFormValues((prev) => (key in prev ? prev : { ...prev, [key]: initialParamValues(tool.parameters) }))
    setPrivateByKey((prev) =>
      key in prev ? prev : { ...prev, [key]: tool.defaultVisibility === 'whisper' },
    )
    setSelectedKey(key)
  }

  // A pre-selection waits for the roster this open fetched, not a cached one, so
  // a tool added to a store mid-chat is found. One nonce, one application.
  const appliedNonceRef = useRef<number | null>(null)
  const rosterSettled = rosterQuery.isSuccess && !rosterQuery.isFetching
  useEffect(() => {
    if (!isOpen || !initialTool || !rosterSettled) return
    if (appliedNonceRef.current === initialTool.nonce) return
    appliedNonceRef.current = initialTool.nonce
    const named = tools.filter((tool) => tool.name === initialTool.name)
    const match =
      named.find((tool) => (tool.asCharacterId ?? null) === initialTool.asCharacterId) ??
      (initialTool.asCharacterId === null ? named[0] : undefined) ??
      null
    if (!match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- falling back to the picker for a request that named nothing dealt
      setSelectedKey(null)
      showErrorToast(`No tool named "${initialTool.name}" is on Pascal's table in this chat`)
      return
    }
    handleSelect(match)
  }, [isOpen, initialTool, rosterSettled, tools])

  const handleRun = () => {
    if (!selectedTool || isRunning) return
    const key = toolKey(selectedTool)
    runMutation.mutate({
      tool: selectedTool.name,
      title: selectedTool.title,
      parameters: coerceParamValues(
        selectedTool.parameters,
        formValues[key] ?? initialParamValues(selectedTool.parameters),
      ),
      private: privateByKey[key] ?? selectedTool.defaultVisibility === 'whisper',
      asCharacterId: selectedTool.asCharacterId,
    })
  }

  const selectedFormKey = selectedTool ? toolKey(selectedTool) : ''
  const isPrivate = selectedTool
    ? privateByKey[selectedFormKey] ?? selectedTool.defaultVisibility === 'whisper'
    : false

  const footer = selectedTool ? (
    <div className="flex items-center justify-between w-full gap-2">
      <button
        type="button"
        onClick={() => setSelectedKey(null)}
        disabled={isRunning}
        className="qt-button qt-button-secondary"
      >
        <Icon name="arrow-left" className="w-4 h-4 mr-1.5" />
        Choose another tool
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={isRunning} className="qt-button qt-button-secondary">
          Cancel
        </button>
        <button type="button" onClick={handleRun} disabled={isRunning} className="qt-button qt-button-primary">
          {isRunning ? 'Running…' : `Run ${selectedTool.title}`}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between w-full gap-2">
      <button
        type="button"
        onClick={() => openWorkbench({ create: true })}
        className="qt-button qt-button-secondary"
      >
        <Icon name="wrench" className="w-4 h-4 mr-1.5" />
        New contrivance&hellip;
      </button>
      <button type="button" onClick={onClose} className="qt-button qt-button-secondary">
        Cancel
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={selectedTool ? `Run ${selectedTool.title}` : "Pascal's Table"}
      maxWidth="2xl"
      showCloseButton
      footer={footer}
    >
      {selectedTool ? (
        <ToolRunForm
          chatId={chatId}
          tool={selectedTool}
          values={formValues[selectedFormKey] ?? initialParamValues(selectedTool.parameters)}
          onValueChange={(param, value) =>
            setFormValues((prev) => ({
              ...prev,
              [selectedFormKey]: { ...prev[selectedFormKey], [param]: value },
            }))
          }
          onValuesReplace={(next) =>
            setFormValues((prev) => ({ ...prev, [selectedFormKey]: next }))
          }
          isPrivate={isPrivate}
          onPrivateChange={(next) =>
            setPrivateByKey((prev) => ({ ...prev, [selectedFormKey]: next }))
          }
          disabled={isRunning}
          onOpenWorkbench={openWorkbench}
        />
      ) : (
        <ToolPicker
          tools={visibleTools}
          totalCount={tools.length}
          errors={errors}
          droppedForCap={droppedForCap}
          isLoading={rosterQuery.isLoading}
          error={rosterQuery.isError ? extractErrorMessage(rosterQuery.error) : null}
          search={search}
          onSearchChange={setSearch}
          onSelect={handleSelect}
          onOpenWorkbench={openWorkbench}
        />
      )}
    </BaseModal>
  )
}

// ---------------------------------------------------------------------------
// Phase one — the roster
// ---------------------------------------------------------------------------

interface ToolPickerProps {
  tools: CustomTool[]
  /** Unfiltered count, so "no matches" and "no tools" can be told apart. */
  totalCount: number
  errors: CustomToolError[]
  droppedForCap: string[]
  isLoading: boolean
  error: string | null
  search: string
  onSearchChange: (next: string) => void
  onSelect: (tool: CustomTool) => void
  onOpenWorkbench: (payload?: { mountPointId?: string; path?: string; create?: boolean }) => void
}

function ToolPicker({
  tools,
  totalCount,
  errors,
  droppedForCap,
  isLoading,
  error,
  search,
  onSearchChange,
  onSelect,
  onOpenWorkbench,
}: Readonly<ToolPickerProps>) {
  return (
    <div className="space-y-4">
      {isLoading && (
        <p className="text-sm qt-text-secondary px-1 py-2">Consulting Pascal&rsquo;s ledger&hellip;</p>
      )}

      {error && <p className="text-sm qt-text-destructive px-1 py-2">{error}</p>}

      {totalCount > SEARCH_THRESHOLD && (
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary" />
          <input
            aria-label="Search the table"
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search the table…"
            className="qt-input w-full pl-9 text-sm"
          />
        </div>
      )}

      {/* "Nothing here" only when there is genuinely nothing. With a failed
          definition below, this line would contradict the badge that is about
          to explain why the table looks bare. */}
      {!isLoading && !error && totalCount === 0 && errors.length === 0 && (
        <p className="text-sm qt-text-secondary px-1 py-2">No custom tools are laid out on the table.</p>
      )}

      {!isLoading && !error && totalCount === 0 && errors.length > 0 && (
        <p className="text-sm qt-text-secondary px-1 py-2">
          Nothing is runnable — the table was set, but the cards below would not read.
        </p>
      )}

      {!isLoading && totalCount > 0 && tools.length === 0 && (
        <p className="text-sm qt-text-secondary px-1 py-2">Nothing on the table answers to that.</p>
      )}

      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={toolKey(tool)}
            className="flex items-stretch gap-1 rounded-lg qt-bg-surface hover:qt-bg-surface-hover"
          >
            <button
              type="button"
              onClick={() => onSelect(tool)}
              className="flex-1 min-w-0 text-left px-4 py-3 rounded-lg"
            >
              <span className="block text-sm font-medium qt-text">
                {tool.title}
                {tool.characterLabel ? (
                  <span className="ml-2 text-xs qt-text-secondary font-normal">
                    as {tool.characterLabel}
                  </span>
                ) : null}
              </span>
              {tool.description && (
                <span className="block text-xs qt-text-secondary mt-1">{tool.description}</span>
              )}
              <span className="block text-[10px] qt-text-secondary mt-1.5 font-mono">
                {tool.mountName} · {tool.definitionPath}
              </span>
            </button>
            {tool.mountPointId && (
              <button
                type="button"
                className="px-4 qt-text-secondary hover:opacity-70 rounded-lg"
                title="Open on Pascal's Workbench"
                aria-label={`Open ${tool.title} on Pascal's Workbench`}
                onClick={() =>
                  onOpenWorkbench({ mountPointId: tool.mountPointId, path: tool.definitionPath })
                }
              >
                <Icon name="wrench" className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Definition files that failed validation — named, never swallowed. Each
          badge opens the Workbench's repair mode: the place you fix a broken file. */}
      {errors.length > 0 && (
        <div className="rounded-lg qt-border p-4 space-y-2">
          <h4 className="text-xs font-semibold qt-text-secondary uppercase tracking-wide">
            Would not read
          </h4>
          {errors.map((err) => (
            <button
              key={`${err.mountName}:${err.definitionPath}`}
              type="button"
              className="w-full px-3 py-2 text-xs qt-text-destructive text-left rounded-md hover:qt-bg-surface-hover disabled:hover:bg-transparent"
              disabled={!err.mountPointId}
              title={err.mountPointId ? "Open in Pascal's Workbench to repair" : undefined}
              onClick={() =>
                err.mountPointId &&
                onOpenWorkbench({ mountPointId: err.mountPointId, path: err.definitionPath })
              }
            >
              <span className="block break-all font-mono">{err.definitionPath}</span>
              <span className="block">{err.reason}</span>
            </button>
          ))}
        </div>
      )}

      {/* Roster cap — say so rather than truncate silently */}
      {droppedForCap.length > 0 && (
        <p className="text-xs qt-text-destructive rounded-lg qt-border p-4 leading-relaxed">
          Too many tools on the table; these were left off: {droppedForCap.join(', ')}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase two — the chosen tool
// ---------------------------------------------------------------------------

interface ToolRunFormProps {
  chatId: string
  tool: CustomTool
  values: ParameterFormValues
  onValueChange: (param: string, value: string | boolean) => void
  /** Replace the whole value set at once — preset loads and resets. */
  onValuesReplace: (next: ParameterFormValues) => void
  isPrivate: boolean
  onPrivateChange: (next: boolean) => void
  disabled: boolean
  onOpenWorkbench: (payload?: { mountPointId?: string; path?: string; create?: boolean }) => void
}

function ToolRunForm({
  chatId,
  tool,
  values,
  onValueChange,
  onValuesReplace,
  isPrivate,
  onPrivateChange,
  disabled,
  onOpenWorkbench,
}: Readonly<ToolRunFormProps>) {
  const parameterNames = Object.keys(tool.parameters)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          {tool.description && <p className="text-sm qt-text-secondary">{tool.description}</p>}
          <p className="text-[10px] qt-text-secondary mt-1.5 font-mono break-all">
            {tool.mountName} · {tool.definitionPath}
            {tool.characterLabel ? ` · as ${tool.characterLabel}` : ''}
          </p>
        </div>
        {tool.mountPointId && (
          <button
            type="button"
            className="qt-text-secondary hover:opacity-70 flex-shrink-0"
            title="Open on Pascal's Workbench"
            aria-label="Open on Pascal's Workbench"
            onClick={() =>
              onOpenWorkbench({ mountPointId: tool.mountPointId, path: tool.definitionPath })
            }
          >
            <Icon name="wrench" className="w-4 h-4" />
          </button>
        )}
      </div>

      <section className="rounded-lg qt-border p-5">
        <h4 className="text-sm font-medium qt-text mb-4">
          {parameterNames.length > 0 ? 'What you are setting' : 'Nothing to set'}
        </h4>
        {parameterNames.length > 0 ? (
          <div className="space-y-6">
            <CustomToolParamsForm
              parameters={tool.parameters}
              values={values}
              onChange={onValueChange}
              disabled={disabled}
              idPrefix={`custom-tool-${toolKey(tool)}`}
              layout="stacked"
            />
          </div>
        ) : (
          <p className="text-sm qt-text-secondary">
            This tool takes no parameters. There is nothing to do but spin.
          </p>
        )}
      </section>

      {/* Presets only make sense where there is something to preserve: a tool
          with parameters. A roster from an older server names nobody to walk
          the stores as, so it gets none. */}
      {parameterNames.length > 0 && tool.asCharacterId && (
        <ToolPresetsSection
          chatId={chatId}
          tool={tool}
          asCharacterId={tool.asCharacterId}
          values={values}
          onValuesReplace={onValuesReplace}
          disabled={disabled}
        />
      )}

      {/* Above the reference panel on purpose: this is the last decision the
          operator makes about the run, and the panel below it is reading
          matter rather than a control. */}
      <section className="rounded-lg qt-border p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => onPrivateChange(e.target.checked)}
            disabled={disabled}
            className="mt-1"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium qt-text">Roll privately</span>
            <span className="block text-xs qt-text-secondary mt-1">
              The outcome is whispered to you alone. No character sees it, and it stays out of
              every character&rsquo;s context.
            </span>
          </span>
        </label>
      </section>

      <ToolReferencePanel tool={tool} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presets — parameter values set aside in the stores the tool is found in
// ---------------------------------------------------------------------------

/** A store on the preset walk. Mirrors `ToolPresetStore` (`lib/pascal/tool-preset-pool.ts`). */
interface PresetStore {
  tier: string
  mountPointId: string
  mountName: string
}

/** What `GET …/custom-tools?action=presets` answers with. */
interface ToolPresetPoolResponse {
  /** The nearest preset of each name, sorted by name. */
  presets: Array<PresetStore & { name: string; path: string; shadows: PresetStore[] }>
  /** Every store on the walk, nearest first — where a preset may be filed. */
  stores: PresetStore[]
  unread: Array<PresetStore & { reason: string }>
}

interface ToolPresetsSectionProps {
  chatId: string
  tool: CustomTool
  asCharacterId: string
  values: ParameterFormValues
  onValuesReplace: (next: ParameterFormValues) => void
  disabled: boolean
}

/**
 * Save the form's current values as `Tools/{name}.{preset}.settings.json`,
 * list what is already set aside, and deal a chosen one back into the form.
 *
 * Presets are found where the tool itself is found: the character's vault,
 * their groups' stores, the project's, Quilltap General — nearest first, a
 * nearer preset of a name shadowing a farther one. The server walks it
 * (`?action=presets`); this only shows the result. Saving files into whichever
 * store on that walk is chosen, the character's own vault by default, so a
 * personal preset shadows a shared one of the same name rather than
 * overwriting it.
 *
 * Loading is deliberately loose: a preset key lands only where the tool still
 * declares a parameter of that name and the value is a plain primitive;
 * everything else is ignored, and unmentioned parameters keep their current
 * values. A preset saved against an older revision of a tool therefore
 * degrades gracefully instead of erroring.
 *
 * The name input is filtered as typed ({@link sanitizePresetNameInput}) so a
 * character that cannot appear in the filename cannot be entered at all.
 */
function ToolPresetsSection({
  chatId,
  tool,
  asCharacterId,
  values,
  onValuesReplace,
  disabled,
}: Readonly<ToolPresetsSectionProps>) {
  const queryClient = useQueryClient()
  const [presetName, setPresetName] = useState('')
  /** The chosen save destination; null until the operator picks one. */
  const [pickedStoreId, setPickedStoreId] = useState<string | null>(null)

  const presetsKey = queryKeys.customTools.presets(chatId, asCharacterId, tool.name)

  // Fresh per mount of the form, same doctrine as the roster: the files live
  // in stores the user edits, so a stale list is worse than a round-trip.
  const presetsQuery = useQuery({
    queryKey: presetsKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ action: 'presets', tool: tool.name, asCharacterId })
      return apiFetch<ToolPresetPoolResponse>(
        `/api/v1/chats/${encodeURIComponent(chatId)}/custom-tools?${params.toString()}`,
        { signal },
      )
    },
  })
  const presets = presetsQuery.data?.presets ?? []
  const stores = presetsQuery.data?.stores ?? []
  const unread = presetsQuery.data?.unread ?? []

  // The character's own vault unless the operator chose otherwise; the
  // nearest store on the walk when there is no vault to default to.
  const saveStore =
    stores.find((store) => store.mountPointId === pickedStoreId) ??
    stores.find((store) => store.mountPointId === tool.vaultMountPointId) ??
    stores[0] ??
    null

  const loadMutation = useMutation({
    mutationFn: async (preset: ToolPresetPoolResponse['presets'][number]) => {
      const file = await apiFetch<{ content: string }>(
        buildMountFileItemUrl(preset.mountPointId, preset.path),
      )
      try {
        return JSON.parse(file.content) as unknown
      } catch {
        throw new Error(
          `Preset “${preset.name}” would not read as JSON. It stays as written in ${preset.mountName}.`,
        )
      }
    },
    onSuccess: (parsed, preset) => {
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        showErrorToast(
          `Preset “${preset.name}” is not a settings object. It stays as written in ${preset.mountName}.`,
        )
        return
      }
      const record = parsed as Record<string, unknown>
      const next = { ...values }
      for (const [name, param] of Object.entries(tool.parameters)) {
        if (!(name in record)) continue
        const v = record[name]
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
        next[name] = param.type === 'boolean' ? Boolean(v) : String(v)
      }
      onValuesReplace(next)
      // So saving again, values adjusted, files the hand just taken up under
      // the same name — into the chosen store, which a load does not move.
      setPresetName(preset.name)
    },
    onError: (err) => showErrorToast(apiErrorMessage(err, 'The preset could not be read.')),
  })

  const saveMutation = useMutation({
    mutationFn: ({ preset, store }: { preset: string; store: PresetStore }) =>
      apiFetch(buildMountFileItemUrl(store.mountPointId, presetSettingsPath(tool.name, preset)), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: JSON.stringify(coerceParamValues(tool.parameters, values), null, 2),
        }),
      }),
    onSuccess: (_data, { preset, store }) => {
      showSuccessToast(`Preset “${preset}” filed in ${store.mountName}.`)
      queryClient.invalidateQueries({ queryKey: presetsKey })
    },
    onError: (err) => showErrorToast(apiErrorMessage(err, 'The preset could not be saved.')),
  })

  const busy = disabled || loadMutation.isPending || saveMutation.isPending
  const canSave = !busy && saveStore !== null && PRESET_NAME_PATTERN.test(presetName)
  const storeSelectId = `custom-tool-${toolKey(tool)}-preset-store`

  return (
    <section className="rounded-lg qt-border p-5 space-y-4">
      <div>
        <h4 className="text-sm font-medium qt-text">Presets</h4>
        <p className="text-xs qt-text-secondary mt-1">
          A hand you set aside earlier, dealt back on request. They are kept wherever the tool
          itself might be: the character&rsquo;s vault, their groups&rsquo; stores, the
          project&rsquo;s, or Quilltap General &mdash; and the nearest one of a name wins. Saving
          under an existing name in the same store replaces it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value=""
          onChange={(e) => {
            const chosen = presets.find((preset) => preset.name === e.target.value)
            if (chosen) loadMutation.mutate(chosen)
          }}
          disabled={busy || presets.length === 0}
          className="qt-input text-sm"
          aria-label={`Load a saved preset for ${tool.title}`}
        >
          <option value="">
            {presetsQuery.isLoading
              ? 'Consulting the stores…'
              : presets.length === 0
                ? 'No presets yet'
                : loadMutation.isPending
                  ? 'Dealing it back…'
                  : 'Load a preset…'}
          </option>
          {presets.map((preset) => (
            <option
              key={preset.name}
              value={preset.name}
              title={
                preset.shadows.length > 0
                  ? `Also in ${preset.shadows.map((store) => store.mountName).join(', ')}, which this one outranks`
                  : undefined
              }
            >
              {preset.name} — {preset.mountName}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={presetName}
          onChange={(e) => setPresetName(sanitizePresetNameInput(e.target.value))}
          placeholder="preset-name"
          disabled={busy}
          className="qt-input text-sm flex-1 min-w-32 font-mono"
          aria-label="Name to save this preset under"
        />
        <button
          type="button"
          onClick={() => {
            if (saveStore) saveMutation.mutate({ preset: presetName, store: saveStore })
          }}
          disabled={!canSave}
          className="qt-button qt-button-secondary"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save preset'}
        </button>
        <button
          type="button"
          onClick={() => onValuesReplace(initialParamValues(tool.parameters))}
          disabled={busy}
          className="qt-button qt-button-secondary"
        >
          Reset to defaults
        </button>
      </div>

      {stores.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={storeSelectId} className="text-xs qt-text-secondary">
            Save into
          </label>
          <select
            id={storeSelectId}
            value={saveStore?.mountPointId ?? ''}
            onChange={(e) => setPickedStoreId(e.target.value)}
            disabled={busy}
            className="qt-input text-sm"
          >
            {stores.map((store) => (
              <option key={store.mountPointId} value={store.mountPointId}>
                {store.mountName}
              </option>
            ))}
          </select>
        </div>
      )}

      {presetsQuery.isError && (
        <p className="text-xs qt-text-destructive">
          {apiErrorMessage(presetsQuery.error, 'The stores would not list their presets.')}
        </p>
      )}
      {unread.length > 0 && (
        <p className="text-xs qt-text-secondary">
          Could not look in {unread.map((store) => store.mountName).join(', ')}
          {' '}&mdash; any presets kept there are missing from this list.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The reference panel — what this tool quotes
// ---------------------------------------------------------------------------

/** One row of the reference panel: a placeholder and what it stands for. */
interface ReferenceRow {
  placeholder: string
  meaning: string
}

/**
 * What the chosen tool actually quotes, in the order a reader wants it.
 *
 * Every row is an occurrence the server found in the definition's own strings.
 * Nothing is listed because the format merely permits it: a tool that never
 * writes `{{value}}` does not get a `{{value}}` row, and a parameter you are
 * filling in above appears here only if some message or prompt quotes it back.
 */
function referenceRows(tool: CustomTool): ReferenceRow[] {
  const refs = tool.references
  if (!refs) return []

  const rows: ReferenceRow[] = []

  if (refs.value) {
    rows.push({ placeholder: '{{value}}', meaning: 'the value the roll finally settles on' })
  }
  if (refs.roll) {
    rows.push({ placeholder: '{{roll}}', meaning: 'the raw draw, before the tool does its arithmetic' })
  }
  if (refs.dice) {
    rows.push({ placeholder: '{{dice}}', meaning: 'the dice, die by die, with the modifier' })
  }
  if (refs.llm) {
    rows.push({ placeholder: '{{llm}}', meaning: "the oracle's answer to the question this tool poses" })
  }
  if (refs.now) {
    rows.push({ placeholder: '{{now}}', meaning: 'the moment the run began, to the millisecond' })
  }
  if (refs.character) {
    rows.push({ placeholder: '{{character}}', meaning: 'the name of the character the run is made for' })
  }

  for (const name of refs.params) {
    rows.push({
      placeholder: `{{params.${name}}}`,
      meaning: tool.parameters[name]?.description ?? `whatever you set “${name}” to above`,
    })
  }

  for (const key of refs.metadata) {
    rows.push({
      placeholder: `{{metadata.${key}}}`,
      meaning: `“${key}” from the invoking character's own fact sheet (metadata.json)`,
    })
  }

  for (const path of refs.state) {
    rows.push({
      placeholder: `{{state.${path}}}`,
      meaning: `“${path}” from the story's persistent state`,
    })
  }

  return rows
}

/**
 * What this particular tool can quote, and — just as importantly — who gets to
 * quote it. The placeholders belong to the definition's own outcome messages
 * and oracle prompt, which its author writes; what the operator types into the
 * form above is sent verbatim, `{{braces}}` and all. Saying so here is the
 * whole point of the panel: the vocabulary is visible, and so is its boundary.
 */
function ToolReferencePanel({ tool }: Readonly<{ tool: CustomTool }>) {
  const rows = referenceRows(tool)
  const readsMetadata = (tool.references?.metadata.length ?? 0) > 0
  const readsState = (tool.references?.state.length ?? 0) > 0
  // Writes are a different claim than reads, and they get their own sentence:
  // "consults the encounter count" and "changes it" must not blur together.
  const writes = [
    ...(tool.references?.stateWrites ?? []).map((path) => `state.${path}`),
    ...(tool.references?.metadataWrites ?? []).map((key) => `metadata.${key}`),
    ...(tool.references?.progressWrites ?? []).map((id) => `progress.${id}`),
  ]
  // Progressions get their own sentences rather than a placeholder row: the
  // interesting claim is WHICH timed condition the tool consults or adjusts,
  // not which of its dozen derived fields the author happened to quote.
  const readsProgress = tool.references?.progress ?? []
  // The wardrobe, likewise, in its own sentences: dressing, undressing and
  // clearing are three different promises about the running character.
  const wardrobeLines: Array<{ key: string; lead: string; values: string[] }> = [
    { key: 'wears', lead: 'It may dress the running character in', values: tool.references?.wears ?? [] },
    { key: 'takesOff', lead: 'It may undress them of', values: tool.references?.takesOff ?? [] },
    { key: 'clearsSlots', lead: 'It may clear their', values: tool.references?.clearsSlots ?? [] },
  ].filter((line) => line.values.length > 0)
  // And the Inventory: what it reads, and what it may hand them or take away.
  const readsInventory = tool.references?.inventoryReads ?? []
  const readsAggregates = tool.references?.inventoryAggregates ?? []
  const inventoryLines: Array<{ key: string; lead: string; values: string[] }> = [
    { key: 'equips', lead: 'It may equip the running character with', values: tool.references?.equips ?? [] },
    { key: 'unequips', lead: 'It may unequip them of', values: tool.references?.unequips ?? [] },
    { key: 'picksUp', lead: 'It may pick up for them', values: tool.references?.picksUp ?? [] },
  ].filter((line) => line.values.length > 0)

  // A tool that quotes nothing and writes nothing gets no panel. An empty list
  // under a heading promising a list is worse than the heading's absence.
  if (
    rows.length === 0 &&
    writes.length === 0 &&
    readsProgress.length === 0 &&
    wardrobeLines.length === 0 &&
    readsInventory.length === 0 &&
    readsAggregates.length === 0 &&
    inventoryLines.length === 0
  ) {
    return null
  }

  return (
    <details className="rounded-lg qt-border p-5" open>
      <summary className="text-sm font-medium qt-text cursor-pointer list-none flex items-center gap-2">
        <Icon name="info" className="w-4 h-4 qt-text-secondary flex-shrink-0" />
        What this tool can quote
      </summary>

      <p className="text-xs qt-text-secondary mt-3 leading-relaxed">
        Pascal substitutes these when he writes the outcome. They belong to the tool&rsquo;s own
        messages, which its author places on{' '}
        <span className="whitespace-nowrap">Pascal&rsquo;s Workbench</span> — what you type into
        the form above is sent exactly as written, braces and all.
      </p>

      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.placeholder} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt>
              <code className="text-xs font-mono qt-text">{row.placeholder}</code>
            </dt>
            <dd className="text-xs qt-text-secondary min-w-0">{row.meaning}</dd>
          </div>
        ))}
      </dl>

      {(readsMetadata || readsState) && (
        <p className="text-xs qt-text-secondary mt-4 leading-relaxed">
          {readsMetadata && readsState
            ? 'This tool also reads the character sheet and the story state above — a key or path that is missing simply leaves its placeholder standing.'
            : readsMetadata
              ? 'A metadata key the character does not have simply leaves its placeholder standing.'
              : 'A state path that has never been set simply leaves its placeholder standing.'}
        </p>
      )}

      {readsProgress.length > 0 && (
        <p className="text-xs qt-text-secondary mt-4 leading-relaxed">
          It consults your timed progressions:{' '}
          {readsProgress.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <code className="font-mono qt-text">{id}</code>
            </span>
          ))}
          . A progression you are not carrying simply does not match.
        </p>
      )}

      {writes.length > 0 && (
        <p className="text-xs qt-text-secondary mt-4 leading-relaxed">
          When it runs, this tool may also write:{' '}
          {writes.map((target, i) => (
            <span key={target}>
              {i > 0 && ', '}
              <code className="font-mono qt-text">{target}</code>
            </span>
          ))}
          . The record of what actually changed rides with the roll itself.
        </p>
      )}

      {wardrobeLines.map((line) => (
        <p key={line.key} className="text-xs qt-text-secondary mt-4 leading-relaxed">
          {line.lead}{' '}
          {line.values.map((value, i) => (
            <span key={value}>
              {i > 0 && ', '}
              <code className="font-mono qt-text">{value}</code>
            </span>
          ))}
          {line.key === 'clearsSlots' ? (line.values.length > 1 ? ' slots' : ' slot') : ''}
          . Only when you run it as a character — a run made as nobody dresses nobody.
        </p>
      ))}

      {readsInventory.length > 0 && (
        <p className="text-xs qt-text-secondary mt-4 leading-relaxed">
          It reads the inventory for{' '}
          {readsInventory.map((ref, i) => (
            <span key={ref}>
              {i > 0 && ', '}
              <code className="font-mono qt-text">{ref}</code>
            </span>
          ))}
          . Run as nobody, it finds no inventory at all.
        </p>
      )}

      {readsAggregates.length > 0 && (
        <p className="text-xs qt-text-secondary mt-4 leading-relaxed">
          It takes stock of everything they carry, reading{' '}
          {readsAggregates.map((key, i) => (
            <span key={key}>
              {i > 0 && ', '}
              <code className="font-mono qt-text">{key}</code>
            </span>
          ))}
          . Run as nobody, it finds no inventory at all.
        </p>
      )}

      {inventoryLines.map((line) => (
        <p key={line.key} className="text-xs qt-text-secondary mt-4 leading-relaxed">
          {line.lead}{' '}
          {line.values.map((value, i) => (
            <span key={value}>
              {i > 0 && ', '}
              <code className="font-mono qt-text">{value}</code>
            </span>
          ))}
          . Only when you run it as a character — a run made as nobody carries nothing.
        </p>
      ))}
    </details>
  )
}

/** {@link apiErrorMessage} with this dialog's own fallback. */
function extractErrorMessage(err: unknown): string {
  return apiErrorMessage(err, 'The tool could not be run.')
}

export default CustomToolRunDialog
