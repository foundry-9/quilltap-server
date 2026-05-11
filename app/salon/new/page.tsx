'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CharacterPickerPanel, NewChatForm, useNewChat } from '@/components/new-chat'

export default function NewChatPage() {
  const searchParams = useSearchParams()
  const projectIdParam = searchParams.get('projectId') || undefined
  const characterIdParam = searchParams.get('characterId') || undefined

  const {
    loading,
    creating,
    characters,
    profiles,
    imageProfiles,
    userControlledCharacters,
    project,
    projectScenarios,
    generalScenarios,
    selectedCharacters,
    setSelectedCharacters,
    state,
    setState,
    handleCreateChat,
  } = useNewChat({
    initialCharacterId: characterIdParam,
    projectId: projectIdParam,
  })

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading...</p>
      </div>
    )
  }

  const canSubmit =
    !creating &&
    selectedCharacters.length > 0 &&
    selectedCharacters.some((sc) => sc.controlledBy === 'llm') &&
    !selectedCharacters.some((sc) => sc.controlledBy === 'llm' && !sc.connectionProfileId) &&
    (profiles.length > 0 || !selectedCharacters.some((sc) => sc.controlledBy === 'llm'))

  return (
    <div className="qt-page-container min-h-screen text-foreground">
      <div>
        <Link
          href={project ? `/prospero/${project.id}` : '/salon'}
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          ← Back to {project ? project.name : 'Chats'}
        </Link>

        <h1 className="mb-6 qt-heading-1">New Chat</h1>

        {project && (
          <div className="mb-6 rounded-lg border qt-border-default qt-bg-card/50 p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: project.color || 'var(--muted)' }}
              >
                <svg
                  className="w-4 h-4 qt-text-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
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

        <CharacterPickerPanel
          characters={characters}
          profiles={profiles}
          selectedCharacters={selectedCharacters}
          onSelectedCharactersChange={setSelectedCharacters}
          onCharactersChanged={() => setState((prev) => ({ ...prev, scenarioId: null }))}
          disabled={creating}
          autoFocusSearch
        />

        <div className="mt-6">
          <NewChatForm
            profiles={profiles}
            imageProfiles={imageProfiles}
            userControlledCharacters={userControlledCharacters}
            selectedCharacters={selectedCharacters}
            setSelectedCharacters={setSelectedCharacters}
            state={state}
            setState={setState}
            project={project}
            projectScenarios={projectScenarios}
            generalScenarios={generalScenarios}
            creating={creating}
            showSingleCharacterControls={false}
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Link
            href={project ? `/prospero/${project.id}` : '/salon'}
            className="rounded-lg border qt-border-default qt-bg-card px-6 py-2 font-medium qt-text-small transition hover:qt-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => void handleCreateChat()}
            disabled={!canSubmit}
            className="rounded-lg bg-success px-6 py-2 font-semibold qt-text-success-foreground transition hover:qt-bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
