/**
 * ProjectsSection
 *
 * The projects shelf: one tile per project, as many rows as it takes. A
 * household with no projects gets no shelf at all rather than an empty one —
 * New Project lives among the quick actions.
 */

import Link from 'next/link'
import { ProjectItem } from './ProjectItem'
import type { ProjectsSectionProps } from './types'

export function ProjectsSection({ projects }: ProjectsSectionProps) {
  if (projects.length === 0) return null

  return (
    <section className="qt-homepage-section" data-section="projects">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Projects</h2>
        <Link href="/prospero" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {projects.map(project => (
          <ProjectItem key={project.id} project={project} />
        ))}
      </div>
    </section>
  )
}
