'use client'

/**
 * Projects Grid
 *
 * Displays a grid of project cards or empty state.
 */

import { useRouter } from 'next/navigation'
import { ProjectCard } from './ProjectCard'
import type { Project } from '../types'

interface ProjectsGridProps {
  projects: Project[]
  onCreateClick: () => void
  onDeleteClick: (projectId: string) => void
}

export function ProjectsGrid({ projects, onCreateClick, onDeleteClick }: ProjectsGridProps) {
  const router = useRouter()

  const handleCardClick = (e: React.MouseEvent, projectId: string) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    router.push(`/prospero/${projectId}`)
  }

  if (projects.length === 0) {
    return (
      <div className="mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
        <p className="mb-4 text-lg qt-text-secondary">No projects yet</p>
        <button
          onClick={onCreateClick}
          className="qt-text-primary hover:text-primary/80"
        >
          Create your first project
        </button>
      </div>
    )
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onClick={(e) => handleCardClick(e, project.id)}
          onDelete={() => onDeleteClick(project.id)}
        />
      ))}
    </div>
  )
}
