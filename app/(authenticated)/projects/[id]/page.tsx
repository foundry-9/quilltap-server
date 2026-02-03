'use client'

/**
 * Project Detail Page
 *
 * Displays project details with a card-based layout:
 * - Three expandable cards at the top (Files, Characters, Settings)
 * - Infinite scrolling list of chats below
 */

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useProjectDetail, useProjectChats, useProjectFiles, useProjectCardState } from './hooks'
import {
  ProjectDetailHeader,
  FilesCard,
  CharactersCard,
  SettingsCard,
  ChatsSection,
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
    handleSaveBackgroundDisplayMode,
    handleRemoveCharacter,
  } = useProjectDetail(projectId)

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

  // Card expansion state - all open on first visit, all closed on subsequent visits
  const { cardState, toggleCard } = useProjectCardState(projectId)

  useEffect(() => {
    fetchProject()
    fetchChats()
    fetchFiles()
  }, [projectId, fetchProject, fetchChats, fetchFiles])

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
          <p className="text-lg text-destructive mb-4">{error || 'Project not found'}</p>
          <Link href="/projects" className="qt-text-primary hover:underline">
            Back to Projects
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="qt-page-container text-foreground">
      <ProjectDetailHeader
        project={project}
        isEditing={isEditing}
        editForm={editForm}
        onEditFormChange={setEditForm}
        onEditClick={() => setIsEditing(true)}
        onCancelEdit={() => setIsEditing(false)}
        onSave={handleSave}
      />

      {/* Cards grid - 3 across on wide desktop, 2 on medium, 1 on mobile */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <FilesCard
          files={files}
          expanded={cardState.files}
          onToggle={() => toggleCard('files')}
          projectId={projectId}
          onFilesChange={fetchFiles}
        />
        <CharactersCard
          project={project}
          onRemoveCharacter={handleRemoveCharacter}
          expanded={cardState.characters}
          onToggle={() => toggleCard('characters')}
        />
        <SettingsCard
          project={project}
          editForm={editForm}
          onEditFormChange={setEditForm}
          onSave={handleSave}
          onToggleAllowAnyCharacter={handleToggleAllowAnyCharacter}
          onAgentModeChange={handleSaveAgentMode}
          onBackgroundDisplayModeChange={handleSaveBackgroundDisplayMode}
          expanded={cardState.settings}
          onToggle={() => toggleCard('settings')}
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
