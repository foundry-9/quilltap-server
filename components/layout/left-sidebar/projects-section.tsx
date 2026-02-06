'use client'

/**
 * Projects Section
 *
 * Displays user's projects in the sidebar with expandable chat lists.
 * Uses SidebarDataProvider for centralized data fetching and refresh.
 * Projects can be expanded to show their associated chats.
 *
 * @module components/layout/left-sidebar/projects-section
 */

import Link from 'next/link'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useSidebarData, type SidebarProject, type SidebarChat } from '@/components/providers/sidebar-data-provider'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
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

/**
 * Chevron icon for expand/collapse toggle
 */
function ChevronIcon({ className, rotated }: { className?: string; rotated?: boolean }) {
  return (
    <svg
      className={`${className || ''} transition-transform duration-200 ${rotated ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

/**
 * Message icon (for default chat icon)
 */
function MessageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function getChatDisplayName(chat: SidebarChat): string {
  if (chat.title) return chat.title
  // Filter out undefined participants and those without names
  const validParticipants = chat.participants.filter(p => p && p.name)
  if (validParticipants.length > 0) {
    const names = validParticipants.map(p => p.name)
    if (names.length <= 2) return names.join(' & ')
    return `${names[0]} +${names.length - 1}`
  }
  return 'Untitled Chat'
}

/**
 * Chat item displayed under an expanded project
 */
function ProjectChatItem({
  chat,
}: {
  chat: SidebarChat
}) {
  const displayName = getChatDisplayName(chat)
  const firstParticipant = chat.participants[0]
  const avatarSrc = firstParticipant?.avatarUrl
  const messageCount = chat.messageCount || 0

  return (
    <Link
      href={`/chats/${chat.id}`}
      className="qt-left-sidebar-item pl-6"
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={displayName}
          className="w-5 h-5 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <MessageIcon className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
      <span className="qt-left-sidebar-item-label flex-1 truncate text-sm">{displayName}</span>
      {messageCount > 0 && (
        <span className="ml-auto px-1.5 py-0.5 text-xs bg-muted text-muted-foreground rounded-full flex-shrink-0">
          {messageCount > 999 ? '999+' : messageCount}
        </span>
      )}
      {chat.isDangerous && (
        <span className="qt-text-destructive text-xs flex-shrink-0" title="Flagged as dangerous" aria-label="Flagged as dangerous">*</span>
      )}
    </Link>
  )
}

function ProjectItem({
  project,
  isCollapsed,
  isExpanded,
  onToggleExpand,
  projectChats,
}: {
  project: SidebarProject
  isCollapsed: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  projectChats: SidebarChat[]
}) {
  const totalCount = project.chatCount + project.fileCount
  const hasChats = projectChats.length > 0

  const handleExpandClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleExpand()
  }

  return (
    <div>
      <div className={`qt-left-sidebar-item ${isCollapsed ? 'justify-center px-0' : ''}`}>
        {/* Expand/collapse toggle - only show when sidebar is expanded and project has chats */}
        {!isCollapsed && hasChats && (
          <button
            onClick={handleExpandClick}
            className="flex-shrink-0 p-0.5 -ml-1 mr-0.5 hover:bg-muted rounded transition-colors"
            aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
          >
            <ChevronIcon className="w-3 h-3 text-muted-foreground" rotated={isExpanded} />
          </button>
        )}
        {/* Spacer when no expand button */}
        {!isCollapsed && !hasChats && <span className="w-4 flex-shrink-0" />}
        <Link
          href={`/projects/${project.id}`}
          className="flex items-center gap-2 flex-1 min-w-0"
          title={isCollapsed ? `${project.name} (${totalCount} items)` : undefined}
        >
          <span className="qt-left-sidebar-item-icon flex-shrink-0">
            {project.icon ? (
              <span className="text-sm">{project.icon}</span>
            ) : (
              <FolderIcon className="w-4 h-4" color={project.color} />
            )}
          </span>
          {!isCollapsed && (
            <>
              <span className="qt-left-sidebar-item-label flex-1 truncate">{project.name}</span>
              {totalCount > 0 && (
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {totalCount}
                </span>
              )}
            </>
          )}
        </Link>
      </div>
      {/* Expanded chats list */}
      {!isCollapsed && isExpanded && hasChats && (
        <div className="overflow-hidden transition-all duration-200">
          {projectChats.slice(0, 5).map(chat => (
            <ProjectChatItem
              key={chat.id}
              chat={chat}
            />
          ))}
          {projectChats.length > 5 && (
            <Link
              href={`/projects/${project.id}`}
              className="qt-left-sidebar-item pl-6 text-xs text-muted-foreground hover:text-foreground"
            >
              +{projectChats.length - 5} more...
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectsSection() {
  const { isCollapsed, sectionCollapsed, toggleSectionCollapsed } = useSidebar()
  const { projects, chats, loading } = useSidebarData()
  const { shouldHideChat } = useQuickHide()

  // Filter chats by project and apply quick-hide filter (tags + danger)
  const getProjectChats = (projectId: string): SidebarChat[] => {
    return chats.filter(
      chat => chat.projectId === projectId && !shouldHideChat(chat)
    )
  }

  // Check if a project is expanded using section collapsed state
  const isProjectExpanded = (projectId: string): boolean => {
    const sectionId = `project-${projectId}`
    return sectionCollapsed[sectionId] === true
  }

  // Toggle project expanded state
  const handleToggleExpand = (projectId: string) => {
    const sectionId = `project-${projectId}`
    toggleSectionCollapsed(sectionId)
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
          isExpanded={isProjectExpanded(project.id)}
          onToggleExpand={() => handleToggleExpand(project.id)}
          projectChats={getProjectChats(project.id)}
        />
      ))}
      {projects.length > 5 && <ViewAllLink href="/projects" />}
    </SidebarSection>
  )
}
