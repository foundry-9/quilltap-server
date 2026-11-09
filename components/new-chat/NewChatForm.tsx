'use client'

import { useCallback, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { OutfitSelector } from '@/components/wardrobe'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import type { OutfitSelection } from '@/components/wardrobe'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import type { TimestampConfig } from '@/lib/schemas/types'
import { CONCIERGE_STATES, type ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { ConciergeOffDutyHint } from '@/components/chat/ConciergeOffDutyHint'
import {
  CONCIERGE_STATE_PRESENTATION,
  conciergeToneTextClass,
} from '@/lib/services/dangerous-content/concierge-state-presentation'
import { AutonomousRoomCard } from './AutonomousRoomCard'
import type { NewChatAutonomousState } from './types'
import { useNewChatForm } from './NewChatFormContext'
import { ScenarioSelect } from '@/components/scenario/ScenarioSelect'
import { ScenarioBrowserDialog, useScenarioRefBody } from '@/components/scenario/ScenarioBrowserDialog'
import type { ScenarioSelection } from '@/components/scenario/types'
import { SubpromptPicker } from '@/components/subprompts'
import dynamic from 'next/dynamic'
import type {
  SavedScenarioTarget,
} from '@/components/scenario-builder/ScenarioBuilderDialog'
import { STAFF_AVATARS } from '@/lib/chat/staff-display-names'

// Loaded on demand: the builder (and the Markdown renderer behind its thinking
// block) stays out of this surface's bundle until the Host is asked.
const ScenarioBuilderDialog = dynamic(
  () => import('@/components/scenario-builder/ScenarioBuilderDialog').then((m) => m.ScenarioBuilderDialog),
  { ssr: false },
)

interface NewChatFormProps {
  /**
   * Layout only: when true, renders connection-profile, system-prompt and
   * subprompt controls inline for a single LLM character (the modal with its
   * picker collapsed). When false, the picker panel carries those controls.
   */
  showSingleCharacterControls?: boolean
}

/**
 * The New Chat form. Every value it shows and every change it makes goes
 * through {@link useNewChatForm}: what it shows is the server's casting
 * defaults with the operator's overrides laid over them, and each control
 * writes an override — never a default.
 */
export function NewChatForm({ showSingleCharacterControls = false }: NewChatFormProps) {
  const {
    profiles,
    imageProfiles,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setOverrides,
    setAutonomousEnabled,
    project,
    projectScenarios,
    generalScenarios,
    groupScenarios,
    showArchivedScenarios,
    setShowArchivedScenarios,
    roleplayTemplates,
    defaultRoleplayTemplateId,
    availableProjects,
    selectedProjectId,
    setSelectedProjectId,
    creating,
    continuationFromChatId,
    previousOutfitSummary,
    outfitModes,
    autonomousSettingsHint,
    refetchScenarioTiers,
    conciergeOnDuty,
    conciergeDefaultState,
  } = useNewChatForm()
  // A continuation files its project in the dialog's own picker, above.
  const showProjectPicker = !continuationFromChatId
  const { formatCharacterName } = useUserCharacterDisplayName()

  const llmSelected = useMemo(
    () => selectedCharacters.filter((sc) => sc.controlledBy === 'llm'),
    [selectedCharacters]
  )
  const singleLlm = llmSelected.length === 1 ? llmSelected[0] : null

  // The single source of truth for "who the user plays as": the cast member
  // whose `controlledBy` is 'user'. Both the "Play As" dropdown and the picker
  // panel's per-character select read and mutate this same slot.
  const userEntry = useMemo(
    () => selectedCharacters.find((sc) => sc.controlledBy === 'user'),
    [selectedCharacters]
  )
  const hasUserControlled = Boolean(userEntry)

  /**
   * Every scenario on the single LLM character, archived ones included. The
   * character record always carries them (the vault projection sweeps files
   * missing from the array), so the hiding happens here.
   */
  const allCharacterScenarios = useMemo(
    () => (singleLlm ? singleLlm.character.scenarios ?? [] : []),
    [singleLlm],
  )

  const scenarioSelection = state.scenarioSelection
  const selectedCharacterScenarioId =
    scenarioSelection.kind === 'character' ? scenarioSelection.scenarioId : null

  /**
   * What the dropdown offers. Archived scenarios are hidden unless "Show
   * archived" is ticked — with one exception: whatever is currently selected
   * always stays in the list, so an archived pick made a moment ago doesn't
   * blank the select out from under the user.
   */
  const singleCharacterScenarios = useMemo(() => {
    if (!singleLlm) return null
    const visible = allCharacterScenarios.filter(
      (s) => showArchivedScenarios || s.archived !== true || s.id === selectedCharacterScenarioId,
    )
    return visible.length > 0 ? visible : null
  }, [singleLlm, allCharacterScenarios, showArchivedScenarios, selectedCharacterScenarioId])

  // The body behind the one selection, previewed under the dropdown. Looked up
  // against the unfiltered character list: a scenario the form already points
  // at keeps previewing even after it's archived.
  const selectedPresetBody = useMemo((): string | null => {
    switch (scenarioSelection.kind) {
      case 'project':
        return projectScenarios.find((s) => s.path === scenarioSelection.path)?.body ?? null
      case 'general':
        return generalScenarios.find((s) => s.path === scenarioSelection.path)?.body ?? null
      case 'group':
        return (
          groupScenarios.find(
            (s) => s.path === scenarioSelection.path && s.groupId === scenarioSelection.groupId,
          )?.body ?? null
        )
      case 'character':
        return allCharacterScenarios.find((s) => s.id === scenarioSelection.scenarioId)?.content ?? null
      default:
        return null
    }
  }, [scenarioSelection, projectScenarios, generalScenarios, groupScenarios, allCharacterScenarios])

  // A pick from elsewhere carries no body in the option lists; read it by ref.
  const { data: storePreview } = useScenarioRefBody(
    scenarioSelection.kind === 'store' ? scenarioSelection : null,
  )

  const selectedPreset =
    scenarioSelection.kind === 'custom'
      ? null
      : {
          kind: scenarioSelection.kind,
          content:
            scenarioSelection.kind === 'store' ? storePreview?.scenario.body ?? '' : selectedPresetBody ?? '',
        }

  // The character's own default — used to render the override-visibility note
  // when the form is using the project default but the character also has one.
  const characterDefaultScenario = useMemo(() => {
    if (!singleLlm) return undefined
    const id = singleLlm.character.defaultScenarioId
    if (!id) return undefined
    return singleCharacterScenarios?.find((s) => s.id === id)
  }, [singleLlm, singleCharacterScenarios])
  const showOverrideNote = scenarioSelection.kind === 'project' && Boolean(characterDefaultScenario)

  // The scenario is one override — preset and notes together, as the server
  // takes it. Touching either pins both.
  const handleScenarioSelectionChange = (selection: ScenarioSelection) => {
    setOverrides((prev) => ({ ...prev, scenario: { selection, notes: prev.scenario?.notes ?? '' } }))
  }

  const handleScenarioNotesChange = (notes: string) => {
    setOverrides((prev) => {
      if (notes === (prev.scenario?.notes ?? '')) return prev
      return { ...prev, scenario: { selection: prev.scenario?.selection ?? scenarioSelection, notes } }
    })
  }

  // --- The scenario browser ------------------------------------------------
  const [browserOpen, setBrowserOpen] = useState(false)
  const scenarioHierarchy = useMemo(
    () => ({
      projectId: selectedProjectId ?? project?.id ?? null,
      groupIds: [...new Set(groupScenarios.map((s) => s.groupId))],
      characterId: singleLlm?.character.id ?? null,
    }),
    [selectedProjectId, project, groupScenarios, singleLlm],
  )

  // --- The Host's Scenario Builder -----------------------------------------
  const [builderOpen, setBuilderOpen] = useState(false)
  // MarkdownLexicalEditor reads `value` only at mount; a programmatic fill must
  // bump its remountKey or the editor keeps showing the old text.
  const [scenarioEditorKey, setScenarioEditorKey] = useState(0)

  const builderCast = useMemo(
    () => selectedCharacters.map((sc) => ({ id: sc.character.id, name: sc.character.name })),
    [selectedCharacters],
  )
  const builderProjectId = selectedProjectId ?? project?.id ?? null
  const builderProjectName =
    (builderProjectId && availableProjects?.find((p) => p.id === builderProjectId)?.name) ||
    (project && project.id === builderProjectId ? project.name : null)

  const handleUseBuiltScene = (scene: string) => {
    setOverrides((prev) => ({ ...prev, scenario: { selection: { kind: 'custom' }, notes: scene } }))
    setScenarioEditorKey((k) => k + 1)
  }

  // After a save: select the new preset when this form's picker now offers it
  // (checked against the freshly re-read tiers — a tier this surface doesn't
  // show, or a group no LLM cast member belongs to, is not offered; a
  // character's own list only when exactly one LLM character is cast), and
  // clear the custom text it replaces. Otherwise the text stays as custom.
  const handleBuiltSceneSaved = async (target: SavedScenarioTarget) => {
    const fresh = await refetchScenarioTiers()
    let selection: ScenarioSelection | null = null
    if (target.kind === 'general') {
      if (fresh?.general?.some((s) => s.path === target.path)) {
        selection = { kind: 'general', path: target.path }
      }
    } else if (target.kind === 'project' && target.projectId === builderProjectId) {
      if (fresh?.project?.some((s) => s.path === target.path)) {
        selection = { kind: 'project', path: target.path }
      }
    } else if (target.kind === 'group') {
      if (fresh?.group?.some((s) => s.groupId === target.groupId && s.path === target.path)) {
        selection = { kind: 'group', groupId: target.groupId, path: target.path }
      }
    } else if (target.kind === 'character' && singleLlm?.character.id === target.characterId) {
      // The character's scenario list rides on the character record, which this
      // form does not refetch; add the new entry locally so it can be selected.
      setSelectedCharacters((prev) =>
        prev.map((sc) =>
          sc.character.id === target.characterId
            ? {
                ...sc,
                character: {
                  ...sc.character,
                  scenarios: [
                    ...(sc.character.scenarios ?? []),
                    { id: target.scenarioId, title: target.title, content: target.content },
                  ],
                },
              }
            : sc,
        ),
      )
      selection = { kind: 'character', scenarioId: target.scenarioId }
    }
    if (!selection) return
    const picked = selection
    setOverrides((prev) => ({ ...prev, scenario: { selection: picked, notes: '' } }))
    setScenarioEditorKey((k) => k + 1)
  }

  const switchToCharacterDefault = () => {
    if (!characterDefaultScenario) return
    const scenarioId = characterDefaultScenario.id
    setOverrides((prev) => ({ ...prev, scenario: { selection: { kind: 'character', scenarioId }, notes: '' } }))
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

  const handleSingleSubpromptsChange = (ids: string[]) => {
    if (!singleLlm) return
    setSelectedCharacters((prev) =>
      prev.map((sc) =>
        sc.character.id === singleLlm.character.id ? { ...sc, selectedSubpromptIds: ids } : sc
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
    if (userEntry) {
      list.push({
        id: userEntry.character.id,
        name: userEntry.character.name,
        isUserControlled: true,
      })
    }
    return list
  }, [llmSelected, userEntry])

  // "Play As" options: only characters already in the cast. Any added character
  // can take the user's chair, and default-user personas now appear in the
  // picker on the left, so they enter the cast the same way as everyone else
  // rather than being pulled in from a separate roster here.
  const playAsOptions = useMemo(
    () =>
      selectedCharacters.map((sc) => ({
        id: sc.character.id,
        label: formatCharacterName(sc.character),
      })),
    [selectedCharacters, formatCharacterName]
  )

  // Mark one cast member as the user's persona, in place. Any prior user entry
  // is handed back to the LLM with its profile cleared (matching
  // CharacterPickerPanel.handleProfileChange, so the submit guard will ask for a
  // profile again). Every option comes from the cast, so there is nothing to
  // pull in or remove.
  const handlePlayAsChange = useCallback(
    (nextId: string) => {
      setSelectedCharacters((prev) => {
        const reverted = prev.map((sc) =>
          sc.controlledBy === 'user'
            ? { ...sc, controlledBy: 'llm' as const, connectionProfileId: '' }
            : sc
        )
        if (nextId === '') return reverted // "Chat as yourself"
        return reverted.map((sc) =>
          sc.character.id === nextId
            ? { ...sc, controlledBy: 'user' as const, connectionProfileId: '' }
            : sc
        )
      })
    },
    [setSelectedCharacters]
  )

  // The selector reports only the seats the operator changed; the rest take
  // the server's mode, so they are left out of the request.
  const handleOutfitSelectionsChange = useCallback(
    (selections: OutfitSelection[]) => {
      setOverrides((prev) => {
        if (selections.length === 0) {
          if (!prev.outfitSelections) return prev
          const next = { ...prev }
          delete next.outfitSelections
          return next
        }
        return { ...prev, outfitSelections: selections }
      })
    },
    [setOverrides]
  )

  const handleRoleplayTemplateChange = useCallback(
    (value: string) => {
      setOverrides((prev) => ({ ...prev, roleplayTemplateId: value || null }))
    },
    [setOverrides]
  )

  const handleImageProfileChange = useCallback(
    (id: string | null) => {
      setOverrides((prev) => ({ ...prev, imageProfileId: id || null }))
    },
    [setOverrides]
  )

  const handleConciergeStateChange = useCallback(
    (next: ConciergeState) => {
      setOverrides((prev) => ({ ...prev, conciergeState: next }))
    },
    [setOverrides]
  )

  // Label, icon, tone and helper sentence all come from the shared presentation
  // table — the same one the Salon sidebar's control reads — so a copy edit
  // lands on both. The `hint` ("Change it from the Salon sidebar…") is
  // deliberately not shown: the reader is looking at the control that sets it.
  const conciergePresentation = CONCIERGE_STATE_PRESENTATION[state.conciergeState]

  const isAutonomous = state.autonomous.enabled
  const updateAutonomous = useCallback(
    (patch: Partial<NewChatAutonomousState>) => {
      const { enabled, ...fields } = patch
      if (enabled !== undefined) setAutonomousEnabled(enabled)
      if (Object.keys(fields).length === 0) return
      setOverrides((prev) => ({ ...prev, autonomous: { ...prev.autonomous, ...fields } }))
    },
    [setOverrides, setAutonomousEnabled]
  )

  const handleTimestampConfigChange = useCallback(
    (config: TimestampConfig) => {
      setOverrides((prev) => ({ ...prev, timestampConfig: config }))
    },
    [setOverrides]
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
            onChange={(e) => setAutonomousEnabled(e.target.checked)}
            className="qt-checkbox mt-1"
            disabled={creating || hasUserControlled}
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
        {hasUserControlled && !isAutonomous && (
          <p className="mt-2 qt-text-xs qt-text-warning">
            A character is set to Play As (user). Autonomous rooms have no user —
            revert it to &ldquo;Chat as yourself&rdquo; to enable.
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
              <Link href="/settings?group=connections" className="underline hover:no-underline">
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

        {showSingleCharacterControls && singleLlm && (
          <div>
            <label className="mb-2 block text-sm qt-text-primary">Subprompts</label>
            <SubpromptPicker
              characterId={singleLlm.character.id}
              characterName={singleLlm.character.name}
              selectedIds={singleLlm.selectedSubpromptIds ?? []}
              onChange={handleSingleSubpromptsChange}
              disabled={creating}
            />
          </div>
        )}

        {!isAutonomous && playAsOptions.length > 0 && (
          <div>
            <label htmlFor="new-chat-partner" className="mb-2 block text-sm qt-text-primary">
              Play As (Optional)
            </label>
            <select
              id="new-chat-partner"
              value={userEntry?.character.id ?? ''}
              onChange={(e) => handlePlayAsChange(e.target.value)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">Chat as yourself</option>
              {playAsOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {roleplayTemplates.length > 0 && (
          <div>
            <label htmlFor="new-chat-roleplay-template" className="mb-2 block text-sm qt-text-primary">
              Roleplay Template
            </label>
            <select
              id="new-chat-roleplay-template"
              value={state.roleplayTemplateId ?? ''}
              onChange={(e) => handleRoleplayTemplateChange(e.target.value)}
              disabled={creating}
              className="qt-select"
            >
              <option value="">
                No Template{defaultRoleplayTemplateId === null ? ' (default)' : ''}
              </option>
              {roleplayTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isBuiltIn ? ' (Built-in)' : ''}
                  {template.id === defaultRoleplayTemplateId ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <p className="qt-text-xs qt-text-muted mt-1">
              Sets how prose, dialogue, and asides are dressed for this conversation. You may
              change your mind later from the chat&rsquo;s own sidebar.
            </p>
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
              userCharacterId={userEntry?.character.id}
            />
          ) : (
            <p className="qt-text-xs qt-text-muted">
              No image profiles configured.
            </p>
          )}
        </div>

        {/* The Concierge — settle the chat's state before the first word is
            spoken, so the opening greeting is generated under it. */}
        <div>
          <label htmlFor="new-chat-concierge" className="mb-2 block text-sm qt-text-primary">
            <span className="flex items-center gap-1.5">
              The Concierge
              <Icon
                name={conciergePresentation.icon}
                className={`w-3.5 h-3.5 ${conciergeToneTextClass(conciergePresentation.tone)}`}
              />
            </span>
          </label>
          <select
            id="new-chat-concierge"
            value={state.conciergeState}
            onChange={(e) => handleConciergeStateChange(e.target.value as ConciergeState)}
            disabled={creating || !conciergeOnDuty}
            className="qt-select"
          >
            {CONCIERGE_STATES.map((value) => (
              <option key={value} value={value}>
                {CONCIERGE_STATE_PRESENTATION[value].label}{value === conciergeDefaultState ? ' (default)' : ''}
              </option>
            ))}
          </select>
          {conciergeOnDuty ? (
            <p className="qt-text-xs qt-text-muted mt-1">{conciergePresentation.detail}</p>
          ) : (
            <ConciergeOffDutyHint className="block qt-text-xs qt-text-muted mt-1" />
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="new-chat-scenario-select" className="block text-sm qt-text-primary">
              Starting Scenario (Optional)
            </label>
            <button
              type="button"
              onClick={() => setBuilderOpen(true)}
              disabled={creating || profiles.length === 0}
              className="qt-button-secondary qt-button-sm inline-flex items-center gap-1.5"
            >
              <img
                src={STAFF_AVATARS.host ?? '/images/avatars/host-avatar.webp'}
                alt=""
                className="h-4 w-4 rounded-full"
              />
              Ask the Host to set the scene
            </button>
          </div>
          <ScenarioSelect
            id="new-chat-scenario-select"
            selection={scenarioSelection}
            onChange={handleScenarioSelectionChange}
            onBrowse={() => setBrowserOpen(true)}
            projectScenarios={projectScenarios}
            generalScenarios={generalScenarios}
            groupScenarios={groupScenarios}
            characterScenarios={singleCharacterScenarios}
            characterDefaultScenarioId={singleLlm?.character.defaultScenarioId ?? null}
            disabled={creating}
          />
          {browserOpen && (
            <ScenarioBrowserDialog
              isOpen={browserOpen}
              onClose={() => setBrowserOpen(false)}
              hierarchy={scenarioHierarchy}
              onPick={handleScenarioSelectionChange}
            />
          )}
          <label className="mb-2 flex items-center gap-2 text-xs qt-text-muted">
            <input
              type="checkbox"
              checked={showArchivedScenarios}
              onChange={(e) => setShowArchivedScenarios(e.target.checked)}
              disabled={creating}
              className="qt-checkbox"
            />
            Show archived
          </label>
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
          {selectedPreset && selectedPreset.content && (
            <div className="rounded-lg border qt-border-default qt-bg-muted/40 px-3 py-2 text-sm qt-text-secondary whitespace-pre-wrap">
              {selectedPreset.content}
            </div>
          )}
          {selectedPreset && (
            <p className="mb-1 mt-2 text-xs qt-text-muted">
              Your notes here are added beneath the scenario above.
            </p>
          )}
          <MarkdownLexicalEditor
            value={state.scenario}
            onChange={handleScenarioNotesChange}
            disabled={creating}
            remountKey={scenarioEditorKey}
            namespace="NewChatForm.scenario"
            ariaLabel={selectedPreset ? 'Additional scenario notes' : 'Starting scenario'}
            minHeight="6rem"
          />
          {builderOpen && (
            <ScenarioBuilderDialog
              isOpen={builderOpen}
              onClose={() => setBuilderOpen(false)}
              cast={builderCast}
              projectId={builderProjectId}
              projectName={builderProjectName}
              onUse={handleUseBuiltScene}
              onSaved={handleBuiltSceneSaved}
            />
          )}
        </div>

        {outfitCharacters.length > 0 && (
          <OutfitSelector
            characters={outfitCharacters}
            onSelectionsChange={handleOutfitSelectionsChange}
            disabled={creating}
            sourceChatId={continuationFromChatId}
            previousOutfitSummary={previousOutfitSummary}
            defaultModes={outfitModes}
            projectId={selectedProjectId}
          />
        )}

        {!isAutonomous && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.avatarGenerationEnabled}
                onChange={(e) =>
                  setOverrides((prev) => ({ ...prev, avatarGenerationEnabled: e.target.checked }))
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

      {showProjectPicker && availableProjects.length > 0 ? (
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
              <Icon name="folder" className="w-3 h-3 qt-text-secondary" />
            </div>
            <select
              id="new-chat-project-select"
              value={selectedProjectId ?? ''}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
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
              <Icon name="folder" className="w-3 h-3 qt-text-secondary" />
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
