'use client'

/**
 * Project Detail Page
 *
 * Displays project details with tabs for chats, files, characters, and settings.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import { clientLogger } from '@/lib/client-logger'

interface ProjectCharacter {
  id: string
  name: string
  avatarUrl?: string | null
  chatCount: number
}

interface ProjectChat {
  id: string
  title?: string | null
  messageCount: number
  participants: Array<{ id: string; name: string; avatarUrl?: string | null }>
  updatedAt: string
}

interface ProjectFile {
  id: string
  originalFilename: string
  mimeType: string
  size: number
  category: string
  createdAt: string
}

interface Project {
  id: string
  name: string
  description?: string | null
  instructions?: string | null
  allowAnyCharacter: boolean
  color?: string | null
  icon?: string | null
  characterRoster: ProjectCharacter[]
  createdAt: string
  updatedAt: string
}

type TabType = 'chats' | 'files' | 'characters' | 'settings'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const { refreshProjects } = useSidebarData()

  const [project, setProject] = useState<Project | null>(null)
  const [chats, setChats] = useState<ProjectChat[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('chats')
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', instructions: '' })

  useEffect(() => {
    clientLogger.debug('ProjectDetailPage: mounted', { projectId })
    fetchProject()
  }, [projectId])

  useEffect(() => {
    if (activeTab === 'chats') fetchChats()
    if (activeTab === 'files') fetchFiles()
  }, [activeTab, projectId])

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error('Project not found')
      const data = await res.json()
      setProject(data.project)
      setEditForm({
        name: data.project.name,
        description: data.project.description || '',
        instructions: data.project.instructions || '',
      })
    } catch (err) {
      clientLogger.error('ProjectDetailPage: fetch error', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const fetchChats = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats`)
      if (res.ok) {
        const data = await res.json()
        setChats(data.chats || [])
      }
    } catch (err) {
      clientLogger.error('ProjectDetailPage: failed to fetch chats', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const fetchFiles = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/files`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
      }
    } catch (err) {
      clientLogger.error('ProjectDetailPage: failed to fetch files', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description || null,
          instructions: editForm.instructions || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      setIsEditing(false)
      showSuccessToast('Project updated!')
      refreshProjects()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update project')
    }
  }

  const handleToggleAllowAnyCharacter = async () => {
    if (!project) return
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAnyCharacter: !project.allowAnyCharacter }),
      })

      if (!res.ok) throw new Error('Failed to update project')
      const data = await res.json()
      setProject(data.project)
      showSuccessToast(data.project.allowAnyCharacter ? 'Any character can now participate' : 'Only roster characters can participate')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update setting')
    }
  }

  const handleRemoveCharacter = async (characterId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/characters?characterId=${characterId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to remove character')
      await fetchProject()
      showSuccessToast('Character removed from project')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to remove character')
    }
  }

  const handleRemoveChat = async (chatId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/chats?chatId=${chatId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to remove chat')
      setChats(chats.filter(c => c.id !== chatId))
      showSuccessToast('Chat removed from project')
      refreshProjects()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to remove chat')
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-6">
        <div className="flex items-center gap-4">
          <Link href="/projects" className="qt-text-primary hover:underline text-sm">
            &larr; Projects
          </Link>
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center text-xl"
            style={{ backgroundColor: project.color || 'var(--muted)' }}
          >
            {project.icon || (
              <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            )}
          </div>
          <div>
            {isEditing ? (
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="text-2xl font-semibold bg-transparent border-b border-primary focus:outline-none"
              />
            ) : (
              <h1 className="text-2xl font-semibold">{project.name}</h1>
            )}
            {isEditing ? (
              <input
                type="text"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Add a description..."
                className="qt-text-small bg-transparent border-b border-border focus:outline-none w-full"
              />
            ) : (
              project.description && <p className="qt-text-small">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/chats/new?projectId=${projectId}`}
            className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow hover:bg-success/90"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </Link>
          {isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
              >
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-sm hover:bg-muted"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border/60 mt-6">
        {(['chats', 'files', 'characters', 'settings'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'chats' && ` (${chats.length})`}
            {tab === 'files' && ` (${files.length})`}
            {tab === 'characters' && ` (${project.characterRoster.length})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {/* Chats Tab */}
        {activeTab === 'chats' && (
          <div>
            {chats.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No chats in this project yet.</p>
                <p className="text-sm mt-2">
                  <Link
                    href={`/chats/new?projectId=${projectId}`}
                    className="text-primary hover:underline"
                  >
                    Create a new chat
                  </Link>{' '}
                  or add existing chats from chat settings.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {chats.map((chat) => (
                  <div key={chat.id} className="qt-entity-card flex items-center justify-between">
                    <div>
                      <Link href={`/chats/${chat.id}`} className="font-medium hover:text-primary">
                        {chat.title || 'Untitled Chat'}
                      </Link>
                      <p className="qt-text-small">
                        {chat.messageCount} message{chat.messageCount !== 1 ? 's' : ''} &bull;{' '}
                        {chat.participants.map(p => p.name).join(', ')}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveChat(chat.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove from project"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === 'files' && (
          <div>
            {files.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No files in this project yet.</p>
                <p className="text-sm mt-2">Drag and drop files here to add them.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {files.map((file) => (
                  <div key={file.id} className="qt-entity-card flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                        {file.mimeType.startsWith('image/') ? (
                          <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{file.originalFilename}</p>
                        <p className="qt-text-small">{formatBytes(file.size)} &bull; {file.category}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Characters Tab */}
        {activeTab === 'characters' && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="qt-text-small">
                {project.allowAnyCharacter
                  ? 'Any character can participate in chats for this project.'
                  : 'Only characters in the roster can participate in project chats.'}
              </p>
            </div>

            {project.characterRoster.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No characters in the roster yet.</p>
                <p className="text-sm mt-2">Characters are added automatically when chats are associated with this project.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {project.characterRoster.map((char) => (
                  <div key={char.id} className="qt-entity-card flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {char.avatarUrl ? (
                        <img src={char.avatarUrl} alt={char.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg font-semibold">
                          {char.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <Link href={`/characters/${char.id}/view`} className="font-medium hover:text-primary">
                          {char.name}
                        </Link>
                        <p className="qt-text-small">{char.chatCount} chat{char.chatCount !== 1 ? 's' : ''} in project</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveCharacter(char.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove from roster"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-6">
            {/* Instructions */}
            <div>
              <h3 className="text-lg font-medium mb-2">Project Instructions</h3>
              <p className="qt-text-small mb-3">
                These instructions are included in the system prompt for all conversations in this project.
              </p>
              <textarea
                value={editForm.instructions}
                onChange={(e) => setEditForm({ ...editForm, instructions: e.target.value })}
                rows={6}
                placeholder="Add instructions for characters in this project..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleSave}
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
                >
                  Save Instructions
                </button>
              </div>
            </div>

            {/* Allow Any Character */}
            <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
              <div>
                <h4 className="font-medium">Allow Any Character</h4>
                <p className="qt-text-small">
                  When enabled, any character can participate in project chats. When disabled, only roster characters can participate.
                </p>
              </div>
              <button
                onClick={handleToggleAllowAnyCharacter}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  project.allowAnyCharacter ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    project.allowAnyCharacter ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
