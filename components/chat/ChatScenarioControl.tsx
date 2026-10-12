'use client'

/**
 * The in-chat scenario picker, living in the Salon sidebar's Chat section.
 *
 * Offers the same four tiers the New Chat dialog does — project, general,
 * group, character — through the shared `<ScenarioSelect>`, plus "Browse all
 * scenarios…", which opens the scenario browser so a scene from any shelf in
 * the instance can be plucked in. Under a preset sits a "Notes beneath the
 * scene" box; under "Custom…" the box is the whole scene. Saving posts to
 * `?action=scenario`, which rewrites `chat.scenarioText` (with its source and
 * notes), recompiles every participant's identity stack, and has the Host
 * announce the revision.
 *
 * The current scene seeds the control. When the chat recorded where its scene
 * came from (`?action=scenario-source`), that source is the authority: the
 * provenance line names it, says when the shelf copy has since been revised
 * or removed, and offers "Reload from source" (`reload: true`; an ordinary
 * save keeps the scene the chat has) — the same file, with the same
 * notes beneath. A chat with no source (a custom scene, or one from before
 * sources were recorded) falls back to matching the text against the presets,
 * as it always has.
 *
 * "Show archived" re-fetches all four tiers with `?includeArchived=true`; the
 * flag is part of each TanStack query key, so the two answers cache separately
 * instead of one overwriting the other.
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { ScenarioSelect } from '@/components/scenario/ScenarioSelect'
import { ScenarioBrowserDialog, useScenarioRefBody } from '@/components/scenario/ScenarioBrowserDialog'
import { withArchivedParam } from '@/components/scenarios/archived-query'
import {
  scenarioSelectionToPayload,
  type CharacterScenario,
  type GeneralScenarioOption,
  type GroupScenarioOption,
  type ProjectScenarioOption,
  type ScenarioSelection,
} from '@/components/scenario/types'
import dynamic from 'next/dynamic'
import type {
  SavedScenarioTarget,
  ScenarioBuilderCastMember,
} from '@/components/scenario-builder/ScenarioBuilderDialog'
import { STAFF_AVATARS } from '@/lib/chat/staff-display-names'
import { useImagesHidden } from '@/components/quick-hide/images-hidden-context'

// Loaded on demand: the builder (and the Markdown renderer behind its thinking
// block) stays out of this surface's bundle until the Host is asked.
const ScenarioBuilderDialog = dynamic(
  () => import('@/components/scenario-builder/ScenarioBuilderDialog').then((m) => m.ScenarioBuilderDialog),
  { ssr: false },
)

/** `GET ?action=scenario-source`. */
export interface ScenarioSourceInfo {
  source: { mountPointId: string; path: string; bodySha256: string } | null
  owner: { scope: 'general' | 'project' | 'group' | 'character'; id: string | null; name: string } | null
  scenarioName: string | null
  scenarioId: string | null
  exists: boolean
  changed: boolean
  notes: string | null
}

interface GroupScenarioGroup {
  groupId: string
  groupName: string
  scenarios: Omit<GroupScenarioOption, 'groupId' | 'groupName'>[]
}

export interface ChatScenarioControlProps {
  chatId: string
  /** The chat's project, when it has one — gates the project tier. */
  projectId?: string | null
  /** The scene as currently stored on the chat. */
  scenarioText?: string | null
  /** Character IDs of the LLM-controlled cast, for the group tier. */
  llmCharacterIds: string[]
  /**
   * The single LLM character's ID, or null when the room holds several. Only a
   * one-character room can offer character scenarios unambiguously.
   */
  singleLlmCharacterId: string | null
  /** Gates the reference-data fetches until the section has been opened once. */
  enabled: boolean
  /** Fired after the scenario is saved (typically `fetchChat`). */
  onChatUpdated?: () => void
  /**
   * Every present character in the room — LLM- and user-controlled alike — for
   * the Scenario Builder: their vaults and groups scope what the Host may read,
   * and they are offered as save targets.
   */
  castCharacters?: ScenarioBuilderCastMember[]
  /** The chat's project name, for the Scenario Builder's save targets. */
  projectName?: string | null
}

export function ChatScenarioControl({
  chatId,
  projectId,
  scenarioText,
  llmCharacterIds,
  singleLlmCharacterId,
  enabled,
  onChatUpdated,
  castCharacters = [],
  projectName,
}: ChatScenarioControlProps) {
  const imagesHidden = useImagesHidden()
  const queryClient = useQueryClient()
  /**
   * What the user has picked in this sitting. Null means "nothing touched
   * yet", in which case the control shows the scene the chat already has —
   * derived below, so it keeps up as the option tiers arrive.
   */
  const [draft, setDraft] = useState<{ selection: ScenarioSelection; customText: string } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  const characterIdsKey = useMemo(
    () => [...llmCharacterIds].sort().join(','),
    [llmCharacterIds],
  )

  const { data: generalData } = useQuery({
    queryKey: queryKeys.scenarios.general(showArchived),
    queryFn: ({ signal }) =>
      apiFetch<{ scenarios: GeneralScenarioOption[] }>(
        withArchivedParam('/api/v1/scenarios', showArchived),
        { signal },
      ),
    enabled,
  })

  const { data: projectData } = useQuery({
    queryKey: queryKeys.scenarios.project(projectId ?? '', showArchived),
    queryFn: ({ signal }) =>
      apiFetch<{ scenarios: ProjectScenarioOption[] }>(
        withArchivedParam(`/api/v1/projects/${projectId}/scenarios`, showArchived),
        { signal },
      ),
    enabled: enabled && Boolean(projectId),
  })

  const { data: groupData } = useQuery({
    queryKey: queryKeys.scenarios.group(characterIdsKey, showArchived),
    queryFn: ({ signal }) =>
      apiFetch<{ groupScenarios: GroupScenarioGroup[] }>(
        withArchivedParam(
          `/api/v1/groups/scenarios?characterIds=${encodeURIComponent(characterIdsKey)}`,
          showArchived,
        ),
        { signal },
      ),
    enabled: enabled && characterIdsKey.length > 0,
  })

  const { data: characterData } = useQuery({
    queryKey: queryKeys.scenarios.character(singleLlmCharacterId ?? '', showArchived),
    queryFn: ({ signal }) =>
      apiFetch<{ scenarios: CharacterScenario[] }>(
        withArchivedParam(
          `/api/v1/characters/${singleLlmCharacterId}/scenarios`,
          showArchived,
        ),
        { signal },
      ),
    enabled: enabled && Boolean(singleLlmCharacterId),
  })

  const { data: sourceInfo } = useQuery({
    queryKey: queryKeys.chats.scenarioSource(chatId),
    queryFn: ({ signal }) =>
      apiFetch<ScenarioSourceInfo>(`/api/v1/chats/${chatId}?action=scenario-source`, { signal }),
    enabled,
  })

  const generalScenarios = useMemo(() => generalData?.scenarios ?? [], [generalData])
  const projectScenarios = useMemo(
    () => (projectId ? projectData?.scenarios ?? [] : []),
    [projectId, projectData],
  )
  const characterScenarios = useMemo(
    () => (singleLlmCharacterId ? characterData?.scenarios ?? [] : []),
    [singleLlmCharacterId, characterData],
  )

  // Flatten the grouped payload into the flat shape <ScenarioSelect> renders.
  const groupScenarios: GroupScenarioOption[] = useMemo(() => {
    const flat: GroupScenarioOption[] = []
    for (const group of groupData?.groupScenarios ?? []) {
      for (const scenario of group.scenarios) {
        flat.push({ ...scenario, groupId: group.groupId, groupName: group.groupName })
      }
    }
    return flat
  }, [groupData])

  const groupIds = useMemo(
    () => (groupData?.groupScenarios ?? []).map((g) => g.groupId),
    [groupData],
  )

  // The scene the chat already has, expressed as a picker state. A recorded
  // source is the authority: it names the preset directly, and the notes are
  // what was layered beneath it. Without one, an exact body match preselects
  // that preset and anything else (including a preset with notes layered
  // beneath it) reads as Custom with the text ready to edit. Derived rather
  // than seeded into state, so it settles as the tiers finish loading without
  // ever fighting a choice the user has since made.
  const currentAsSelection = useMemo((): { selection: ScenarioSelection; customText: string } => {
    // Only a source whose file still exists can seed a preset: a save re-reads
    // the file, and a gone one would resolve to nothing, leaving the chat with
    // the notes alone. A gone source falls through to the text below, so the
    // scene the chat actually has stays in the box.
    if (sourceInfo?.source && sourceInfo.owner && sourceInfo.exists) {
      const { source, owner } = sourceInfo
      const notes = sourceInfo.notes ?? ''
      if (owner.scope === 'general') return { selection: { kind: 'general', path: source.path }, customText: notes }
      if (owner.scope === 'project' && owner.id && owner.id === projectId) {
        return { selection: { kind: 'project', path: source.path }, customText: notes }
      }
      if (owner.scope === 'group' && owner.id && groupIds.includes(owner.id)) {
        return { selection: { kind: 'group', groupId: owner.id, path: source.path }, customText: notes }
      }
      if (owner.scope === 'character' && owner.id && owner.id === singleLlmCharacterId && sourceInfo.scenarioId) {
        return { selection: { kind: 'character', scenarioId: sourceInfo.scenarioId }, customText: notes }
      }
      return {
        selection: {
          kind: 'store',
          mountPointId: source.mountPointId,
          path: source.path,
          label: `${owner.name} › ${sourceInfo.scenarioName ?? source.path.replace(/^Scenarios\//, '').replace(/\.md$/i, '')}`,
        },
        customText: notes,
      }
    }

    const current = (scenarioText ?? '').trim()
    if (current.length === 0) return { selection: { kind: 'custom' }, customText: '' }

    const projectMatch = projectScenarios.find((s) => s.body.trim() === current)
    if (projectMatch) return { selection: { kind: 'project', path: projectMatch.path }, customText: '' }

    const generalMatch = generalScenarios.find((s) => s.body.trim() === current)
    if (generalMatch) return { selection: { kind: 'general', path: generalMatch.path }, customText: '' }

    const groupMatch = groupScenarios.find((s) => s.body.trim() === current)
    if (groupMatch) {
      return {
        selection: { kind: 'group', groupId: groupMatch.groupId, path: groupMatch.path },
        customText: '',
      }
    }

    const characterMatch = characterScenarios.find((s) => s.content.trim() === current)
    if (characterMatch) {
      return { selection: { kind: 'character', scenarioId: characterMatch.id }, customText: '' }
    }

    return { selection: { kind: 'custom' }, customText: scenarioText ?? '' }
  }, [sourceInfo, projectId, groupIds, singleLlmCharacterId, scenarioText, projectScenarios, generalScenarios, groupScenarios, characterScenarios])

  const { selection, customText } = draft ?? currentAsSelection

  // Under Custom the box is the whole scene; under a preset it is the notes
  // beneath it. Leaving Custom for a preset must not turn the old scene into
  // notes, or the new preset would be posted with the entire old scene layered
  // beneath it. Preset → preset (and preset → Custom) keep what was typed.
  const textForSelection = (next: ScenarioSelection) =>
    selection.kind === 'custom' && next.kind !== 'custom' ? '' : customText
  const setSelection = (next: ScenarioSelection) => {
    setDraft({ selection: next, customText: textForSelection(next) })
  }
  const setCustomText = (next: string) => {
    setDraft({ selection, customText: next })
  }

  // The body behind the current selection, previewed under the dropdown the
  // way the New Chat dialog previews it.
  const selectedPresetBody = useMemo(() => {
    switch (selection.kind) {
      case 'project':
        return projectScenarios.find((s) => s.path === selection.path)?.body ?? null
      case 'general':
        return generalScenarios.find((s) => s.path === selection.path)?.body ?? null
      case 'group':
        return (
          groupScenarios.find(
            (s) => s.path === selection.path && s.groupId === selection.groupId,
          )?.body ?? null
        )
      case 'character':
        return characterScenarios.find((s) => s.id === selection.scenarioId)?.content ?? null
      default:
        return null
    }
  }, [selection, projectScenarios, generalScenarios, groupScenarios, characterScenarios])

  // A pick from elsewhere carries no body in the option lists; read it by ref.
  const { data: storePreview } = useScenarioRefBody(selection.kind === 'store' ? selection : null, { enabled })
  const previewBody = selection.kind === 'store' ? storePreview?.scenario.body ?? null : selectedPresetBody

  // "Use this scene": the Host's draft becomes the custom text. The existing
  // Change-scenario button persists it, so the Host's revision announcement
  // fires exactly as for a hand-typed scene.
  const handleUseBuiltScene = (scene: string) => {
    setDraft({ selection: { kind: 'custom' }, customText: scene })
  }

  // After a save, select the new preset when this picker offers it. The dialog
  // has already awaited the invalidation, so the cache holds fresh lists.
  const handleBuiltSceneSaved = (target: SavedScenarioTarget) => {
    const hasPath = (data: { scenarios?: Array<{ path: string }> } | undefined, path: string) =>
      (data?.scenarios ?? []).some((s) => s.path === path)
    let next: ScenarioSelection | null = null
    if (target.kind === 'general') {
      const data = queryClient.getQueryData<{ scenarios: GeneralScenarioOption[] }>(
        queryKeys.scenarios.general(showArchived),
      )
      if (hasPath(data, target.path)) next = { kind: 'general', path: target.path }
    } else if (target.kind === 'project' && target.projectId === projectId) {
      const data = queryClient.getQueryData<{ scenarios: ProjectScenarioOption[] }>(
        queryKeys.scenarios.project(target.projectId, showArchived),
      )
      if (hasPath(data, target.path)) next = { kind: 'project', path: target.path }
    } else if (target.kind === 'group') {
      const data = queryClient.getQueryData<{ groupScenarios: GroupScenarioGroup[] }>(
        queryKeys.scenarios.group(characterIdsKey, showArchived),
      )
      const offered = (data?.groupScenarios ?? []).some(
        (g) => g.groupId === target.groupId && g.scenarios.some((s) => s.path === target.path),
      )
      if (offered) next = { kind: 'group', groupId: target.groupId, path: target.path }
    } else if (target.kind === 'character' && target.characterId === singleLlmCharacterId) {
      next = { kind: 'character', scenarioId: target.scenarioId }
    }
    if (next) setDraft({ selection: next, customText: '' })
  }

  const postScenario = async (payload: Record<string, unknown>) => {
    try {
      setSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}?action=scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      showSuccessToast(data?.message || 'Scenario updated')
      // Drop the draft so the control re-derives from what actually persisted —
      // the refetched chat (and its source) is the authority on what the scene now is.
      setDraft(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.scenarioSource(chatId) })
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update scenario')
    } finally {
      setSaving(false)
    }
  }

  // Under a preset the text box holds the notes beneath it; under Custom it
  // is the whole scene. Either way it travels as `scenario`.
  const handleSave = () =>
    postScenario({ ...scenarioSelectionToPayload(selection), scenario: customText })

  // The same file, re-read, with the same notes beneath — so a reload is lossless.
  const handleReload = () => {
    if (!sourceInfo?.source) return
    const { mountPointId, path } = sourceInfo.source
    return postScenario({ scenarioRef: { mountPointId, path }, scenario: sourceInfo.notes ?? '', reload: true })
  }

  return (
    <div className="qt-label">
      <span className="block mb-1">Scenario</span>
      <ScenarioSelect
        id="chat-scenario-select"
        selection={selection}
        onChange={setSelection}
        onBrowse={() => setBrowserOpen(true)}
        projectScenarios={projectScenarios}
        generalScenarios={generalScenarios}
        groupScenarios={groupScenarios}
        characterScenarios={singleLlmCharacterId ? characterScenarios : null}
        disabled={saving}
        className="qt-select text-sm mb-2"
        aria-label="Scenario"
      />
      {browserOpen && (
        <ScenarioBrowserDialog
          isOpen={browserOpen}
          onClose={() => setBrowserOpen(false)}
          hierarchy={{ projectId, groupIds, characterId: singleLlmCharacterId }}
          onPick={setSelection}
        />
      )}
      {sourceInfo?.source && sourceInfo.owner && (
        <div className="mb-2 qt-text-secondary text-xs font-normal">
          From: <em>{sourceInfo.owner.name}</em> › <em>{sourceInfo.scenarioName ?? sourceInfo.source.path}</em>
          {!sourceInfo.exists && ' — the shelf copy is gone'}
          {sourceInfo.exists && sourceInfo.changed && (
            <>
              {' — the shelf copy has been revised '}
              <button
                type="button"
                onClick={handleReload}
                disabled={saving}
                className="qt-button-secondary qt-button-sm ml-1"
              >
                Reload from source
              </button>
            </>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 mb-2 qt-text-secondary text-xs font-normal">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
          disabled={saving}
          className="qt-checkbox"
        />
        Show archived
      </label>
      <button
        type="button"
        onClick={() => setBuilderOpen(true)}
        disabled={saving}
        className="qt-button-secondary qt-button-sm inline-flex items-center gap-1.5 mb-2"
      >
        {!imagesHidden && (
          <img
            src={STAFF_AVATARS.host ?? '/images/avatars/host-avatar.webp'}
            alt=""
            className="h-4 w-4 rounded-full"
          />
        )}
        Ask the Host to set the scene
      </button>
      {builderOpen && (
        <ScenarioBuilderDialog
          isOpen={builderOpen}
          onClose={() => setBuilderOpen(false)}
          cast={castCharacters}
          projectId={projectId ?? null}
          projectName={projectName ?? null}
          chatId={chatId}
          onUse={handleUseBuiltScene}
          onSaved={handleBuiltSceneSaved}
        />
      )}
      {selection.kind === 'custom' ? (
        <textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          disabled={saving}
          rows={6}
          className="qt-textarea text-sm"
          placeholder="Set the scene for this conversation…"
          aria-label="Custom scenario text"
        />
      ) : (
        <>
          {previewBody && (
            <div className="max-h-40 overflow-y-auto rounded-lg border qt-border-default qt-bg-muted/40 px-2 py-1.5 text-xs qt-text-secondary whitespace-pre-wrap">
              {previewBody}
            </div>
          )}
          <span className="block mt-2 mb-1 text-xs">Notes beneath the scene</span>
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            disabled={saving}
            rows={3}
            className="qt-textarea text-sm"
            placeholder="Anything to add beneath the preset (optional)…"
            aria-label="Notes beneath the scene"
          />
        </>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="qt-tool-palette-button mt-2"
      >
        {saving ? 'Setting the scene…' : 'Change scenario'}
      </button>
      <span className="block mt-1 qt-text-secondary text-xs">
        Changing the scene rewrites every character&rsquo;s standing instructions, and the Host
        announces the revision to the company.
      </span>
    </div>
  )
}
