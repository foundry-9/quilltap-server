'use client'

import Link from 'next/link'
import { Character, TemplateCounts } from '../types'
import { TemplateDisplay } from '@/components/characters/TemplateHighlighter'

interface CharacterDetailsProps {
  characterId: string
  character: Character | null
  templateCounts: TemplateCounts
  replacingTemplate: 'char' | 'user' | null
  defaultPartnerName: string | null
  onTemplateReplace: (type: 'char' | 'user') => void
}

export function CharacterDetails({
  characterId,
  character,
  templateCounts,
  replacingTemplate,
  defaultPartnerName,
  onTemplateReplace,
}: CharacterDetailsProps) {
  if (!character) return null

  return (
    <div className="space-y-6">
      {/* Edit Button Header with Template Replacement Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Character Name → {{char}} button */}
        {templateCounts.charCount > 0 && (
          <button
            onClick={() => onTemplateReplace('char')}
            disabled={replacingTemplate !== null}
            className="flex items-center gap-1.5 rounded-lg border qt-border-primary/40 qt-bg-primary/10 px-3 py-2 qt-label text-primary qt-shadow-sm transition hover:qt-bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Replace ${templateCounts.charCount} occurrences of "${character?.name}" with {{char}}`}
          >
            {replacingTemplate === 'char' ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span className="hidden sm:inline">{character?.name}</span>
            <span className="text-primary">→</span>
            <code className="rounded qt-bg-primary/20 px-1 text-xs text-primary">{`{{char}}`}</code>
            <span className="text-xs text-primary/80">({templateCounts.charCount})</span>
          </button>
        )}

        {/* Persona Name → {{user}} button */}
        {defaultPartnerName && templateCounts.userCount > 0 && (
          <button
            onClick={() => onTemplateReplace('user')}
            disabled={replacingTemplate !== null}
            className="flex items-center gap-1.5 rounded-lg border qt-border-success/40 qt-bg-success/10 px-3 py-2 qt-label qt-text-success qt-shadow-sm transition hover:qt-bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
            title={`Replace ${templateCounts.userCount} occurrences of "${defaultPartnerName}" with {{user}}`}
          >
            {replacingTemplate === 'user' ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-success border-r-transparent"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span className="hidden sm:inline">{defaultPartnerName}</span>
            <span className="qt-text-success">→</span>
            <code className="rounded qt-bg-success/20 px-1 text-xs qt-text-success">{`{{user}}`}</code>
            <span className="text-xs qt-text-success/80">({templateCounts.userCount})</span>
          </button>
        )}

        <Link
          href={`/characters/${characterId}/edit`}
          className="character-edit-link flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:qt-bg-primary/90"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit Character
        </Link>
      </div>

      {/* Main Content with Template Highlighting */}
      <div className="space-y-6">
        {character?.identity && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Identity
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.identity}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.description && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Description
              {(templateCounts.fieldCounts.description?.char > 0 || templateCounts.fieldCounts.description?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.description}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.manifesto && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Manifesto
              {(templateCounts.fieldCounts.manifesto?.char > 0 || templateCounts.fieldCounts.manifesto?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.manifesto}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.personality && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Personality
              {(templateCounts.fieldCounts.personality?.char > 0 || templateCounts.fieldCounts.personality?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.personality}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.scenarios && character.scenarios.length > 0 && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              {character.scenarios.length === 1 ? 'Scenario' : 'Scenarios'}
            </h2>
            {character.scenarios.map((scenario) => (
              <div key={scenario.id} className="mb-4">
                {character.scenarios!.length > 1 && (
                  <h3 className="qt-label qt-text-secondary mb-1">{scenario.title}</h3>
                )}
                <div className="qt-text-small">
                  <TemplateDisplay
                    content={scenario.content}
                    characterName={character.name}
                    userCharacterName={defaultPartnerName}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {character?.firstMessage && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              First Message
              {(templateCounts.fieldCounts.firstMessage?.char > 0 || templateCounts.fieldCounts.firstMessage?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.firstMessage}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {character?.exampleDialogues && (
          <div>
            <h2 className="qt-heading-4 text-foreground mb-2">
              Example Dialogues
              {(templateCounts.fieldCounts.exampleDialogues?.char > 0 || templateCounts.fieldCounts.exampleDialogues?.user > 0) && (
                <span className="ml-2 text-xs font-normal qt-text-xs">
                  (template replacements available)
                </span>
              )}
            </h2>
            <div className="qt-text-small">
              <TemplateDisplay
                content={character.exampleDialogues}
                characterName={character.name}
                userCharacterName={defaultPartnerName}
              />
            </div>
          </div>
        )}

        {/* Active System Prompt Indicator */}
        {character?.systemPrompts && character.systemPrompts.length > 0 && (
          <div className="rounded-lg border qt-border-default qt-bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm qt-text-primary">Active System Prompt:</span>
                <span className="qt-text-small">
                  {character.systemPrompts.find(p => p.isDefault)?.name || character.systemPrompts[0]?.name || 'None'}
                </span>
                {character.systemPrompts.length > 1 && (
                  <span className="qt-text-xs">
                    (+{character.systemPrompts.length - 1} more)
                  </span>
                )}
              </div>
              <Link
                href={`/characters/${characterId}/view?tab=system-prompts`}
                className="text-sm text-primary hover:text-primary/80"
              >
                View all →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
