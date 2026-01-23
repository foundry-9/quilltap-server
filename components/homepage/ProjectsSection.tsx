/**
 * ProjectsSection
 *
 * Server component displaying active projects on the homepage.
 */

import Link from 'next/link'
import { ProjectItem } from './ProjectItem'
import type { ProjectsSectionProps } from './types'

export function ProjectsSection({ projects }: ProjectsSectionProps) {
  return (
    <div className="qt-homepage-section">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Active Projects</h2>
        <Link href="/projects" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {projects.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No projects yet</p>
            <p className="text-xs">Create a project to organize your chats</p>
          </div>
        ) : (
          projects.map(project => (
            <ProjectItem key={project.id} project={project} />
          ))
        )}
      </div>
    </div>
  )
}
