'use client'

/**
 * QuickActionsRow
 *
 * The home page's quick actions: Start a Chat, Start Autonomous Room, New
 * Project, Generate Image. Picking up the last conversation is the resume
 * card's work (`ResumeCard`), which honours quick-hide.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { CreateProjectDialog } from '@/app/prospero/components'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

export function QuickActionsRow() {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)

  const handleProjectCreate = async (name: string, description: string | null) => {
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      if (res.ok) {
        setProjectDialogOpen(false)
        showSuccessToast('Project created successfully!')
      } else {
        showErrorToast('Failed to create project')
      }
    } catch (err) {
      console.error('Failed to create project:', err)
      showErrorToast('Failed to create project')
    }
  }

  return (
    <>
      <div className="qt-quick-actions">
        {/* Start a Chat */}
        <Link
          href="/salon/new"
          className="qt-button qt-button-primary gap-2"
        >
          <Icon name="chat" className="w-4 h-4" />
          <span className="hidden sm:inline">Start a Chat</span>
          <span className="sm:hidden">Chat</span>
        </Link>

        {/* Start an Autonomous Room */}
        <Link
          href="/salon/new?autonomous=1"
          className="qt-button qt-button-secondary gap-2"
          title="Create a character-to-character room that runs on a schedule or on demand"
        >
          <Icon name="clock" className="w-4 h-4" />
          <span className="hidden sm:inline">Start Autonomous Room</span>
          <span className="sm:hidden">Auto Room</span>
        </Link>

        {/* New Project */}
        <button
          onClick={() => setProjectDialogOpen(true)}
          className="qt-button qt-button-secondary gap-2"
        >
          <Icon name="folder-plus" className="w-4 h-4" />
          <span className="hidden sm:inline">New Project</span>
          <span className="sm:hidden">Project</span>
        </button>

        {/* Generate Image */}
        <Link
          href="/generate-image"
          className="qt-button qt-button-secondary gap-2"
        >
          <Icon name="image" className="w-4 h-4" />
          <span className="hidden sm:inline">Generate Image</span>
          <span className="sm:hidden">Image</span>
        </Link>
      </div>

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onSubmit={handleProjectCreate}
      />
    </>
  )
}
