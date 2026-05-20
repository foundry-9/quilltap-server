'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type {
  Character,
  ConnectionProfile,
  GeneralScenarioOption,
  ImageProfile,
  NewChatFormState,
  Project,
  ProjectScenarioOption,
  SelectedCharacter,
  UserControlledCharacter,
} from '../types'
import type { TimestampConfig } from '@/lib/schemas/types'

interface UseNewChatOptions {
  initialCharacterId?: string
  projectId?: string
  /**
   * "Change of venue" continuation mode: when set, handleCreateChat sends
   * `continuationFromChatId` in the POST body so the server replays the
   * source chat's tail into the new one.
   */
  continuationFromChatId?: string
  /**
   * Pre-selected LLM character IDs (continuation mode). Each is loaded from
   * the character roster and seeded as an LLM-controlled SelectedCharacter
   * with its default connection profile and system prompt.
   */
  initialSelectedCharacterIds?: string[]
  /** Pre-selected user-controlled character ID. */
  initialUserCharacterId?: string | null
  initialImageProfileId?: string | null
  initialAvatarGenerationEnabled?: boolean
  initialTimestampConfig?: TimestampConfig | null
}

interface UseNewChatReturn {
  loading: boolean
  creating: boolean
  // Reference data
  characters: Character[]
  profiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  userControlledCharacters: UserControlledCharacter[]
  project: Project | null
  /** Project scenarios from `/api/v1/projects/[id]/scenarios`; empty when no project. */
  projectScenarios: ProjectScenarioOption[]
  /** General scenarios from `/api/v1/scenarios`; fetched for every non-help chat. */
  generalScenarios: GeneralScenarioOption[]
  // Form state
  selectedCharacters: SelectedCharacter[]
  setSelectedCharacters: React.Dispatch<React.SetStateAction<SelectedCharacter[]>>
  state: NewChatFormState
  setState: React.Dispatch<React.SetStateAction<NewChatFormState>>
  // Actions
  handleCreateChat: () => Promise<{ chatId: string } | null>
}

const INITIAL_STATE: NewChatFormState = {
  selectedUserCharacterId: '',
  imageProfileId: '',
  scenario: '',
  scenarioId: null,
  projectScenarioPath: null,
  generalScenarioPath: null,
  timestampConfig: null,
  avatarGenerationEnabled: false,
  outfitSelections: [],
}

function generateTitle(selected: SelectedCharacter[]): string {
  const llm = selected.filter((sc) => sc.controlledBy === 'llm')
  if (llm.length === 0) return 'New Chat'
  if (llm.length === 1) return `Chat with ${llm[0].character.name}`
  if (llm.length === 2) return `Chat with ${llm[0].character.name} and ${llm[1].character.name}`
  if (llm.length === 3) {
    return `Chat with ${llm[0].character.name}, ${llm[1].character.name}, and ${llm[2].character.name}`
  }
  return `Group Chat (${llm.length} characters)`
}

export function useNewChat({
  initialCharacterId,
  projectId,
  continuationFromChatId,
  initialSelectedCharacterIds,
  initialUserCharacterId,
  initialImageProfileId,
  initialAvatarGenerationEnabled,
  initialTimestampConfig,
}: UseNewChatOptions = {}): UseNewChatReturn {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const [characters, setCharacters] = useState<Character[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<UserControlledCharacter[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [projectScenarios, setProjectScenarios] = useState<ProjectScenarioOption[]>([])
  const [generalScenarios, setGeneralScenarios] = useState<GeneralScenarioOption[]>([])

  const [selectedCharacters, setSelectedCharacters] = useState<SelectedCharacter[]>([])
  const [state, setState] = useState<NewChatFormState>(INITIAL_STATE)

  const seededRef = useRef(false)
  const prevLlmIdsRef = useRef<string>('')

  // Memoise the joined character-ID list so the fetchData useEffect doesn't
  // churn when the parent passes a fresh array reference each render.
  const initialSelectedKey = (initialSelectedCharacterIds || []).join(',')

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        const requests: Array<Promise<Response>> = [
          fetch('/api/v1/characters'),
          fetch('/api/v1/connection-profiles'),
          fetch('/api/v1/image-profiles'),
          fetch('/api/v1/scenarios'),
        ]
        if (projectId) {
          requests.push(fetch(`/api/v1/projects/${projectId}`))
          requests.push(fetch(`/api/v1/projects/${projectId}/scenarios`))
        }
        if (initialCharacterId) {
          requests.push(fetch(`/api/v1/characters/${initialCharacterId}`))
          requests.push(fetch(`/api/v1/characters/${initialCharacterId}?action=default-partner`))
        }

        const responses = await Promise.all(requests)
        if (cancelled) return

        let idx = 0
        const charsRes = responses[idx++]
        const profilesRes = responses[idx++]
        const imageProfilesRes = responses[idx++]
        const generalScenariosRes = responses[idx++]
        const projectRes = projectId ? responses[idx++] : null
        const projectScenariosRes = projectId ? responses[idx++] : null
        const seedCharacterRes = initialCharacterId ? responses[idx++] : null
        const seedPartnerRes = initialCharacterId ? responses[idx++] : null

        let loadedCharacters: Character[] = []
        let loadedUserChars: UserControlledCharacter[] = []
        if (charsRes.ok) {
          const data = await charsRes.json()
          const all: Character[] = data.characters || []
          loadedCharacters = all.filter((c) => c.controlledBy !== 'user')
          loadedUserChars = all
            .filter((c) => c.controlledBy === 'user')
            .map((c) => ({ id: c.id, name: c.name, title: c.title ?? null }))
        }
        let loadedProfiles: ConnectionProfile[] = []
        if (profilesRes.ok) {
          const data = await profilesRes.json()
          loadedProfiles = data.profiles || []
        }
        let loadedImageProfiles: ImageProfile[] = []
        if (imageProfilesRes.ok) {
          const data = await imageProfilesRes.json()
          loadedImageProfiles = Array.isArray(data) ? data : data.profiles || []
        }
        let loadedGeneralScenarios: GeneralScenarioOption[] = []
        if (generalScenariosRes.ok) {
          const data = await generalScenariosRes.json()
          loadedGeneralScenarios = (data.scenarios || []).map((s: { path: string; filename: string; name: string; description?: string; isDefault: boolean; body: string }) => ({
            path: s.path,
            filename: s.filename,
            name: s.name,
            ...(s.description !== undefined && { description: s.description }),
            isDefault: s.isDefault,
            body: s.body,
          }))
        } else {
          console.warn('[useNewChat] Failed to load general scenarios', {
            status: generalScenariosRes.status,
          })
        }
        let loadedProject: Project | null = null
        if (projectRes && projectRes.ok) {
          const data = await projectRes.json()
          loadedProject = data.project || data
        } else if (projectRes && !projectRes.ok) {
          console.warn('[useNewChat] Failed to load project', { projectId, status: projectRes.status })
        }

        let loadedProjectScenarios: ProjectScenarioOption[] = []
        if (projectScenariosRes && projectScenariosRes.ok) {
          const data = await projectScenariosRes.json()
          // Server returns full ParsedProjectScenario[]; pick the fields the UI needs.
          loadedProjectScenarios = (data.scenarios || []).map((s: { path: string; filename: string; name: string; description?: string; isDefault: boolean; body: string }) => ({
            path: s.path,
            filename: s.filename,
            name: s.name,
            ...(s.description !== undefined && { description: s.description }),
            isDefault: s.isDefault,
            body: s.body,
          }))
        } else if (projectScenariosRes && !projectScenariosRes.ok) {
          console.warn('[useNewChat] Failed to load project scenarios', {
            projectId,
            status: projectScenariosRes.status,
          })
        }

        let seededChar: Character | null = null
        if (seedCharacterRes && seedCharacterRes.ok) {
          const { character } = await seedCharacterRes.json()
          seededChar = character
        }
        let seededPartnerId: string | null = null
        if (seedPartnerRes && seedPartnerRes.ok) {
          const data = await seedPartnerRes.json()
          seededPartnerId = data.partnerId || null
        }

        setCharacters(loadedCharacters)
        setUserControlledCharacters(loadedUserChars)
        setProfiles(loadedProfiles)
        setImageProfiles(loadedImageProfiles)
        setProject(loadedProject)
        setProjectScenarios(loadedProjectScenarios)
        setGeneralScenarios(loadedGeneralScenarios)

        // Project default wins over general default for pre-selection. When a
        // project default exists, seed `projectScenarioPath`; otherwise fall
        // back to the general default.
        const projectDefaultScenarioPath =
          loadedProjectScenarios.find((s) => s.isDefault)?.path ?? null
        const generalDefaultScenarioPath =
          loadedGeneralScenarios.find((s) => s.isDefault)?.path ?? null
        const seededGeneralScenarioPath = projectDefaultScenarioPath
          ? null
          : generalDefaultScenarioPath

        // Continuation mode: seed multi-character + form state from the
        // source chat's roster, bypassing the single-character seed branch.
        if (
          initialSelectedCharacterIds &&
          initialSelectedCharacterIds.length > 0 &&
          !seededRef.current
        ) {
          seededRef.current = true
          const seededSelected: SelectedCharacter[] = []
          for (const cid of initialSelectedCharacterIds) {
            const char = loadedCharacters.find((c) => c.id === cid)
            if (!char) continue
            const connectionProfileId =
              char.defaultConnectionProfileId || loadedProfiles[0]?.id || ''
            const defaultPromptId = char.defaultSystemPromptId
              ? char.systemPrompts?.find((p) => p.id === char.defaultSystemPromptId)?.id
              : char.systemPrompts?.find((p) => p.isDefault)?.id ?? char.systemPrompts?.[0]?.id
            seededSelected.push({
              character: char,
              connectionProfileId,
              selectedSystemPromptId: defaultPromptId ?? null,
              controlledBy: 'llm',
            })
          }
          if (seededSelected.length > 0) {
            setSelectedCharacters(seededSelected)
          }
          setState((prev) => ({
            ...prev,
            selectedUserCharacterId: initialUserCharacterId ?? prev.selectedUserCharacterId,
            timestampConfig: initialTimestampConfig ?? prev.timestampConfig,
            // Continuation mode intentionally does NOT pre-fill scenario:
            // the whole point is to pick a new one.
            scenarioId: null,
            projectScenarioPath: projectDefaultScenarioPath,
            generalScenarioPath: seededGeneralScenarioPath,
            imageProfileId:
              initialImageProfileId ||
              loadedProject?.defaultImageProfileId ||
              prev.imageProfileId,
            avatarGenerationEnabled:
              initialAvatarGenerationEnabled ??
              loadedProject?.defaultAvatarGenerationEnabled ??
              prev.avatarGenerationEnabled,
          }))
        }
        // Seed selected character + defaults when initialCharacterId is provided
        else if (initialCharacterId && seededChar && !seededRef.current) {
          seededRef.current = true
          const char = seededChar
          const connectionProfileId =
            char.defaultConnectionProfileId || loadedProfiles[0]?.id || ''
          const defaultPromptId = char.defaultSystemPromptId
            ? char.systemPrompts?.find((p) => p.id === char.defaultSystemPromptId)?.id
            : char.systemPrompts?.find((p) => p.isDefault)?.id ?? char.systemPrompts?.[0]?.id
          setSelectedCharacters([
            {
              character: char,
              connectionProfileId,
              selectedSystemPromptId: defaultPromptId ?? null,
              controlledBy: 'llm',
            },
          ])

          // Scenario default: project default wins over character default.
          // The character default still rides on `state.scenarioId` so the form
          // can render the override-visibility note offering a one-click switch.
          // General default fills in only when no project default exists.
          setState((prev) => ({
            ...prev,
            selectedUserCharacterId: seededPartnerId || char.defaultPartnerId || '',
            timestampConfig: char.defaultTimestampConfig ?? null,
            scenarioId: char.defaultScenarioId ?? null,
            projectScenarioPath: projectDefaultScenarioPath,
            generalScenarioPath: seededGeneralScenarioPath,
            imageProfileId:
              loadedProject?.defaultImageProfileId ||
              char.defaultImageProfileId ||
              '',
            avatarGenerationEnabled: loadedProject?.defaultAvatarGenerationEnabled ?? false,
          }))
        } else if (loadedProject) {
          // Project-only seeding (page mode)
          setState((prev) => ({
            ...prev,
            projectScenarioPath: projectDefaultScenarioPath,
            generalScenarioPath: seededGeneralScenarioPath,
            imageProfileId: loadedProject.defaultImageProfileId || prev.imageProfileId,
            avatarGenerationEnabled:
              loadedProject.defaultAvatarGenerationEnabled ?? prev.avatarGenerationEnabled,
          }))
        } else if (generalDefaultScenarioPath) {
          // No project, no initial character — still pre-select the general
          // default so the dropdown lands on something meaningful.
          setState((prev) => ({
            ...prev,
            generalScenarioPath: generalDefaultScenarioPath,
          }))
        }
      } catch (err) {
        if (cancelled) return
        console.error('[useNewChat] Failed to fetch data', {
          error: err instanceof Error ? err.message : String(err),
        })
        showErrorToast('Failed to load chat creation data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
    // The continuation seed depends on the joined character-ID list (serialised
    // as initialSelectedKey above) so a fresh array reference from the parent
    // doesn't churn the fetch. Other initial-* options are scalars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialCharacterId,
    projectId,
    continuationFromChatId,
    initialSelectedKey,
    initialUserCharacterId,
    initialImageProfileId,
    initialAvatarGenerationEnabled,
  ])

  // When exactly one LLM character is selected (and it wasn't seeded), propagate their defaults.
  // Matches behavior of the former /salon/new page for multi-char mode.
  useEffect(() => {
    const llmCharacters = selectedCharacters.filter((sc) => sc.controlledBy === 'llm')
    const currentIds = llmCharacters
      .map((sc) => sc.character.id)
      .sort()
      .join(',')
    if (currentIds === prevLlmIdsRef.current) return
    prevLlmIdsRef.current = currentIds

    if (llmCharacters.length === 1 && !seededRef.current) {
      const char = llmCharacters[0].character
      setState((prev) => ({
        ...prev,
        selectedUserCharacterId: char.defaultPartnerId || prev.selectedUserCharacterId,
        timestampConfig: char.defaultTimestampConfig ?? prev.timestampConfig,
        scenarioId: char.defaultScenarioId ?? prev.scenarioId,
        imageProfileId:
          project?.defaultImageProfileId ||
          char.defaultImageProfileId ||
          prev.imageProfileId,
      }))
    }
  }, [selectedCharacters, project?.defaultImageProfileId])

  const handleCreateChat = async (): Promise<{ chatId: string } | null> => {
    if (selectedCharacters.length === 0) {
      showErrorToast('Please select at least one character')
      return null
    }

    const llmMissingProfile = selectedCharacters.filter(
      (sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId
    )
    if (llmMissingProfile.length > 0) {
      showErrorToast(
        `Please select a connection profile for: ${llmMissingProfile.map((sc) => sc.character.name).join(', ')}`
      )
      return null
    }

    const hasLlm = selectedCharacters.some((sc) => sc.controlledBy === 'llm')
    if (!hasLlm) {
      showErrorToast('At least one character must be LLM-controlled')
      return null
    }

    setCreating(true)

    try {
      const participants: Array<{
        type: 'CHARACTER'
        characterId: string
        connectionProfileId?: string
        selectedSystemPromptId?: string
        controlledBy?: 'llm' | 'user'
      }> = selectedCharacters.map((sc) => ({
        type: 'CHARACTER' as const,
        characterId: sc.character.id,
        connectionProfileId: sc.controlledBy === 'llm' ? sc.connectionProfileId : undefined,
        selectedSystemPromptId: sc.selectedSystemPromptId || undefined,
        controlledBy: sc.controlledBy,
      }))

      if (state.selectedUserCharacterId) {
        participants.push({
          type: 'CHARACTER' as const,
          characterId: state.selectedUserCharacterId,
          controlledBy: 'user' as const,
        })
      }

      const requestBody: Record<string, unknown> = {
        title: generateTitle(selectedCharacters),
        participants,
      }

      if (state.imageProfileId) {
        requestBody.imageProfileId = state.imageProfileId
      }

      // Scenario precedence: custom text > character scenarioId > projectScenarioPath > generalScenarioPath.
      if (state.scenario) {
        requestBody.scenario = state.scenario
      } else if (state.scenarioId) {
        requestBody.scenarioId = state.scenarioId
      } else if (state.projectScenarioPath) {
        requestBody.projectScenarioPath = state.projectScenarioPath
      } else if (state.generalScenarioPath) {
        requestBody.generalScenarioPath = state.generalScenarioPath
      }

      if (state.timestampConfig && state.timestampConfig.mode !== 'NONE') {
        requestBody.timestampConfig = state.timestampConfig
      }

      if (project?.id) {
        requestBody.projectId = project.id
      }

      if (state.avatarGenerationEnabled) {
        requestBody.avatarGenerationEnabled = true
      }

      if (state.outfitSelections.length > 0) {
        requestBody.outfitSelections = state.outfitSelections
      }

      if (continuationFromChatId) {
        requestBody.continuationFromChatId = continuationFromChatId
      }

      const res = await fetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      showSuccessToast(continuationFromChatId ? 'Conversation continued in a new chat!' : 'Chat created!')
      router.push(`/salon/${data.chat.id}`)
      return { chatId: data.chat.id }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create chat'
      showErrorToast(msg)
      console.error('[useNewChat] Failed to create chat', { error: msg })
      return null
    } finally {
      setCreating(false)
    }
  }

  return {
    loading,
    creating,
    characters,
    profiles,
    imageProfiles,
    userControlledCharacters,
    project,
    projectScenarios,
    generalScenarios,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setState,
    handleCreateChat,
  }
}
