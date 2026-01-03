'use client'

/**
 * Projects Section
 *
 * Displays user's projects in the sidebar with counts.
 * Uses SidebarDataProvider for centralized data fetching and refresh.
 *
 * @module components/layout/left-sidebar/projects-section
 */

import Link from 'next/link'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useSidebarData, type SidebarProject } from '@/components/providers/sidebar-data-provider'
import { SidebarSection } from './sidebar-section'
import { ViewAllLink } from './sidebar-item'

/**
 * Folder icon for projects
 */
function FolderIcon({ className, color }: { className?: string; color?: string | null }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={color || 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ProjectItem({
  project,
  isCollapsed,
  onClick,
}: {
  project: SidebarProject
  isCollapsed: boolean
  onClick: () => void
}) {
  const totalCount = project.chatCount + project.fileCount

  return (
    <Link
      href={`/projects/${project.id}`}
      className={`qt-left-sidebar-item ${isCollapsed ? 'justify-center px-0' : ''}`}
      onClick={onClick}
      title={isCollapsed ? `${project.name} (${totalCount} items)` : undefined}
    >
      <span className="qt-left-sidebar-item-icon">
        {project.icon ? (
          <span className="text-sm">{project.icon}</span>
        ) : (
          <FolderIcon className="w-4 h-4" color={project.color} />
        )}
      </span>
      {!isCollapsed && (
        <>
          <span className="qt-left-sidebar-item-label flex-1">{project.name}</span>
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {totalCount}
            </span>
          )}
        </>
      )}
    </Link>
  )
}

export function ProjectsSection() {
  const { isCollapsed, closeMobile, isMobile } = useSidebar()
  const { projects, loading } = useSidebarData()

  const handleItemClick = () => {
    if (isMobile) {
      closeMobile()
    }
  }

  // Loading state
  if (loading) {
    return (
      <SidebarSection id="projects" title="Projects">
        <div className="px-2 py-1 text-xs text-muted-foreground animate-pulse">
          {!isCollapsed && 'Loading...'}
        </div>
      </SidebarSection>
    )
  }

  // Empty state
  if (projects.length === 0) {
    return (
      <SidebarSection id="projects" title="Projects">
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {!isCollapsed && 'No projects yet'}
        </div>
        <ViewAllLink href="/projects" label="Create one" />
      </SidebarSection>
    )
  }

  return (
    <SidebarSection id="projects" title="Projects">
      {projects.slice(0, 5).map(project => (
        <ProjectItem
          key={project.id}
          project={project}
          isCollapsed={isCollapsed}
          onClick={handleItemClick}
        />
      ))}
      {projects.length > 5 && <ViewAllLink href="/projects" />}
    </SidebarSection>
  )
}
