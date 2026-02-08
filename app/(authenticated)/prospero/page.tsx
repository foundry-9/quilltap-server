'use client'

/**
 * Projects List Page
 *
 * Displays all user projects with counts and actions.
 */

import { useEffect, useState } from 'react'
import { useProjects } from './hooks/useProjects'
import { ProjectsGrid, CreateProjectDialog, DeleteProjectDialog } from './components'

export default function ProjectsPage() {
  const { projects, loading, error, fetchProjects, createProject, deleteProject } = useProjects()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleCreate = async (name: string, description: string | null) => {
    const result = await createProject(name, description)
    if (result) {
      setCreateDialogOpen(false)
    }
  }

  const handleDelete = async () => {
    if (deleteProjectId) {
      const success = await deleteProject(deleteProjectId)
      if (success) {
        setDeleteProjectId(null)
      }
    }
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
    <div className="qt-page-container text-foreground" style={{ '--story-background-url': 'url(/images/prospero.png)' } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
        <h1 className="text-3xl font-semibold leading-tight">Projects</h1>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="qt-button inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Create Project
        </button>
      </div>

      <ProjectsGrid
        projects={projects}
        onCreateClick={() => setCreateDialogOpen(true)}
        onDeleteClick={setDeleteProjectId}
      />

      <CreateProjectDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreate}
      />

      <DeleteProjectDialog
        open={deleteProjectId !== null}
        onClose={() => setDeleteProjectId(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
