'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { Character } from '../types'
import { TemplateDisplay } from '@/components/characters/TemplateHighlighter'

interface SystemPromptsTabProps {
  characterId: string
  character: Character | null
  defaultPartnerName: string | null
}

export function SystemPromptsTab({
  characterId,
  character,
  defaultPartnerName,
}: SystemPromptsTabProps) {
  if (!character) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="qt-heading-4 text-foreground">
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
          <Icon name="pencil" className="w-4 h-4" />
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
                  ? 'qt-border-primary/40 qt-bg-primary/5'
                  : 'qt-border-default qt-bg-card'
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
              <pre className="overflow-hidden rounded-md qt-bg-muted/80 p-4 text-sm text-foreground">
                <code className="text-sm whitespace-pre-wrap break-words">
                  <TemplateDisplay
                    content={prompt.content}
                    characterName={character.name}
                    userCharacterName={defaultPartnerName}
                  />
                </code>
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed qt-border-default qt-bg-muted/30 p-8 text-center">
          <Icon name="code" className="mx-auto h-12 w-12 qt-text-secondary/50" />
          <p className="mt-4 qt-text-small">
            No system prompts defined for this character.
          </p>
          <Link
            href={`/characters/${characterId}/edit?tab=system-prompts`}
            className="mt-4 inline-flex items-center gap-2 qt-label text-primary hover:text-primary/80"
          >
            <Icon name="plus" className="w-4 h-4" />
            Add a system prompt
          </Link>
        </div>
      )}
    </div>
  )
}
