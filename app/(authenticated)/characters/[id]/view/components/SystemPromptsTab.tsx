'use client'

import Link from 'next/link'
import { Character } from '../types'
import { TemplateDisplay } from '@/components/characters/TemplateHighlighter'

interface SystemPromptsTabProps {
  characterId: string
  character: Character | null
  defaultPersonaName: string | null
}

export function SystemPromptsTab({
  characterId,
  character,
  defaultPersonaName,
}: SystemPromptsTabProps) {
  if (!character) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            System Prompts
          </h2>
          <p className="qt-text-small">
            Named system prompts for this character. The default prompt is used when starting new chats.
          </p>
        </div>
        <Link
          href={`/characters/${characterId}/edit?tab=system-prompts`}
          className="qt-button-primary"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit Prompts
        </Link>
      </div>

      {character?.systemPrompts && character.systemPrompts.length > 0 ? (
        <div className="space-y-4">
          {character.systemPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className={`rounded-lg border p-4 ${
                prompt.isDefault
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <h3 className="qt-text-primary">{prompt.name}</h3>
                {prompt.isDefault && (
                  <span className="qt-badge-primary">
                    Default
                  </span>
                )}
              </div>
              <pre className="overflow-hidden rounded-md bg-muted/80 p-4 text-sm text-foreground">
                <code className="text-sm whitespace-pre-wrap break-words">
                  <TemplateDisplay
                    content={prompt.content}
                    characterName={character.name}
                    personaName={defaultPersonaName}
                  />
                </code>
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-4 qt-text-small">
            No system prompts defined for this character.
          </p>
          <Link
            href={`/characters/${characterId}/edit?tab=system-prompts`}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add a system prompt
          </Link>
        </div>
      )}
    </div>
  )
}
