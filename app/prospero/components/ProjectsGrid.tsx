'use client'

/**
 * Projects Grid
 *
 * Displays a grid of project cards or empty state.
 */

import { useRouter } from 'next/navigation'
import { EmptyStatePanel } from '@/components/ui/EmptyState'
import { ProjectCard } from './ProjectCard'
import type { Project } from '../types'

interface ProjectsGridProps {
  projects: Project[]
  onCreateClick: () => void
  onDeleteClick: (projectId: string) => void
  /** When provided (workspace tab), open the project in place instead of routing. */
  onOpenProject?: (projectId: string) => void
}

export function ProjectsGrid({ projects, onCreateClick, onDeleteClick, onOpenProject }: ProjectsGridProps) {
  const router = useRouter()

  const handleCardClick = (e: React.MouseEvent, projectId: string) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('a')) {
      return
    }
    if (onOpenProject) onOpenProject(projectId)
    else router.push(`/prospero/${projectId}`)
  }

  if (projects.length === 0) {
    return (
      <EmptyStatePanel>
        <p className="mb-4 text-lg qt-text-secondary">No projects yet</p>
        <button
          onClick={onCreateClick}
          className="qt-text-primary hover:qt-text-brand/80"
        >
          Create your first project
        </button>
      </EmptyStatePanel>
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
          onOpen={onOpenProject}
        />
      ))}
    </div>
  )
}
