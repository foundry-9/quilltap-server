'use client'

/**
 * QuickActionsRow
 *
 * Client component with quick action buttons: Start Chat, Continue Last, New Project, Generate Image.
 */

import { useState } from 'react'
import Link from 'next/link'
import { CreateProjectDialog } from '@/app/prospero/components'
import type { QuickActionsRowProps } from './types'

// Chat icon
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="10" y1="10" x2="14" y2="10" />
    </svg>
  )
}

// Continue icon (play arrow)
function ContinueIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

// Folder plus icon
function FolderPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

// Image icon
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

export function QuickActionsRow({ lastChatId }: QuickActionsRowProps) {
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
        // Optionally refresh or navigate
      }
    } catch (err) {
      console.error('Failed to create project:', err)
    }
  }

  return (
    <>
      <div className="qt-quick-actions mb-8">
        {/* Start a Chat */}
        <Link
          href="/salon/new"
          className="qt-button qt-button-primary gap-2"
        >
          <ChatIcon className="w-4 h-4" />
          <span className="hidden sm:inline">Start a Chat</span>
          <span className="sm:hidden">Chat</span>
        </Link>

        {/* Continue Last Chat */}
        {lastChatId ? (
          <Link
            href={`/salon/${lastChatId}`}
            className="qt-button qt-button-secondary gap-2"
          >
            <ContinueIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Continue Last</span>
            <span className="sm:hidden">Continue</span>
          </Link>
        ) : (
          <button
            disabled
            className="qt-button qt-button-secondary gap-2 opacity-50 cursor-not-allowed"
            title="No recent chats"
          >
            <ContinueIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Continue Last</span>
            <span className="sm:hidden">Continue</span>
          </button>
        )}

        {/* New Project */}
        <button
          onClick={() => setProjectDialogOpen(true)}
          className="qt-button qt-button-secondary gap-2"
        >
          <FolderPlusIcon className="w-4 h-4" />
          <span className="hidden sm:inline">New Project</span>
          <span className="sm:hidden">Project</span>
        </button>

        {/* Generate Image */}
        <Link
          href="/generate-image"
          className="qt-button qt-button-secondary gap-2"
        >
          <ImageIcon className="w-4 h-4" />
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
