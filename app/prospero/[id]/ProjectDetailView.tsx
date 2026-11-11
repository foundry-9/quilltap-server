'use client'

/**
 * Project Detail — the body of a single project's page as a props-driven view,
 * so it renders either at `/prospero/[id]` (route wrapper supplies a router
 * `onBack`) or in place inside the Prospero workspace tab (the list view
 * supplies a state `onBack`), keeping the workspace mounted for keep-alive.
 *
 * @module app/prospero/[id]/ProjectDetailView
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useImageProfilesQuery } from '@/lib/hooks/use-profiles'
import { useProjectFilesQuery } from '@/lib/hooks/use-project-files'
import { useOwnerStoreLinks } from '@/lib/hooks/use-owner-store-links'
import type { DocumentStore } from '@/app/scriptorium/types'
import { useProjectDetail, useProjectChats, useProjectCardState } from './hooks'
import type { ProjectFile } from './types'
import { useStoryBackground } from '@/hooks/useStoryBackground'
import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useReportWorkspaceBackdrop } from '@/components/workspace/workspace-backdrop'
import {
  ProjectDetailHeader,
  FilesCard,
  CharactersCard,
  SettingsCard,
  ModelBehaviorCard,
  ImageGenerationCard,
  ChatsSection,
  DocumentStoresCard,
  ScenariosCard,
  WardrobeCard,
  InventoryCard,
  AtlasCard,
} from './components'

interface ImageProfileOption {
  id: string
  name: string
  provider: string
  modelName: string
}

const NO_IMAGE_PROFILES: ImageProfileOption[] = []
const NO_FILES: ProjectFile[] = []

export interface ProjectDetailViewProps {
  projectId: string
  onBack: () => void
}

export function ProjectDetailView({ projectId, onBack }: ProjectDetailViewProps) {
  const {
    project,
    loading,
    error,
    headerDraft,
    setHeaderDraft,
    instructionsDraft,
    setInstructionsDraft,
    instructionsDirty,
    isEditing,
    startEditing,
    cancelEditing,
    handleSaveHeader,
    handleSaveInstructions,
    handleToggleAllowAnyCharacter,
    handleSaveAgentMode,
    handleSaveAnswerConfirmationOverride,
    handleSaveAvatarGeneration,
    handleSaveDefaultImageProfile,
    handleSaveDefaultRoleplayTemplate,
    handleSaveBrahmaConnectionProfile,
    handleSaveBackgroundDisplayMode,
    handleSaveAlertCharactersOfLanternImages,
    handleAddCharacter,
    handleRemoveCharacter,
  } = useProjectDetail(projectId)

  // Image profiles for the default image profile selector (the shared list).
  const { data: imageProfiles = NO_IMAGE_PROFILES } = useImageProfilesQuery<ImageProfileOption>()

  const {
    chats,
    loading: chatsLoading,
    loadingMore,
    pagination,
    loadMoreChats,
    handleRemoveChat,
  } = useProjectChats(projectId)

  const queryClient = useQueryClient()
  const { data: files = NO_FILES } = useProjectFilesQuery<ProjectFile>(projectId)
  const refreshFiles = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.files(projectId) })
  }, [queryClient, projectId])

  const { linkedStores, allStores, linkStore, unlinkStore } = useOwnerStoreLinks<DocumentStore>('project', projectId)

  // Card expansion state - all open on first visit, all closed on subsequent visits
  const { cardState, toggleCard } = useProjectCardState(projectId)

  // Story background - fetch background image for project based on display mode
  // Pass null for chatId since we're on the project page, not a specific chat
  const { backgroundUrl: storyBackgroundUrl } = useStoryBackground(
    null,
    projectId,
    project?.backgroundDisplayMode !== 'theme' // Enable passive polling when backgrounds are enabled
  )

  // Inside the workspace the per-view ::before layer is suppressed in favour of
  // the one arbitrated backdrop, so the story background below only reaches the
  // screen if this view reports it. The Prospero subsystem image is the
  // fallback, matching what the list view behind us paints when the project
  // asks for no background of its own ('theme' mode).
  const { backgroundImage: prosperoBackgroundImage } = useSubsystemInfo('prospero')
  useReportWorkspaceBackdrop(storyBackgroundUrl || prosperoBackgroundImage || null, false)

  // Every read on this page is a query under the `projects` prefix (or the
  // store and profile lists), so the Prospero tab's activation refetch and
  // the realtime topics refresh it; the project re-read never touches an
  // edited draft (#170).

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text">Loading project...</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">{error || 'Project not found'}</p>
          <button onClick={onBack} className="qt-text-primary hover:underline">
            Back to Projects
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="qt-page-container qt-text"
      style={storyBackgroundUrl ? { '--story-background-url': `url('${storyBackgroundUrl}')` } as React.CSSProperties : undefined}
    >
      <ProjectDetailHeader
        project={project}
        isEditing={isEditing}
        draft={headerDraft}
        onDraftChange={setHeaderDraft}
        onEditClick={startEditing}
        onCancelEdit={cancelEditing}
        onSave={handleSaveHeader}
        onBack={onBack}
      />

      {/* Cards grid - 3 columns on wide desktop, 2 on medium, 1 on mobile.
           Compact cards flow through the columns; the two cards that host a
           Lexical editor (Project Settings, Image Generation) span the full
           width at the bottom so the editors aren't squeezed into a column. */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 grid-flow-row-dense">
        <FilesCard
          files={files}
          expanded={cardState.files}
          onToggle={() => toggleCard('files')}
          projectId={projectId}
          onFilesChange={refreshFiles}
        />
        <DocumentStoresCard
          linkedStores={linkedStores}
          allStores={allStores}
          expanded={cardState.documentStores}
          onToggle={() => toggleCard('documentStores')}
          onLink={linkStore}
          onUnlink={unlinkStore}
        />
        <ScenariosCard
          projectId={projectId}
          projectName={project.name}
          expanded={cardState.scenarios}
          onToggle={() => toggleCard('scenarios')}
        />
        <WardrobeCard
          projectId={projectId}
          projectName={project.name}
          expanded={cardState.wardrobe}
          onToggle={() => toggleCard('wardrobe')}
        />
        <InventoryCard
          projectId={projectId}
          expanded={cardState.inventory}
          onToggle={() => toggleCard('inventory')}
        />
        <AtlasCard
          projectId={projectId}
          expanded={cardState.atlas}
          onToggle={() => toggleCard('atlas')}
        />
        <CharactersCard
          project={project}
          onAddCharacter={handleAddCharacter}
          onRemoveCharacter={handleRemoveCharacter}
          onToggleAllowAnyCharacter={handleToggleAllowAnyCharacter}
          expanded={cardState.characters}
          onToggle={() => toggleCard('characters')}
        />
        <ModelBehaviorCard
          project={project}
          onAgentModeChange={handleSaveAgentMode}
          onAnswerConfirmationOverrideChange={handleSaveAnswerConfirmationOverride}
          onDefaultRoleplayTemplateChange={handleSaveDefaultRoleplayTemplate}
          onBrahmaConnectionProfileChange={handleSaveBrahmaConnectionProfile}
          expanded={cardState.modelBehavior}
          onToggle={() => toggleCard('modelBehavior')}
        />
        {/* Full-width cards (host Lexical editors) — kept last so they stack
            across the whole grid instead of flexing beside a compact card. */}
        <SettingsCard
          project={project}
          instructions={instructionsDraft}
          onInstructionsChange={setInstructionsDraft}
          instructionsDirty={instructionsDirty}
          onSave={handleSaveInstructions}
          expanded={cardState.settings}
          onToggle={() => toggleCard('settings')}
        />
        <ImageGenerationCard
          project={project}
          imageProfiles={imageProfiles}
          onAvatarGenerationChange={handleSaveAvatarGeneration}
          onDefaultImageProfileChange={handleSaveDefaultImageProfile}
          onBackgroundDisplayModeChange={handleSaveBackgroundDisplayMode}
          onAlertCharactersOfLanternImagesChange={handleSaveAlertCharactersOfLanternImages}
          expanded={cardState.imageGeneration}
          onToggle={() => toggleCard('imageGeneration')}
        />
      </div>

      {/* Infinite scrolling chats section */}
      <ChatsSection
        projectId={projectId}
        chats={chats}
        loading={chatsLoading}
        loadingMore={loadingMore}
        hasMore={pagination.hasMore}
        total={pagination.total}
        onLoadMore={loadMoreChats}
        onRemoveChat={handleRemoveChat}
      />
    </div>
  )
}
