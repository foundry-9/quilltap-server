'use client'

/**
 * useNewChat — the New Chat dialog's data and form state.
 *
 * Reference data rides TanStack Query (shared caches with the rest of the app;
 * keys only from `queryKeys`). What the chat would get if the operator changed
 * nothing comes from the server's `?action=casting-defaults` read, keyed by the
 * cast — the client never re-derives a precedence chain. The form shows
 * `defaults ⊕ overrides`, and the create request carries the cast plus the
 * overrides alone: an absent key means "use the default", which is exactly
 * what the form showed.
 *
 * Design of record: docs/developer/features/refactor-green-room-and-opening.md (D8)
 *
 * @module components/new-chat/hooks/useNewChat
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { withArchivedParam } from '@/components/scenarios/archived-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useRealtimeTopic } from '@/hooks/useRealtime'
import type {
  Character,
  ConnectionProfile,
  GeneralScenarioOption,
  GroupScenarioOption,
  ImageProfile,
  NewChatAutonomousState,
  NewChatFormState,
  NewChatOverrides,
  Project,
  ProjectScenarioOption,
  RoleplayTemplateOption,
  SelectedCharacter,
  UserControlledCharacter,
} from '../types'
import type { TimestampConfig } from '@/lib/schemas/types'
import type { OutfitSelectionMode } from '@/lib/schemas/wardrobe.types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import type { CastingDefaults } from '@/lib/chat/opening/defaults'
import type { PreviousOutfitSummary } from '@/components/wardrobe'
import {
  scenarioSelectionToPayload,
  toScenarioOption,
  type ScenarioOption,
  type ScenarioSelection,
} from '@/components/scenario/types'
import { toAutonomousSettingsHint, type AutonomousSettingsHint } from '../autonomous-settings-hint'
import { resolveDefaultSystemPromptId } from '@/lib/characters/default-system-prompt'

export interface UseNewChatOptions {
  initialCharacterId?: string
  projectId?: string
  /**
   * "Change of venue" continuation mode: the create request carries
   * `continuationFromChatId` so the server replays the source chat's tail.
   */
  continuationFromChatId?: string
  /** Pre-selected LLM character IDs (continuation mode). */
  initialSelectedCharacterIds?: string[]
  /** Pre-selected user-controlled character ID. */
  initialUserCharacterId?: string | null
  /** The source chat's choices, carried over as the operator's own (continuation mode). */
  initialImageProfileId?: string | null
  initialAvatarGenerationEnabled?: boolean
  initialTimestampConfig?: TimestampConfig | null
  initialConciergeState?: ConciergeState | null
  /** Start in autonomous-room mode. */
  initialAutonomous?: boolean
}

/** Slim project record used by the in-form project picker. */
export type ProjectListEntry = Project

/**
 * The tiers as re-read by `refetchScenarioTiers`, so a caller can check what
 * the picker now offers without waiting for a re-render. `null` = not re-read
 * (tier not applicable, or the fetch failed).
 */
export interface RefetchedScenarioTiers {
  general: ScenarioOption[] | null
  project: ScenarioOption[] | null
  group: GroupScenarioOption[] | null
}

export interface UseNewChatReturn {
  /** True until the roster and connection profiles have loaded. */
  loading: boolean
  creating: boolean
  // Reference data
  characters: Character[]
  profiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  userControlledCharacters: UserControlledCharacter[]
  project: Project | null
  projectScenarios: ProjectScenarioOption[]
  generalScenarios: GeneralScenarioOption[]
  groupScenarios: GroupScenarioOption[]
  roleplayTemplates: RoleplayTemplateOption[]
  availableProjects: ProjectListEntry[]
  selectedProjectId: string | null
  setSelectedProjectId: (id: string | null) => void
  showArchivedScenarios: boolean
  setShowArchivedScenarios: (next: boolean) => void
  /** Re-read the scenario tiers (e.g. after the Scenario Builder files one). */
  refetchScenarioTiers: () => Promise<RefetchedScenarioTiers>
  // The server's defaults for this cast (null until the cast has one character)
  defaults: CastingDefaults | null
  /** The template the chat would use untouched; labels that option "(default)". */
  defaultRoleplayTemplateId: string | null
  /** The state a chat gets when none is named; labels that option "(default)". */
  conciergeDefaultState: ConciergeState
  /** False when the Concierge is off duty globally: the select is disabled. */
  conciergeOnDuty: boolean
  /** characterId → the outfit mode that seat arrives in untouched. */
  outfitModes: Record<string, OutfitSelectionMode>
  /** A continuation's source-chat outfits, for "Same as last conversation". */
  previousOutfitSummary: PreviousOutfitSummary | null
  autonomousSettingsHint: AutonomousSettingsHint | undefined
  continuationFromChatId: string | null
  // Form state
  selectedCharacters: SelectedCharacter[]
  setSelectedCharacters: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  /** What the form shows: defaults ⊕ overrides. */
  state: NewChatFormState
  /** Only what the operator changed. */
  overrides: NewChatOverrides
  setOverrides: React.Dispatch<React.SetStateAction<NewChatOverrides>>
  setAutonomousEnabled: (enabled: boolean) => void
  /** Call when the cast changes by hand: a character's own scenario leaves with them. */
  handleCastChanged: () => void
  // Actions
  handleCreateChat: () => Promise<{ chatId: string } | null>
}

const AUTONOMOUS_DEFAULTS: Omit<NewChatAutonomousState, 'enabled'> = {
  scheduleCron: '',
  scheduleFreshnessHours: null,
  budgetMaxTurns: null,
  budgetMaxTokens: null,
  budgetMaxWallClockMinutes: null,
  budgetEstimatedSpendCapUSD: null,
  runVisibility: null,
  runDestructiveToolsAllowed: false,
  budgetExcludeCacheHits: true,
}

const EMPTY_CHARACTERS: Character[] = []
const EMPTY_PROFILES: ConnectionProfile[] = []
const EMPTY_IMAGE_PROFILES: ImageProfile[] = []
const EMPTY_PROJECTS: Project[] = []
const EMPTY_TEMPLATES: RoleplayTemplateOption[] = []
const EMPTY_SCENARIOS: ScenarioOption[] = []
const EMPTY_GROUP_SCENARIOS: GroupScenarioOption[] = []
const EMPTY_MODES: Record<string, OutfitSelectionMode> = {}

type GroupScenariosResponse = {
  groupScenarios?: Array<{ groupId: string; groupName: string; scenarios?: ScenarioOption[] }>
}

/** Flatten `/api/v1/groups/scenarios`' grouped payload into picker options. */
function flattenGroupScenarios(data: GroupScenariosResponse): GroupScenarioOption[] {
  const flat: GroupScenarioOption[] = []
  for (const group of data.groupScenarios || []) {
    for (const s of group.scenarios || []) {
      flat.push({ ...toScenarioOption(s), groupId: group.groupId, groupName: group.groupName })
    }
  }
  return flat
}

const toScenarioOptions = (data: { scenarios?: ScenarioOption[] }): ScenarioOption[] =>
  (data.scenarios || []).map((s) => toScenarioOption(s))

/** The scenario default as the dropdown's selection (the kinds line up one to one). */
function scenarioDefaultAsSelection(defaults: CastingDefaults | null): ScenarioSelection {
  return defaults?.scenario ?? { kind: 'custom' }
}

/** The create request's scenario keys, for an overridden scenario (one unit). */
function scenarioOverrideAsRequest(scenario: { selection: ScenarioSelection; notes: string }): Record<string, unknown> {
  const notes = scenario.notes
  if (scenario.selection.kind === 'custom') {
    // Custom with no notes is an explicit "no scenario": an empty `scenario`
    // names the unit, so the server does not fall back to the default.
    return { scenario: notes }
  }
  return { ...scenarioSelectionToPayload(scenario.selection), ...(notes ? { scenario: notes } : {}) }
}

/** The autonomous overrides as create-request fields (hours/minutes → ms). */
function autonomousOverridesAsRequest(auto: NewChatOverrides['autonomous']): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (!auto) return body
  if (auto.scheduleCron !== undefined && auto.scheduleCron.trim().length > 0) {
    body.scheduleCron = auto.scheduleCron.trim()
  }
  if (auto.scheduleFreshnessHours != null && auto.scheduleFreshnessHours > 0) {
    body.scheduleFreshnessWindowMs = auto.scheduleFreshnessHours * 60 * 60 * 1000
  }
  if (auto.budgetMaxTurns != null && auto.budgetMaxTurns > 0) body.budgetMaxTurns = auto.budgetMaxTurns
  if (auto.budgetMaxTokens != null && auto.budgetMaxTokens > 0) body.budgetMaxTokens = auto.budgetMaxTokens
  if (auto.budgetMaxWallClockMinutes != null && auto.budgetMaxWallClockMinutes > 0) {
    body.budgetMaxWallClockMs = auto.budgetMaxWallClockMinutes * 60 * 1000
  }
  if (auto.budgetEstimatedSpendCapUSD != null && auto.budgetEstimatedSpendCapUSD > 0) {
    body.budgetEstimatedSpendCapUSD = auto.budgetEstimatedSpendCapUSD
  }
  if (auto.runVisibility) body.runVisibility = auto.runVisibility
  if (auto.runDestructiveToolsAllowed !== undefined) body.runDestructiveToolsAllowed = auto.runDestructiveToolsAllowed
  if (auto.budgetExcludeCacheHits !== undefined) body.budgetExcludeCacheHits = auto.budgetExcludeCacheHits
  return body
}

/** The operator's carried-over choices (continuation mode), as initial overrides. */
function initialOverridesFrom(options: UseNewChatOptions): NewChatOverrides {
  const overrides: NewChatOverrides = {}
  if (options.initialImageProfileId) overrides.imageProfileId = options.initialImageProfileId
  if (options.initialAvatarGenerationEnabled !== undefined) {
    overrides.avatarGenerationEnabled = options.initialAvatarGenerationEnabled
  }
  if (options.initialTimestampConfig) overrides.timestampConfig = options.initialTimestampConfig
  if (options.initialConciergeState) overrides.conciergeState = options.initialConciergeState
  return overrides
}

function seat(character: Character, controlledBy: 'llm' | 'user', profiles: ConnectionProfile[]): SelectedCharacter {
  if (controlledBy === 'user') {
    return { character, connectionProfileId: '', selectedSystemPromptId: null, controlledBy }
  }
  return {
    character,
    connectionProfileId: character.defaultConnectionProfileId || profiles[0]?.id || '',
    selectedSystemPromptId: resolveDefaultSystemPromptId(character) ?? null,
    controlledBy,
  }
}

/** The casting-defaults read for a prospective cast. */
export function useCastingDefaults(input: {
  selectedCharacters: SelectedCharacter[]
  projectId: string | null
  continuationFromChatId: string | null
  chatType: 'salon' | 'autonomous'
}) {
  const characterIds = input.selectedCharacters.map((sc) => sc.character.id).join(',')
  const userCharacterIds = input.selectedCharacters
    .filter((sc) => sc.controlledBy === 'user')
    .map((sc) => sc.character.id)
    .join(',')
  return useQuery({
    queryKey: queryKeys.casting.defaults({
      characterIds,
      userCharacterIds,
      projectId: input.projectId,
      continuationFromChatId: input.continuationFromChatId,
      chatType: input.chatType,
    }),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ action: 'casting-defaults', characterIds, chatType: input.chatType })
      if (userCharacterIds) params.set('userCharacterIds', userCharacterIds)
      if (input.projectId) params.set('projectId', input.projectId)
      if (input.continuationFromChatId) params.set('continuationFromChatId', input.continuationFromChatId)
      return apiFetch<{ defaults: CastingDefaults }>(`/api/v1/chats?${params.toString()}`, { signal })
    },
    select: (data) => data.defaults,
    enabled: characterIds.length > 0,
    // A cast change keeps the last defaults on screen until the new ones land.
    placeholderData: keepPreviousData,
  })
}

export function useNewChat(options: UseNewChatOptions = {}): UseNewChatReturn {
  const {
    initialCharacterId,
    projectId,
    continuationFromChatId,
    initialSelectedCharacterIds,
    initialUserCharacterId,
    initialAutonomous = false,
  } = options
  const navigate = useWorkspaceNavigate()
  const queryClient = useQueryClient()

  // selectedProjectId is the live picker value; it follows the `projectId`
  // prop when that changes (props-as-state, adjusted during render).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null)
  const [lastSeenProjectIdProp, setLastSeenProjectIdProp] = useState<string | undefined>(projectId)
  if (projectId !== lastSeenProjectIdProp) {
    setLastSeenProjectIdProp(projectId)
    setSelectedProjectId(projectId ?? null)
  }
  const [showArchivedScenarios, setShowArchivedScenarios] = useState(false)

  const [selectedCharacters, setSelectedCharacters] = useState<SelectedCharacter[]>([])
  const [overrides, setOverrides] = useState<NewChatOverrides>(() => initialOverridesFrom(options))
  const [autonomousEnabled, setAutonomousEnabled] = useState(initialAutonomous)

  // --- Reference data ------------------------------------------------------

  const charactersQuery = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters: Character[] }>('/api/v1/characters', { signal }),
  })
  const profilesQuery = useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ConnectionProfile[] }>('/api/v1/connection-profiles', { signal }),
  })
  const imageProfilesQuery = useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ImageProfile[] }>('/api/v1/image-profiles', { signal }),
  })
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) => apiFetch<{ projects: Project[] }>('/api/v1/projects', { signal }),
  })
  const templatesQuery = useQuery({
    queryKey: queryKeys.roleplayTemplates.all,
    queryFn: ({ signal }) =>
      apiFetch<Array<{ id: string; name: string; description?: string | null; isBuiltIn?: boolean }>>(
        '/api/v1/roleplay-templates',
        { signal },
      ),
  })
  const { data: chatSettings } = useChatSettingsQuery()

  const characters = charactersQuery.data?.characters ?? EMPTY_CHARACTERS
  const profiles = profilesQuery.data?.profiles ?? EMPTY_PROFILES
  const imageProfiles = imageProfilesQuery.data?.profiles ?? EMPTY_IMAGE_PROFILES
  const availableProjects = useMemo<ProjectListEntry[]>(
    () =>
      (projectsQuery.data?.projects ?? EMPTY_PROJECTS).map((p) => ({ id: p.id, name: p.name, color: p.color ?? null })),
    [projectsQuery.data],
  )
  const roleplayTemplates = useMemo<RoleplayTemplateOption[]>(
    () =>
      (templatesQuery.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? null,
        isBuiltIn: Boolean(t.isBuiltIn),
      })),
    [templatesQuery.data],
  )
  const userControlledCharacters = useMemo(
    () => characters.filter((c) => c.controlledBy === 'user'),
    [characters],
  )
  const project = useMemo(
    () => availableProjects.find((p) => p.id === selectedProjectId) ?? null,
    [availableProjects, selectedProjectId],
  )

  // --- Scenario tiers -----------------------------------------------------

  const selectedLlmCharacterIds = useMemo(
    () => selectedCharacters.filter((sc) => sc.controlledBy === 'llm').map((sc) => sc.character.id),
    [selectedCharacters],
  )
  const groupCharacterIdsKey = useMemo(() => [...selectedLlmCharacterIds].sort().join(','), [selectedLlmCharacterIds])

  const generalScenariosQueryOptions = {
    queryKey: queryKeys.scenarios.general(showArchivedScenarios),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiFetch<{ scenarios: ScenarioOption[] }>(withArchivedParam('/api/v1/scenarios', showArchivedScenarios), { signal }),
  }
  const projectScenariosQueryOptions = {
    queryKey: queryKeys.scenarios.project(selectedProjectId ?? '', showArchivedScenarios),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiFetch<{ scenarios: ScenarioOption[] }>(
        withArchivedParam(`/api/v1/projects/${selectedProjectId}/scenarios`, showArchivedScenarios),
        { signal },
      ),
  }
  const groupScenariosQueryOptions = {
    queryKey: queryKeys.scenarios.group(groupCharacterIdsKey, showArchivedScenarios),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiFetch<GroupScenariosResponse>(
        withArchivedParam(
          `/api/v1/groups/scenarios?characterIds=${encodeURIComponent(groupCharacterIdsKey)}`,
          showArchivedScenarios,
        ),
        { signal },
      ),
  }
  const generalScenariosQuery = useQuery({ ...generalScenariosQueryOptions, select: toScenarioOptions })
  const projectScenariosQuery = useQuery({
    ...projectScenariosQueryOptions,
    select: toScenarioOptions,
    enabled: Boolean(selectedProjectId),
  })
  const groupScenariosQuery = useQuery({
    ...groupScenariosQueryOptions,
    select: flattenGroupScenarios,
    enabled: groupCharacterIdsKey.length > 0,
  })
  const generalScenarios = generalScenariosQuery.data ?? EMPTY_SCENARIOS
  const projectScenarios = (selectedProjectId ? projectScenariosQuery.data : undefined) ?? EMPTY_SCENARIOS
  const groupScenarios = (groupCharacterIdsKey ? groupScenariosQuery.data : undefined) ?? EMPTY_GROUP_SCENARIOS

  const refetchScenarioTiers = useCallback(async (): Promise<RefetchedScenarioTiers> => {
    const read = async <T, R>(
      opts: { queryKey: readonly unknown[]; queryFn: (ctx: { signal: AbortSignal }) => Promise<T> },
      pick: (data: T) => R,
    ): Promise<R | null> => {
      try {
        const data = await queryClient.fetchQuery({ ...opts, staleTime: 0 })
        return pick(data)
      } catch (error) {
        console.warn('[useNewChat] Scenario tier refetch failed', {
          queryKey: opts.queryKey,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    }
    const [general, projectTier, group] = await Promise.all([
      read(generalScenariosQueryOptions, toScenarioOptions),
      selectedProjectId ? read(projectScenariosQueryOptions, toScenarioOptions) : Promise.resolve(null),
      groupCharacterIdsKey ? read(groupScenariosQueryOptions, flattenGroupScenarios) : Promise.resolve(null),
    ])
    return { general, project: projectTier, group }
    // The option objects are rebuilt each render from the three values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, showArchivedScenarios, selectedProjectId, groupCharacterIdsKey])

  // --- The casting defaults ------------------------------------------------

  const castingDefaultsQuery = useCastingDefaults({
    selectedCharacters,
    projectId: selectedProjectId,
    continuationFromChatId: continuationFromChatId ?? null,
    chatType: autonomousEnabled ? 'autonomous' : 'salon',
  })
  const defaults = selectedCharacters.length > 0 ? castingDefaultsQuery.data ?? null : null

  // A character's, project's or wardrobe's change can move a default (a new
  // default scenario, a changed outfit); re-read rather than poll.
  const refreshCasting = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.casting.all })
  }, [queryClient])
  const refreshCharacters = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.characters.list() })
    refreshCasting()
  }, [queryClient, refreshCasting])
  const refreshProjects = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() })
    refreshCasting()
  }, [queryClient, refreshCasting])
  useRealtimeTopic('characters', refreshCharacters)
  useRealtimeTopic('projects', refreshProjects)
  useRealtimeTopic('wardrobe', refreshCasting)

  // --- Seeding the cast (once, when the roster lands) ----------------------

  const castSeededRef = useRef(false)
  const loading = charactersQuery.isPending || profilesQuery.isPending
  const initialSelectedKey = (initialSelectedCharacterIds || []).join(',')
  useEffect(() => {
    if (castSeededRef.current || loading) return
    castSeededRef.current = true
    const seeded: SelectedCharacter[] = []
    if (initialSelectedKey) {
      // Continuation: the source chat's LLM cast, plus who the operator played.
      for (const cid of initialSelectedKey.split(',')) {
        const char = characters.find((c) => c.id === cid)
        if (char) seeded.push(seat(char, 'llm', profiles))
      }
      if (initialUserCharacterId && !initialAutonomous) {
        const userChar = characters.find((c) => c.id === initialUserCharacterId)
        if (userChar && !seeded.some((sc) => sc.character.id === userChar.id)) {
          seeded.push(seat(userChar, 'user', profiles))
        }
      }
    } else if (initialCharacterId) {
      const char = characters.find((c) => c.id === initialCharacterId)
      if (char) {
        seeded.push(seat(char, 'llm', profiles))
        // The character's default partner takes the operator's chair.
        const partner = char.defaultPartnerId && !initialAutonomous
          ? characters.find((c) => c.id === char.defaultPartnerId)
          : null
        if (partner && partner.id !== char.id) seeded.push(seat(partner, 'user', profiles))
      } else {
        console.warn('[useNewChat] Seed character not in the roster', { initialCharacterId })
      }
    }
    if (seeded.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-time seed from the asynchronously loaded roster, latched by castSeededRef
      setSelectedCharacters(seeded)
    }
  }, [loading, characters, profiles, initialSelectedKey, initialCharacterId, initialUserCharacterId, initialAutonomous])

  // When one LLM character is picked by hand on an unseeded form, their
  // default partner takes the operator's chair, as the Play-As dropdown would.
  const prevLlmIdsRef = useRef('')
  const seededFromOptions = Boolean(initialSelectedKey || initialCharacterId)
  useEffect(() => {
    const llmCharacters = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
    const currentIds = llmCharacters.map((sc) => sc.character.id).sort().join(',')
    if (currentIds === prevLlmIdsRef.current) return
    prevLlmIdsRef.current = currentIds
    if (llmCharacters.length !== 1 || seededFromOptions || autonomousEnabled) return
    const partnerId = llmCharacters[0].character.defaultPartnerId
    if (!partnerId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loop-safe: the partner is a non-LLM entry, so the LLM-id key is unchanged on the re-run and this effect early-returns; the updater is idempotent
    setSelectedCharacters((prev) => {
      if (prev.some((sc) => sc.controlledBy === 'user')) return prev
      if (prev.some((sc) => sc.character.id === partnerId)) return prev
      const partner = userControlledCharacters.find((c) => c.id === partnerId)
      if (!partner) return prev
      return [...prev, seat(partner, 'user', profiles)]
    })
  }, [selectedCharacters, seededFromOptions, autonomousEnabled, userControlledCharacters, profiles])

  // --- defaults ⊕ overrides ----------------------------------------------

  const autonomousSettingsHint = useMemo(() => toAutonomousSettingsHint(chatSettings), [chatSettings])
  const conciergeOnDuty = chatSettings?.conciergeSettings?.enabled !== false
  const conciergeDefaultState: ConciergeState = defaults?.conciergeState ?? 'moderated'
  const defaultRoleplayTemplateId = defaults?.roleplayTemplateId ?? null

  const state = useMemo<NewChatFormState>(() => {
    const scenario = overrides.scenario
    return {
      imageProfileId:
        overrides.imageProfileId !== undefined ? overrides.imageProfileId ?? '' : defaults?.imageProfileId ?? '',
      conciergeState: overrides.conciergeState ?? conciergeDefaultState,
      roleplayTemplateId:
        overrides.roleplayTemplateId !== undefined ? overrides.roleplayTemplateId : defaultRoleplayTemplateId,
      scenario: scenario?.notes ?? '',
      scenarioSelection: scenario?.selection ?? scenarioDefaultAsSelection(defaults),
      timestampConfig:
        overrides.timestampConfig !== undefined ? overrides.timestampConfig : defaults?.timestampConfig ?? null,
      avatarGenerationEnabled: overrides.avatarGenerationEnabled ?? defaults?.avatarGenerationEnabled ?? false,
      outfitSelections: overrides.outfitSelections ?? [],
      autonomous: { ...AUTONOMOUS_DEFAULTS, ...overrides.autonomous, enabled: autonomousEnabled },
    }
  }, [overrides, defaults, conciergeDefaultState, defaultRoleplayTemplateId, autonomousEnabled])

  const handleCastChanged = useCallback(() => {
    // A character's own scenario leaves with the cast that offered it.
    setOverrides((prev) => {
      if (prev.scenario?.selection.kind !== 'character') return prev
      const next = { ...prev }
      if (prev.scenario.notes) next.scenario = { selection: { kind: 'custom' }, notes: prev.scenario.notes }
      else delete next.scenario
      return next
    })
  }, [])

  // --- Create ----------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ chat: { id: string } }>('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  })

  const handleCreateChat = async (): Promise<{ chatId: string } | null> => {
    if (selectedCharacters.length === 0) {
      showErrorToast('Please select at least one character')
      return null
    }
    const llmSelected = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
    if (autonomousEnabled) {
      if (llmSelected.length < 2) {
        showErrorToast('Autonomous rooms need at least two LLM-controlled characters')
        return null
      }
      if (selectedCharacters.some((sc) => sc.controlledBy === 'user')) {
        showErrorToast('Autonomous rooms have no user — remove user-controlled characters')
        return null
      }
    }
    const llmMissingProfile = llmSelected.filter((sc) => !sc.connectionProfileId)
    if (llmMissingProfile.length > 0) {
      showErrorToast(
        `Please select a connection profile for: ${llmMissingProfile.map((sc) => sc.character.name).join(', ')}`,
      )
      return null
    }
    if (llmSelected.length === 0) {
      showErrorToast('At least one character must be LLM-controlled')
      return null
    }

    const body: Record<string, unknown> = {
      participants: selectedCharacters.map((sc) => ({
        type: 'CHARACTER' as const,
        characterId: sc.character.id,
        connectionProfileId: sc.controlledBy === 'llm' ? sc.connectionProfileId : undefined,
        selectedSystemPromptId: sc.selectedSystemPromptId || undefined,
        selectedSubpromptIds:
          sc.controlledBy === 'llm' && sc.selectedSubpromptIds && sc.selectedSubpromptIds.length > 0
            ? sc.selectedSubpromptIds
            : undefined,
        controlledBy: sc.controlledBy,
      })),
    }
    if (selectedProjectId) body.projectId = selectedProjectId
    if (continuationFromChatId) body.continuationFromChatId = continuationFromChatId
    if (autonomousEnabled) body.chatType = 'autonomous'

    // The overrides, and nothing else.
    if (overrides.scenario) Object.assign(body, scenarioOverrideAsRequest(overrides.scenario))
    if (overrides.roleplayTemplateId !== undefined) body.roleplayTemplateId = overrides.roleplayTemplateId
    if (overrides.conciergeState !== undefined) body.conciergeState = overrides.conciergeState
    if (overrides.timestampConfig) body.timestampConfig = overrides.timestampConfig
    if (overrides.imageProfileId) body.imageProfileId = overrides.imageProfileId
    if (overrides.avatarGenerationEnabled !== undefined && !autonomousEnabled) {
      body.avatarGenerationEnabled = overrides.avatarGenerationEnabled
    }
    const castIds = new Set(selectedCharacters.map((sc) => sc.character.id))
    const outfitSelections = (overrides.outfitSelections ?? []).filter((s) => castIds.has(s.characterId))
    if (outfitSelections.length > 0) body.outfitSelections = outfitSelections
    if (autonomousEnabled) Object.assign(body, autonomousOverridesAsRequest(overrides.autonomous))

    try {
      const data = await createMutation.mutateAsync(body)
      if (autonomousEnabled) {
        showSuccessToast('Autonomous room created!')
        navigate('/settings?tab=chat&section=autonomous-rooms')
      } else {
        showSuccessToast(continuationFromChatId ? 'Conversation continued in a new chat!' : 'Chat created!')
        // In the workspace this opens the new chat as a tab in place; the
        // Salon runs the opening when it opens a chat that has not had one.
        navigate(`/salon/${data.chat.id}`)
      }
      return { chatId: data.chat.id }
    } catch (err) {
      const msg = apiErrorMessage(err, 'Failed to create chat')
      showErrorToast(msg)
      console.error('[useNewChat] Failed to create chat', { error: msg })
      return null
    }
  }

  return {
    loading,
    creating: createMutation.isPending,
    characters,
    profiles,
    imageProfiles,
    userControlledCharacters,
    project,
    projectScenarios,
    generalScenarios,
    groupScenarios,
    roleplayTemplates,
    availableProjects,
    selectedProjectId,
    setSelectedProjectId,
    showArchivedScenarios,
    setShowArchivedScenarios,
    refetchScenarioTiers,
    defaults,
    defaultRoleplayTemplateId,
    conciergeDefaultState,
    conciergeOnDuty,
    outfitModes: defaults?.outfitModes ?? EMPTY_MODES,
    previousOutfitSummary: defaults?.previousOutfits ?? null,
    autonomousSettingsHint,
    continuationFromChatId: continuationFromChatId ?? null,
    selectedCharacters,
    setSelectedCharacters,
    state,
    overrides,
    setOverrides,
    setAutonomousEnabled,
    handleCastChanged,
    handleCreateChat,
  }
}
