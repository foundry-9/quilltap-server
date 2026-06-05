'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { OutfitSelector } from '@/components/wardrobe'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import type { OutfitSelection, PreviousOutfitSummary } from '@/components/wardrobe'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'
import { Cron } from 'croner'
import type {
  ConnectionProfile,
  GeneralScenarioOption,
  ImageProfile,
  NewChatAutonomousState,
  NewChatFormState,
  Project,
  ProjectScenarioOption,
  SelectedCharacter,
  UserControlledCharacter,
} from './types'
import type { ProjectListEntry } from './hooks/useNewChat'
import {
  CUSTOM_SCENARIO_VALUE,
  GENERAL_SCENARIO_PREFIX,
  PROJECT_SCENARIO_PREFIX,
} from './types'

interface NewChatFormProps {
  profiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  userControlledCharacters: UserControlledCharacter[]
  selectedCharacters: SelectedCharacter[]
  setSelectedCharacters: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  state: NewChatFormState
  setState: React.Dispatch<React.SetStateAction<NewChatFormState>>
  project: Project | null
  /** Project scenarios from `/api/v1/projects/[id]/scenarios`; empty when no project. */
  projectScenarios?: ProjectScenarioOption[]
  /** General scenarios from `/api/v1/scenarios`; fetched for every non-help chat. */
  generalScenarios?: GeneralScenarioOption[]
  /**
   * In-form project picker plumbing. When `availableProjects` is non-empty and
   * `onSelectedProjectIdChange` is supplied, the form renders a dropdown so the
   * user can file the chat under any of their projects (or none) at submit
   * time. Callers that render their own picker (NewChatModal's continuation
   * mode) can omit these.
   */
  availableProjects?: ProjectListEntry[]
  selectedProjectId?: string | null
  onSelectedProjectIdChange?: (id: string | null) => void
  creating: boolean
  /**
   * When true, renders connection-profile and system-prompt selects inline for a
   * single LLM-controlled character (used by the modal when the picker is collapsed).
   * When false, the caller is expected to render those controls in a picker panel.
   */
  showSingleCharacterControls?: boolean
  /**
   * Continuation mode: source chat ID forwarded to OutfitSelector so it can
   * render the "Same as last conversation" option and default to it.
   */
  continuationFromChatId?: string | null
  /**
   * Continuation mode: per-character per-slot preview of what each
   * character was wearing at the end of the source chat.
   */
  previousOutfitSummary?: PreviousOutfitSummary | null
  /**
   * Optional hints from the user's chat_settings.autonomousRoomSettings.
   * Used to label "Inherit" radio with the current default, and to disable
   * the destructive-tools checkbox when the user-level policy is the
   * always-refuse ceiling.
   */
  autonomousSettingsHint?: {
    visibilityDefault?: 'owner_only' | 'household' | 'open'
    destructiveToolPolicy?: 'always_refuse' | 'opt_in_per_room'
    defaultFreshnessHours?: number
  }
}

export function NewChatForm({
  profiles,
  imageProfiles,
  userControlledCharacters,
  selectedCharacters,
  setSelectedCharacters,
  state,
  setState,
  project,
  projectScenarios = [],
  generalScenarios = [],
  availableProjects,
  selectedProjectId,
  onSelectedProjectIdChange,
  creating,
  showSingleCharacterControls = false,
  continuationFromChatId,
  previousOutfitSummary,
  autonomousSettingsHint,
}: NewChatFormProps) {
  const { formatCharacterName } = useUserCharacterDisplayName()

  const llmSelected = useMemo(
    () => selectedCharacters.filter((sc) => sc.controlledBy === 'llm'),
    [selectedCharacters]
  )
  const singleLlm = llmSelected.length === 1 ? llmSelected[0] : null

  const singleCharacterScenarios = useMemo(() => {
    if (!singleLlm) return null
    const s = singleLlm.character.scenarios
    return s && s.length > 0 ? s : null
  }, [singleLlm])

  const hasProjectScenarios = projectScenarios.length > 0
  const hasGeneralScenarios = generalScenarios.length > 0
  const hasCharacterScenarios = singleCharacterScenarios && singleCharacterScenarios.length > 0
  const showScenarioDropdown = hasProjectScenarios || hasGeneralScenarios || hasCharacterScenarios

  const selectedProjectScenario = state.projectScenarioPath
    ? projectScenarios.find((s) => s.path === state.projectScenarioPath)
    : undefined
  const selectedGeneralScenario = state.generalScenarioPath
    ? generalScenarios.find((s) => s.path === state.generalScenarioPath)
    : undefined
  const selectedCharacterScenario = state.scenarioId
    ? singleCharacterScenarios?.find((s) => s.id === state.scenarioId)
    : undefined
  const selectedPreset = selectedProjectScenario
    ? { kind: 'project' as const, content: selectedProjectScenario.body }
    : selectedGeneralScenario
      ? { kind: 'general' as const, content: selectedGeneralScenario.body }
      : selectedCharacterScenario
        ? { kind: 'character' as const, content: selectedCharacterScenario.content }
        : null
  const showCustomTextarea = !selectedPreset

  // The character's own default — used to render the override-visibility note
  // when the form is currently using the project default but the character
  // also has one.
  const characterDefaultScenario = useMemo(() => {
    if (!singleLlm) return undefined
    const id = singleLlm.character.defaultScenarioId
    if (!id) return undefined
    return singleCharacterScenarios?.find((s) => s.id === id)
  }, [singleLlm, singleCharacterScenarios])
  const showOverrideNote =
    Boolean(selectedProjectScenario) &&
    Boolean(characterDefaultScenario)

  const dropdownValue = selectedProjectScenario
    ? `${PROJECT_SCENARIO_PREFIX}${selectedProjectScenario.path}`
    : selectedGeneralScenario
      ? `${GENERAL_SCENARIO_PREFIX}${selectedGeneralScenario.path}`
      : selectedCharacterScenario
        ? selectedCharacterScenario.id
        : CUSTOM_SCENARIO_VALUE

  const handleScenarioSelectChange = (value: string) => {
    if (value === CUSTOM_SCENARIO_VALUE || value === '') {
      setState((prev) => ({
        ...prev,
        scenarioId: null,
        projectScenarioPath: null,
        generalScenarioPath: null,
      }))
      return
    }
    if (value.startsWith(PROJECT_SCENARIO_PREFIX)) {
      const path = value.slice(PROJECT_SCENARIO_PREFIX.length)
      setState((prev) => ({
        ...prev,
        projectScenarioPath: path,
        generalScenarioPath: null,
        scenarioId: null,
        scenario: '',
      }))
      return
    }
    if (value.startsWith(GENERAL_SCENARIO_PREFIX)) {
      const path = value.slice(GENERAL_SCENARIO_PREFIX.length)
      setState((prev) => ({
        ...prev,
        generalScenarioPath: path,
        projectScenarioPath: null,
        scenarioId: null,
        scenario: '',
      }))
      return
    }
    // Character scenario UUID
    setState((prev) => ({
      ...prev,
      scenarioId: value,
      projectScenarioPath: null,
      generalScenarioPath: null,
      scenario: '',
    }))
  }

  const switchToCharacterDefault = () => {
    if (!characterDefaultScenario) return
    setState((prev) => ({
      ...prev,
      scenarioId: characterDefaultScenario.id,
      projectScenarioPath: null,
      generalScenarioPath: null,
      scenario: '',
    }))
  }

  const handleSingleProfileChange = (profileId: string) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, connectionProfileId: profileId } : sc
      )
    )
  }

  const handleSingleSystemPromptChange = (promptId: string | null) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, selectedSystemPromptId: promptId } : sc
      )
    )
  }

  const singleCharacterId = singleLlm?.character.id
  const characterIdForImage = singleCharacterId || selectedCharacters[0]?.character.id || undefined

  const outfitCharacters = useMemo(() => {
    const list = llmSelected.map((sc) => ({
      id: sc.character.id,
      name: sc.character.name,
      isUserControlled: false,
    }))
    const userChar = userControlledCharacters.find((c) => c.id === state.selectedUserCharacterId)
    if (userChar) {
      list.push({ id: userChar.id, name: userChar.name, isUserControlled: true })
    }
    return list
  }, [llmSelected, userControlledCharacters, state.selectedUserCharacterId])

  const handleOutfitSelectionsChange = useCallback(
    (selections: OutfitSelection[]) => {
      setState((prev) => ({ ...prev, outfitSelections: selections }))
    },
    [setState]
  )

  const handleImageProfileChange = useCallback(
    (id: string | null) => {
      setState((prev) => ({ ...prev, imageProfileId: id || '' }))
    },
    [setState]
  )

  const isAutonomous = state.autonomous.enabled
  const updateAutonomous = useCallback(
    (patch: Partial<NewChatAutonomousState>) => {
      setState((prev) => ({
        ...prev,
        autonomous: { ...prev.autonomous, ...patch },
      }))
    },
    [setState]
  )

  const handleAutonomousToggle = useCallback(
    (next: boolean) => {
      setState((prev) => ({
        ...prev,
        autonomous: { ...prev.autonomous, enabled: next },
        // Strip the Play-As selection when flipping into autonomous mode —
        // autonomous rooms have no user. We leave it alone if flipping back.
        selectedUserCharacterId: next ? '' : prev.selectedUserCharacterId,
      }))
    },
    [setState]
  )

  const handleTimestampConfigChange = useCallback(
    (config: TimestampConfig) => {
      setState((prev) => ({ ...prev, timestampConfig: config }))
    },
    [setState]
  )

  const showSystemPromptDropdown =
    showSingleCharacterControls &&
    singleLlm &&
    singleLlm.character.systemPrompts &&
    singleLlm.character.systemPrompts.length > 1

  return (
    <div className="new-chat-form grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
      {/* Autonomous toggle (spans both columns) */}
      <div className="md:col-span-2 rounded-xl border qt-border-default qt-bg-card/60 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isAutonomous}
            onChange={(e) => handleAutonomousToggle(e.target.checked)}
            className="qt-checkbox mt-1"
            disabled={creating}
          />
          <span>
            <span className="font-medium text-foreground">Make this an autonomous room</span>
            <span className="block qt-text-xs qt-text-muted mt-1">
              Autonomous rooms run when scheduled or started manually. They have no human user, no
              composer, and pause for nobody.{' '}
              <Link href="/help/autonomous-rooms" className="underline hover:no-underline qt-text-primary">
                Learn more
              </Link>
              .
            </span>
          </span>
        </label>
        {isAutonomous && state.selectedUserCharacterId && (
          <p className="mt-2 qt-text-xs qt-text-warning">
            User character will be removed on submit — autonomous rooms have no user.
          </p>
        )}
      </div>

      {/* Left card: Character Customization */}
      <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-4">
        <h3 className="qt-section-title">Character Customization</h3>

        {profiles.length === 0 && (
          <div className="rounded-lg border qt-border-warning/50 qt-bg-warning/10 p-3 qt-text-warning">
            <p className="qt-label">No connection profiles available</p>
            <p className="mt-1 qt-body-sm">
              <Link href="/settings?tab=providers" className="underline hover:no-underline">
                Add an AI provider
              </Link>{' '}
              to start a chat.
            </p>
          </div>
        )}

        {showSingleCharacterControls && singleLlm && (
          <div>
            <label htmlFor="new-chat-profile" className="mb-2 block text-sm qt-text-primary">
              Connection Profile *
            </label>
            <select
              id="new-chat-profile"
              value={singleLlm.connectionProfileId}
              onChange={(e) => handleSingleProfileChange(e.target.value)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">Select a profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.modelName ? ` (${profile.modelName})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {showSystemPromptDropdown && singleLlm && (
          <div>
            <label htmlFor="new-chat-system-prompt" className="mb-2 block text-sm qt-text-primary">
              System Prompt
            </label>
            <select
              id="new-chat-system-prompt"
              value={singleLlm.selectedSystemPromptId || ''}
              onChange={(e) => handleSingleSystemPromptChange(e.target.value || null)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">Use Default</option>
              {singleLlm.character.systemPrompts!.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                  {prompt.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isAutonomous && userControlledCharacters.length > 0 && (
          <div>
            <label htmlFor="new-chat-partner" className="mb-2 block text-sm qt-text-primary">
              Play As (Optional)
            </label>
            <select
              id="new-chat-partner"
              value={state.selectedUserCharacterId}
              onChange={(e) =>
                setState((prev) => ({ ...prev, selectedUserCharacterId: e.target.value }))
              }
              disabled={creating}
              className="qt-select"
            >
              <option value="">Chat as yourself</option>
              {userControlledCharacters.map((char) => (
                <option key={char.id} value={char.id}>
                  {formatCharacterName(char)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm qt-text-primary">
            Image Generation Profile (Optional)
          </label>
          {imageProfiles.length > 0 ? (
            <ImageProfilePicker
              value={state.imageProfileId || null}
              onChange={handleImageProfileChange}
              characterId={characterIdForImage}
              userCharacterId={state.selectedUserCharacterId}
            />
          ) : (
            <p className="qt-text-xs qt-text-muted">
              No image profiles configured.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-chat-scenario" className="mb-2 block text-sm qt-text-primary">
            Starting Scenario (Optional)
          </label>
          {showScenarioDropdown && (
            <select
              id="new-chat-scenario-select"
              value={dropdownValue}
              onChange={(e) => handleScenarioSelectChange(e.target.value)}
              disabled={creating}
              className="qt-select mb-2"
            >
              <option value={CUSTOM_SCENARIO_VALUE}>Custom...</option>
              {hasProjectScenarios && (
                <optgroup label="Project Scenarios">
                  {projectScenarios.map((s) => (
                    <option key={`project:${s.path}`} value={`${PROJECT_SCENARIO_PREFIX}${s.path}`}>
                      {s.name}
                      {s.isDefault ? ' (project default)' : ''}
                      {s.description ? ` — ${s.description}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {hasGeneralScenarios && (
                <optgroup label="General Scenarios">
                  {generalScenarios.map((s) => (
                    <option key={`general:${s.path}`} value={`${GENERAL_SCENARIO_PREFIX}${s.path}`}>
                      {s.name}
                      {s.isDefault ? ' (general default)' : ''}
                      {s.description ? ` — ${s.description}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {hasCharacterScenarios && (
                <optgroup label="Character Scenarios">
                  {singleCharacterScenarios!.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {singleLlm?.character.defaultScenarioId === s.id ? ' (character default)' : ''}
                      {s.description ? ` — ${s.description}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {showOverrideNote && characterDefaultScenario && (
            <p className="mb-2 text-xs qt-text-muted">
              Using the project default. Character default:{' '}
              <button
                type="button"
                onClick={switchToCharacterDefault}
                className="underline hover:no-underline qt-text-primary"
                disabled={creating}
              >
                {characterDefaultScenario.title}
              </button>{' '}
              — click to switch.
            </p>
          )}
          {selectedPreset && (
            <div className="rounded-lg border qt-border-default qt-bg-muted/40 px-3 py-2 text-sm qt-text-secondary whitespace-pre-wrap">
              {selectedPreset.content}
            </div>
          )}
          {showCustomTextarea && (
            <MarkdownLexicalEditor
              value={state.scenario}
              onChange={(value) => setState((prev) => ({ ...prev, scenario: value }))}
              disabled={creating}
              namespace="NewChatForm.scenario"
              ariaLabel="Starting scenario"
              minHeight="6rem"
            />
          )}
        </div>

        {outfitCharacters.length > 0 && (
          <OutfitSelector
            characters={outfitCharacters}
            onSelectionsChange={handleOutfitSelectionsChange}
            disabled={creating}
            sourceChatId={continuationFromChatId ?? null}
            previousOutfitSummary={previousOutfitSummary ?? null}
          />
        )}

        {!isAutonomous && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.avatarGenerationEnabled}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, avatarGenerationEnabled: e.target.checked }))
                }
                className="qt-checkbox"
                disabled={creating}
              />
              <span className="qt-text-small">Auto-generate character avatars</span>
            </label>
            <p className="qt-text-xs qt-text-muted mt-1">
              Generate new portraits when outfits change (uses image API)
            </p>
          </div>
        )}
      </div>

      {/* Right card: Reality Injection Mode (chat) or Autonomous Room (autonomous) */}
      {isAutonomous ? (
        <AutonomousRoomCard
          value={state.autonomous}
          onChange={updateAutonomous}
          settingsHint={autonomousSettingsHint}
          disabled={creating}
        />
      ) : (
        <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-4">
          <h3 className="qt-section-title">Reality Injection Mode</h3>
          <TimestampConfigCard
            value={state.timestampConfig}
            onChange={handleTimestampConfigChange}
            compact
            disabled={creating}
          />
        </div>
      )}

      {onSelectedProjectIdChange && availableProjects && availableProjects.length > 0 ? (
        <div className="md:col-span-2 rounded-lg border qt-border-default qt-bg-card/50 p-3 space-y-2">
          <label htmlFor="new-chat-project-select" className="qt-text-xs qt-text-muted">
            File this chat under a project
          </label>
          <div className="flex items-center gap-3">
            <div
              className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor:
                  availableProjects.find((p) => p.id === selectedProjectId)?.color || 'var(--muted)',
              }}
            >
              <svg className="w-3 h-3 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <select
              id="new-chat-project-select"
              value={selectedProjectId ?? ''}
              onChange={(e) => onSelectedProjectIdChange(e.target.value || null)}
              disabled={creating}
              className="qt-select flex-1 min-w-0"
            >
              <option value="">— None (General) —</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : project ? (
        <div className="md:col-span-2 rounded-lg border qt-border-default qt-bg-card/50 p-3">
          <div className="flex items-center gap-3">
            <div
              className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: project.color || 'var(--muted)' }}
            >
              <svg className="w-3 h-3 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="qt-text-xs qt-text-muted">In project</p>
              <p className="qt-body truncate">{project.name}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ============================================================================
// AutonomousRoomCard — schedule, budget, visibility, destructive-tool inputs
// ============================================================================

interface AutonomousRoomCardProps {
  value: NewChatAutonomousState
  onChange: (patch: Partial<NewChatAutonomousState>) => void
  settingsHint?: {
    visibilityDefault?: 'owner_only' | 'household' | 'open'
    destructiveToolPolicy?: 'always_refuse' | 'opt_in_per_room'
    defaultFreshnessHours?: number
  }
  disabled: boolean
}

function tryCronNextRun(expr: string): { ok: true; next: Date | null } | { ok: false; error: string } {
  const trimmed = expr.trim()
  if (!trimmed) return { ok: true, next: null }
  try {
    const job = new Cron(trimmed)
    const next = job.nextRun(new Date())
    return { ok: true, next: next ?? null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid cron' }
  }
}

function visibilityDefaultLabel(v?: 'owner_only' | 'household' | 'open'): string {
  switch (v) {
    case 'household': return 'household'
    case 'open': return 'open'
    case 'owner_only':
    default: return 'owner only'
  }
}

function AutonomousRoomCard({ value, onChange, settingsHint, disabled }: AutonomousRoomCardProps) {
  const cronResult = useMemo(() => tryCronNextRun(value.scheduleCron), [value.scheduleCron])
  const policyAlwaysRefuse = settingsHint?.destructiveToolPolicy === 'always_refuse'
  const freshnessPlaceholder = settingsHint?.defaultFreshnessHours
    ? `${settingsHint.defaultFreshnessHours} (your default)`
    : '12'

  const setNumber = (field: keyof NewChatAutonomousState, raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      onChange({ [field]: null } as Partial<NewChatAutonomousState>)
      return
    }
    const parsed = field === 'budgetEstimatedSpendCapUSD'
      ? Number.parseFloat(trimmed)
      : Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      onChange({ [field]: null } as Partial<NewChatAutonomousState>)
      return
    }
    onChange({ [field]: parsed } as Partial<NewChatAutonomousState>)
  }

  return (
    <div className="rounded-xl border qt-border-default qt-bg-card p-6 space-y-5">
      <h3 className="qt-section-title">Autonomous Room</h3>

      <div>
        <label htmlFor="autonomous-cron" className="mb-2 block text-sm qt-text-primary">
          Schedule (cron, optional)
        </label>
        <input
          id="autonomous-cron"
          type="text"
          value={value.scheduleCron}
          onChange={(e) => onChange({ scheduleCron: e.target.value })}
          disabled={disabled}
          placeholder="0 4 * * *"
          className="qt-input font-mono"
        />
        <p className="mt-1 qt-text-xs qt-text-muted">
          Five-field cron in instance-local time (minute hour dom month dow). Leave blank to run only when started manually.
        </p>
        {value.scheduleCron.trim().length > 0 && (
          cronResult.ok ? (
            cronResult.next ? (
              <p className="mt-1 qt-text-xs qt-text-secondary">
                Next run: {cronResult.next.toLocaleString()}
              </p>
            ) : (
              <p className="mt-1 qt-text-xs qt-text-muted">
                Parses, but never fires from now.
              </p>
            )
          ) : (
            <p className="mt-1 qt-text-xs qt-text-destructive">
              Invalid cron: {cronResult.error}
            </p>
          )
        )}
      </div>

      <div>
        <label htmlFor="autonomous-freshness" className="mb-2 block text-sm qt-text-primary">
          Catch-up freshness window (hours)
        </label>
        <input
          id="autonomous-freshness"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value.scheduleFreshnessHours == null ? '' : String(value.scheduleFreshnessHours)}
          onChange={(e) => setNumber('scheduleFreshnessHours', e.target.value)}
          disabled={disabled}
          placeholder={freshnessPlaceholder}
          className="qt-input w-32"
        />
        <p className="mt-1 qt-text-xs qt-text-muted">
          How long after a missed scheduled slot the scheduler should still consider catching up. Blank = your default.
        </p>
      </div>

      <div>
        <p className="mb-2 block text-sm qt-text-primary">Budget caps (per run)</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="autonomous-budget-turns" className="block qt-text-xs qt-text-muted mb-1">Max turns</label>
            <input
              id="autonomous-budget-turns"
              type="text"
              inputMode="numeric"
              value={value.budgetMaxTurns == null ? '' : String(value.budgetMaxTurns)}
              onChange={(e) => setNumber('budgetMaxTurns', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input"
            />
          </div>
          <div>
            <label htmlFor="autonomous-budget-tokens" className="block qt-text-xs qt-text-muted mb-1">Max tokens</label>
            <input
              id="autonomous-budget-tokens"
              type="text"
              inputMode="numeric"
              value={value.budgetMaxTokens == null ? '' : String(value.budgetMaxTokens)}
              onChange={(e) => setNumber('budgetMaxTokens', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input"
            />
          </div>
          <div>
            <label htmlFor="autonomous-budget-wall" className="block qt-text-xs qt-text-muted mb-1">Max wall-clock (min)</label>
            <input
              id="autonomous-budget-wall"
              type="text"
              inputMode="numeric"
              value={value.budgetMaxWallClockMinutes == null ? '' : String(value.budgetMaxWallClockMinutes)}
              onChange={(e) => setNumber('budgetMaxWallClockMinutes', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input"
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <label htmlFor="autonomous-budget-spend" className="block qt-text-xs qt-text-muted mb-1">Spend cap (USD, optional)</label>
            <input
              id="autonomous-budget-spend"
              type="text"
              inputMode="decimal"
              value={value.budgetEstimatedSpendCapUSD == null ? '' : String(value.budgetEstimatedSpendCapUSD)}
              onChange={(e) => setNumber('budgetEstimatedSpendCapUSD', e.target.value)}
              disabled={disabled}
              placeholder="(none)"
              className="qt-input w-40"
            />
          </div>
        </div>
        <p className="mt-1 qt-text-xs qt-text-muted">
          The first cap to hit ends the run. Leave any blank to skip that cap.
        </p>
      </div>

      <div>
        <p className="mb-2 block text-sm qt-text-primary">Visibility</p>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility == null}
              onChange={() => onChange({ runVisibility: null })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">
              Inherit your default <span className="qt-text-muted">(currently: {visibilityDefaultLabel(settingsHint?.visibilityDefault)})</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility === 'owner_only'}
              onChange={() => onChange({ runVisibility: 'owner_only' })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">Owner only — hidden from the main Salon list</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility === 'household'}
              onChange={() => onChange({ runVisibility: 'household' })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">Household — visible per chat-sharing rules</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomous-visibility"
              checked={value.runVisibility === 'open'}
              onChange={() => onChange({ runVisibility: 'open' })}
              disabled={disabled}
              className="qt-radio mt-1"
            />
            <span className="qt-text-small">Open — always visible in the Salon list</span>
          </label>
        </div>
      </div>

      <div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.runDestructiveToolsAllowed && !policyAlwaysRefuse}
            onChange={(e) => onChange({ runDestructiveToolsAllowed: e.target.checked })}
            disabled={disabled || policyAlwaysRefuse}
            className="qt-checkbox mt-1"
          />
          <span>
            <span className="qt-text-small font-medium text-foreground">Pre-authorize destructive tools</span>
            <span className="block qt-text-xs qt-text-muted mt-1">
              Allows tools like <code>doc_delete_file</code> and <code>doc_delete_folder</code> in this room.
              {policyAlwaysRefuse && (
                <> Your user-level policy is set to <em>always refuse</em>; this cannot be overridden per room.</>
              )}
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
