'use client'

/**
 * `/salon/new` — the full-page fallback for the New Chat dialog, used outside
 * the workspace. It renders the same {@link NewChatDialogBody} the modal does,
 * fed by the same form context.
 */

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { NewChatFormProvider, useNewChatForm } from '@/components/new-chat/NewChatFormContext'
import { NewChatDialogBody, useNewChatCanSubmit } from '@/components/new-chat/NewChatDialogBody'

export function NewChatPageClient() {
  const searchParams = useSearchParams()
  const projectIdParam = searchParams.get('projectId') || undefined
  const characterIdParam = searchParams.get('characterId') || undefined
  const autonomousParam = searchParams.get('autonomous') === '1'

  return (
    <NewChatFormProvider
      options={{
        initialCharacterId: characterIdParam,
        projectId: projectIdParam,
        initialAutonomous: autonomousParam,
      }}
    >
      <NewChatPage />
    </NewChatFormProvider>
  )
}

function NewChatPage() {
  const { loading, creating, profiles, project, state, handleCreateChat } = useNewChatForm()
  const canSubmit = useNewChatCanSubmit()
  const isAutonomous = state.autonomous.enabled

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="qt-page-container min-h-screen text-foreground">
      <div>
        <Link
          href={project ? `/prospero/${project.id}` : '/salon'}
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          ← Back to {project ? project.name : 'Chats'}
        </Link>

        <h1 className="mb-6 qt-heading-1">{isAutonomous ? 'New Autonomous Room' : 'New Chat'}</h1>

        {project && (
          <div className="mb-6 rounded-lg border qt-border-default qt-bg-card/50 p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: project.color || 'var(--muted)' }}
              >
                <Icon name="folder" className="w-4 h-4 qt-text-secondary" />
              </div>
              <div>
                <p className="text-sm qt-text-primary">Creating chat in project</p>
                <p className="font-medium text-foreground">{project.name}</p>
              </div>
            </div>
          </div>
        )}

        {profiles.length === 0 && (
          <div className="mb-6 rounded-lg border qt-border-warning/50 qt-bg-warning/10 p-4 qt-text-warning">
            <p className="font-medium">No connection profiles available</p>
            <p className="mt-1 text-sm">
              You need to create a connection profile before starting a chat.{' '}
              <Link href="/settings?tab=providers" className="underline hover:no-underline">
                Go to AI Providers
              </Link>
            </p>
          </div>
        )}

        <NewChatDialogBody pickerExpanded autoFocusSearch />

        <div className="mt-6 flex justify-end gap-3">
          <Link
            href={project ? `/prospero/${project.id}` : '/salon'}
            className="qt-button qt-button-secondary"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => void handleCreateChat()}
            disabled={!canSubmit}
            className="qt-button-success"
          >
            {creating
              ? 'Creating...'
              : isAutonomous
                ? 'Create Autonomous Room'
                : 'Create Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
