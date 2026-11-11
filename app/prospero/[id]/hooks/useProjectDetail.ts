'use client'

/**
 * useProjectDetail Hook
 *
 * The project record from the query cache, the page's two text drafts, and
 * the writes. The header (name, description) and the instructions editor are
 * separate drafts and each saves only its own fields; a refetch — a tab
 * switch back, a roster change, a realtime `projects` hint — never overwrites
 * a draft the user has edited (#170, `useDraft`).
 *
 * @module app/prospero/[id]/hooks/useProjectDetail
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useDraft, type SetDraft } from '@/lib/hooks/use-draft'
import type { Project, HeaderDraft, BackgroundDisplayMode } from '../types'

type ProjectPatch = Partial<Omit<Project, 'id' | 'characterRoster' | 'createdAt' | 'updatedAt'>>

interface UseProjectDetailReturn {
  project: Project | null
  loading: boolean
  error: string | null
  /** Header draft (name, description) — saved by `handleSaveHeader`. */
  headerDraft: HeaderDraft
  setHeaderDraft: SetDraft<HeaderDraft>
  /** Instructions draft — saved by `handleSaveInstructions`. */
  instructionsDraft: string
  setInstructionsDraft: SetDraft<string>
  instructionsDirty: boolean
  isEditing: boolean
  startEditing: () => void
  cancelEditing: () => void
  /** Re-read the project. Drafts with edits are kept. */
  fetchProject: () => Promise<void>
  handleSaveHeader: () => Promise<void>
  handleSaveInstructions: () => Promise<void>
  handleToggleAllowAnyCharacter: () => Promise<void>
  handleSaveAgentMode: (enabled: boolean | null) => Promise<void>
  handleSaveAnswerConfirmationOverride: (value: 'ON' | 'OFF' | null) => Promise<void>
  handleSaveAvatarGeneration: (enabled: boolean | null) => Promise<void>
  handleSaveDefaultImageProfile: (profileId: string | null) => Promise<void>
  handleSaveBrahmaConnectionProfile: (profileId: string | null) => Promise<void>
  handleSaveDefaultRoleplayTemplate: (templateId: string | null) => Promise<void>
  handleSaveBackgroundDisplayMode: (mode: BackgroundDisplayMode) => Promise<void>
  handleSaveAlertCharactersOfLanternImages: (enabled: boolean | null) => Promise<void>
  handleAddCharacter: (characterId: string) => Promise<void>
  handleRemoveCharacter: (characterId: string) => Promise<void>
}

/** Pick one of three toast lines for a tri-state (inherit / on / off) setting. */
function triState<T>(value: T | null, inherit: string, on: string, off: string, isOn: (v: T) => boolean): string {
  if (value === null) return inherit
  return isOn(value) ? on : off
}

export function useProjectDetail(projectId: string): UseProjectDetailReturn {
  const queryClient = useQueryClient()
  const detailKey = queryKeys.projects.detail(projectId)

  const query = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => apiFetch<{ project: Project }>(`/api/v1/projects/${projectId}`, { signal }),
    select: (data) => data.project,
  })
  const project = query.data ?? null

  const serverHeader = useMemo<HeaderDraft>(
    () => ({ name: project?.name ?? '', description: project?.description ?? '' }),
    [project?.name, project?.description],
  )
  const [headerDraft, setHeaderDraft, header] = useDraft(serverHeader)
  const [instructionsDraft, setInstructionsDraft, instructions] = useDraft(project?.instructions ?? '')
  const [isEditing, setIsEditing] = useState(false)

  const putMutation = useMutation({
    mutationFn: (patch: ProjectPatch) =>
      apiFetch<{ project: Project }>(`/api/v1/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(detailKey, data)
      // Names, colours and counts appear in every project list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists })
    },
  })
  const { mutateAsync: putProject } = putMutation

  /** Save `patch`; toast the outcome. Resolves true on success. */
  const save = useCallback(
    async (patch: ProjectPatch, success: string | ((p: Project) => string), failure: string): Promise<boolean> => {
      try {
        const data = await putProject(patch)
        showSuccessToast(typeof success === 'function' ? success(data.project) : success)
        return true
      } catch (err) {
        const message = apiErrorMessage(err, failure)
        console.error('useProjectDetail: save error', { projectId, fields: Object.keys(patch), message })
        showErrorToast(message)
        return false
      }
    },
    [putProject, projectId],
  )

  const fetchProject = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: detailKey })
  }, [queryClient, detailKey])

  const startEditing = useCallback(() => setIsEditing(true), [])
  const cancelEditing = useCallback(() => {
    header.reset()
    setIsEditing(false)
  }, [header])

  const handleSaveHeader = useCallback(async () => {
    const ok = await save(
      { name: headerDraft.name, description: headerDraft.description || null },
      'Project updated!',
      'Failed to update project',
    )
    if (ok) setIsEditing(false)
  }, [save, headerDraft])

  const handleSaveInstructions = useCallback(async () => {
    await save({ instructions: instructionsDraft || null }, 'Project instructions saved', 'Failed to save the instructions')
  }, [save, instructionsDraft])

  const handleToggleAllowAnyCharacter = useCallback(async () => {
    if (!project) return
    await save(
      { allowAnyCharacter: !project.allowAnyCharacter },
      (p) => p.allowAnyCharacter
        ? 'Every character may now use the project files and wardrobe'
        : 'Only roster characters may use the project files and wardrobe',
      'Failed to update setting',
    )
  }, [project, save])

  const handleSaveAgentMode = useCallback(async (enabled: boolean | null) => {
    await save(
      { defaultAgentModeEnabled: enabled },
      triState(enabled, 'Agent mode set to inherit from global/character',
        'Agent mode enabled by default for project', 'Agent mode disabled by default for project', Boolean),
      'Failed to update agent mode',
    )
  }, [save])

  const handleSaveAnswerConfirmationOverride = useCallback(async (value: 'ON' | 'OFF' | null) => {
    await save(
      { answerConfirmationOverride: value },
      triState(value, 'Answer confirmation set to inherit from global',
        'Answer confirmation enabled by default for project', 'Answer confirmation disabled by default for project',
        (v) => v === 'ON'),
      'Failed to update answer confirmation',
    )
  }, [save])

  const handleSaveBrahmaConnectionProfile = useCallback(async (profileId: string | null) => {
    await save(
      { brahmaConnectionProfileId: profileId },
      profileId ? 'Inline Brahma engine set for project' : 'Inline Brahma engine set to inherit from global',
      'Failed to update the inline Brahma engine',
    )
  }, [save])

  const handleSaveAvatarGeneration = useCallback(async (enabled: boolean | null) => {
    await save(
      { defaultAvatarGenerationEnabled: enabled },
      triState(enabled, 'Avatar generation set to inherit from global',
        'Avatar generation enabled by default for project', 'Avatar generation disabled by default for project', Boolean),
      'Failed to update avatar generation',
    )
  }, [save])

  const handleSaveDefaultImageProfile = useCallback(async (profileId: string | null) => {
    await save(
      { defaultImageProfileId: profileId },
      profileId ? 'Default image profile set for project' : 'Image profile set to inherit from global',
      'Failed to update image profile',
    )
  }, [save])

  const handleSaveDefaultRoleplayTemplate = useCallback(async (templateId: string | null) => {
    await save(
      { defaultRoleplayTemplateId: templateId },
      templateId ? 'Default roleplay template set for project' : 'Roleplay template set to inherit from global',
      'Failed to update roleplay template',
    )
  }, [save])

  const handleSaveAlertCharactersOfLanternImages = useCallback(async (enabled: boolean | null) => {
    await save(
      { defaultAlertCharactersOfLanternImages: enabled },
      triState(enabled, 'Lantern image announcements set to inherit from global',
        'Lantern image announcements enabled by default for project',
        'Lantern image announcements disabled by default for project', Boolean),
      'Failed to update Lantern image announcement setting',
    )
  }, [save])

  const handleSaveBackgroundDisplayMode = useCallback(async (mode: BackgroundDisplayMode) => {
    const modeLabels: Record<BackgroundDisplayMode, string> = {
      theme: 'theme background',
      latest_chat: 'latest chat background',
    }
    await save({ backgroundDisplayMode: mode }, `Background set to ${modeLabels[mode]}`, 'Failed to update background mode')
  }, [save])

  const rosterAction = useCallback(
    async (action: 'add-character' | 'remove-character', characterId: string, success: string, failure: string) => {
      try {
        await apiFetch(`/api/v1/projects/${projectId}?action=${action}`, {
          method: action === 'add-character' ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId }),
        })
        await fetchProject()
        showSuccessToast(success)
      } catch (err) {
        const message = apiErrorMessage(err, failure)
        console.error('useProjectDetail: roster error', { projectId, action, message })
        showErrorToast(message)
      }
    },
    [projectId, fetchProject],
  )

  const handleAddCharacter = useCallback(
    (characterId: string) =>
      rosterAction('add-character', characterId, 'Character added to the roster', 'Failed to add character'),
    [rosterAction],
  )
  const handleRemoveCharacter = useCallback(
    (characterId: string) =>
      rosterAction('remove-character', characterId, 'Character removed from the roster', 'Failed to remove character'),
    [rosterAction],
  )

  return {
    project,
    loading: query.isPending,
    error: query.error ? apiErrorMessage(query.error, 'Failed to load project') : null,
    headerDraft,
    setHeaderDraft,
    instructionsDraft,
    setInstructionsDraft,
    instructionsDirty: instructions.dirty,
    isEditing,
    startEditing,
    cancelEditing,
    fetchProject,
    handleSaveHeader,
    handleSaveInstructions,
    handleToggleAllowAnyCharacter,
    handleSaveAgentMode,
    handleSaveAnswerConfirmationOverride,
    handleSaveAvatarGeneration,
    handleSaveDefaultImageProfile,
    handleSaveBrahmaConnectionProfile,
    handleSaveDefaultRoleplayTemplate,
    handleSaveBackgroundDisplayMode,
    handleSaveAlertCharactersOfLanternImages,
    handleAddCharacter,
    handleRemoveCharacter,
  }
}
