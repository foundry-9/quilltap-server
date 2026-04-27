'use client'

/**
 * Project Detail Page
 *
 * Displays project details with a card-based layout:
 * - Three expandable cards at the top (Files, Characters, Settings)
 * - Infinite scrolling list of chats below
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useProjectDetail, useProjectChats, useProjectFiles, useProjectCardState, useProjectDocumentStores } from './hooks'
import { useStoryBackground } from '@/hooks/useStoryBackground'
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
} from './components'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string

  const {
    project,
    loading,
    error,
    editForm,
    setEditForm,
    isEditing,
    setIsEditing,
    fetchProject,
    handleSave,
    handleToggleAllowAnyCharacter,
    handleSaveAgentMode,
    handleSaveAvatarGeneration,
    handleSaveDefaultImageProfile,
    handleSaveBackgroundDisplayMode,
    handleSaveAlertCharactersOfLanternImages,
    handleRemoveCharacter,
  } = useProjectDetail(projectId)

  // Image profiles for the default image profile selector
  const [imageProfiles, setImageProfiles] = useState<Array<{ id: string; name: string; provider: string; modelName: string }>>([])


  const {
    chats,
    loading: chatsLoading,
    loadingMore,
    pagination,
    fetchChats,
    loadMoreChats,
    handleRemoveChat,
  } = useProjectChats(projectId)

  const { files, fetchFiles } = useProjectFiles(projectId)

  const {
    linkedStores,
    allStores,
    fetchLinkedStores,
    fetchAllStores,
    linkStore,
    unlinkStore,
  } = useProjectDocumentStores(projectId)

  // Card expansion state - all open on first visit, all closed on subsequent visits
  const { cardState, toggleCard } = useProjectCardState(projectId)

  // Story background - fetch background image for project based on display mode
  // Pass null for chatId since we're on the project page, not a specific chat
  const { backgroundUrl: storyBackgroundUrl } = useStoryBackground(
    null,
    projectId,
    project?.backgroundDisplayMode !== 'theme' // Enable passive polling when backgrounds are enabled
  )

  useEffect(() => {
    fetchProject()
    fetchChats()
    fetchFiles()
    fetchLinkedStores()
    fetchAllStores()
    // Fetch image profiles for the default image profile selector
    fetch('/api/v1/image-profiles')
      .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load image profiles')))
      .then(data => setImageProfiles(data?.profiles || []))
      .catch(() => {/* non-critical, selector will just be empty */})
  }, [projectId, fetchProject, fetchChats, fetchFiles, fetchLinkedStores, fetchAllStores])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading project...</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">{error || 'Project not found'}</p>
          <Link href="/prospero" className="qt-text-primary hover:underline">
            Back to Projects
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div
      className="qt-page-container text-foreground"
      style={storyBackgroundUrl ? { '--story-background-url': `url('${storyBackgroundUrl}')` } as React.CSSProperties : undefined}
    >
      <ProjectDetailHeader
        project={project}
        isEditing={isEditing}
        editForm={editForm}
        onEditFormChange={setEditForm}
        onEditClick={() => setIsEditing(true)}
        onCancelEdit={() => setIsEditing(false)}
        onSave={handleSave}
      />

      {/* Cards grid - 3 columns on wide desktop, 2 on medium, 1 on mobile
           Layout: Files          | Characters       | Project Settings (row-span-2)
                   Model Behavior | Image Generation |                               */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 grid-flow-row-dense">
        <FilesCard
          files={files}
          expanded={cardState.files}
          onToggle={() => toggleCard('files')}
          projectId={projectId}
          onFilesChange={fetchFiles}
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
          expanded={cardState.scenarios}
          onToggle={() => toggleCard('scenarios')}
        />
        <CharactersCard
          project={project}
          onRemoveCharacter={handleRemoveCharacter}
          onToggleAllowAnyCharacter={handleToggleAllowAnyCharacter}
          expanded={cardState.characters}
          onToggle={() => toggleCard('characters')}
        />
        <SettingsCard
          project={project}
          editForm={editForm}
          onEditFormChange={setEditForm}
          onSave={handleSave}
          expanded={cardState.settings}
          onToggle={() => toggleCard('settings')}
        />
        <ModelBehaviorCard
          project={project}
          onAgentModeChange={handleSaveAgentMode}
          expanded={cardState.modelBehavior}
          onToggle={() => toggleCard('modelBehavior')}
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
