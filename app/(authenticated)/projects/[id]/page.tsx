'use client'

/**
 * Project Detail Page
 *
 * Displays project details with tabs for chats, files, characters, and settings.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { clientLogger } from '@/lib/client-logger'
import { useProjectDetail, useProjectChats, useProjectFiles } from './hooks'
import {
  ProjectDetailHeader,
  ProjectTabs,
  ChatsTab,
  FilesTab,
  CharactersTab,
  SettingsTab,
} from './components'
import type { TabType } from './types'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const [activeTab, setActiveTab] = useState<TabType>('chats')

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
    handleRemoveCharacter,
  } = useProjectDetail(projectId)

  const { chats, fetchChats, handleRemoveChat } = useProjectChats(projectId)
  const { files, fetchFiles } = useProjectFiles(projectId)

  useEffect(() => {
    clientLogger.debug('ProjectDetailPage: mounted', { projectId })
    fetchProject()
  }, [projectId, fetchProject])

  useEffect(() => {
    if (activeTab === 'chats') fetchChats()
    if (activeTab === 'files') fetchFiles()
  }, [activeTab, fetchChats, fetchFiles])

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

      <ProjectTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        chatCount={chats.length}
        fileCount={files.length}
        characterCount={project.characterRoster.length}
      />

      <div className="mt-6">
        {activeTab === 'chats' && (
          <ChatsTab
            projectId={projectId}
            chats={chats}
            onRemoveChat={handleRemoveChat}
          />
        )}

        {activeTab === 'files' && (
          <FilesTab files={files} />
        )}

        {activeTab === 'characters' && (
          <CharactersTab
            project={project}
            onRemoveCharacter={handleRemoveCharacter}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            project={project}
            editForm={editForm}
            onEditFormChange={setEditForm}
            onSave={handleSave}
            onToggleAllowAnyCharacter={handleToggleAllowAnyCharacter}
          />
        )}
      </div>
    </div>
  )
}
