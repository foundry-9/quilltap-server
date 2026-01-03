'use client'

/**
 * Projects List Page
 *
 * Displays all user projects with counts and actions.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import { clientLogger } from '@/lib/client-logger'

interface Project {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  chatCount: number
  fileCount: number
  characterCount: number
  createdAt: string
  updatedAt: string
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  const { refreshProjects } = useSidebarData()
  const router = useRouter()

  useEffect(() => {
    clientLogger.debug('ProjectsPage: mounted')
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      clientLogger.debug('ProjectsPage: fetching projects')
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')
      const data = await res.json()
      setProjects(data.projects)
    } catch (err) {
      clientLogger.error('ProjectsPage: fetch error', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null }),
      })

      if (!res.ok) throw new Error('Failed to create project')

      const data = await res.json()
      setProjects([data.project, ...projects])
      setCreateDialogOpen(false)
      showSuccessToast('Project created successfully!')
      refreshProjects()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to create project')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete project')

      setProjects(projects.filter(p => p.id !== id))
      setDeleteProjectId(null)
      showSuccessToast('Project deleted successfully!')
      refreshProjects()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  const handleCardClick = (e: React.MouseEvent, projectId: string) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    router.push(`/projects/${projectId}`)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading projects...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="qt-page-container text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
        <h1 className="text-3xl font-semibold leading-tight">Projects</h1>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="qt-button inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Create Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-border/70 bg-card/80 px-8 py-12 text-center shadow-sm">
          <p className="mb-4 text-lg text-muted-foreground">No projects yet</p>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="qt-text-primary hover:text-primary/80"
          >
            Create your first project
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="qt-entity-card cursor-pointer hover:border-primary/50 transition-colors"
              onClick={(e) => handleCardClick(e, project.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                    style={{ backgroundColor: project.color || 'var(--muted)' }}
                  >
                    {project.icon || (
                      <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{project.name}</h2>
                    <p className="qt-text-small">
                      {project.chatCount} chat{project.chatCount !== 1 ? 's' : ''} &bull; {project.fileCount} file{project.fileCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {project.description && (
                <p className="line-clamp-2 qt-text-small mb-4">{project.description}</p>
              )}

              <div className="qt-entity-card-actions flex gap-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
                >
                  Open
                </Link>
                <button
                  onClick={() => setDeleteProjectId(project.id)}
                  className="qt-button-destructive shadow-sm"
                  title="Delete project"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Dialog */}
      {createDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-foreground">Create Project</h3>
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label className="mb-2 block text-sm qt-text-primary">Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  maxLength={100}
                  placeholder="My Project"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="mb-4">
                <label className="mb-2 block text-sm qt-text-primary">Description (optional)</label>
                <textarea
                  name="description"
                  maxLength={2000}
                  rows={3}
                  placeholder="What is this project about?"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setCreateDialogOpen(false)}
                  className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm qt-text-primary shadow-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteProjectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-foreground">Delete Project</h3>
            <p className="mb-4 qt-text-small">
              Are you sure you want to delete this project? Chats and files will be disassociated but not deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteProjectId(null)}
                className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm qt-text-primary shadow-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteProjectId)}
                className="inline-flex items-center rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
