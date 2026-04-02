'use client'

import { useState } from 'react'
import { TagEditor } from '@/components/tags/tag-editor'
import { CharacterFormData, CharacterScenario } from '../types'

interface CharacterBasicInfoProps {
  characterId: string
  formData: CharacterFormData
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onAliasesChange: (aliases: string[]) => void
  onPronounsChange: (pronouns: { subject: string; object: string; possessive: string } | null) => void
  onScenariosChange: (scenarios: CharacterScenario[]) => void
}

/**
 * Component for editing basic character information
 * Includes name, title, description, personality, scenario, first message, and example dialogues
 */
function AliasInput({ onAdd }: { onAdd: (alias: string) => void }) {
  const [value, setValue] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = value.trim()
      if (trimmed) {
        onAdd(trimmed)
        setValue('')
      }
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder="Type an alias and press Enter"
    />
  )
}

const PRONOUN_PRESETS = [
  { label: 'Not set', value: null },
  { label: 'He/Him/His', value: { subject: 'he', object: 'him', possessive: 'his' } },
  { label: 'She/Her/Her', value: { subject: 'she', object: 'her', possessive: 'her' } },
  { label: 'They/Them/Their', value: { subject: 'they', object: 'them', possessive: 'their' } },
  { label: 'It/It/Its', value: { subject: 'it', object: 'it', possessive: 'its' } },
  { label: 'Custom', value: 'custom' as const },
] as const

function getPronounPreset(pronouns: { subject: string; object: string; possessive: string } | null): string {
  if (!pronouns) return 'Not set'
  for (const preset of PRONOUN_PRESETS) {
    if (preset.value && preset.value !== 'custom' &&
        preset.value.subject === pronouns.subject &&
        preset.value.object === pronouns.object &&
        preset.value.possessive === pronouns.possessive) {
      return preset.label
    }
  }
  return 'Custom'
}

export function CharacterBasicInfo({ characterId, formData, onChange, onAliasesChange, onPronounsChange, onScenariosChange }: CharacterBasicInfoProps) {
  return (
    <div className="space-y-6">
      {/* Name Field */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-2 text-foreground">
          Name *
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={onChange}
          required
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Aliases Field */}
      <div>
        <label className="block text-sm font-medium mb-2 text-foreground">
          Aliases (Optional)
        </label>
        <p className="text-xs qt-text-secondary mb-2">
          Alternate names this character goes by. Press Enter to add.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {formData.aliases.map((alias, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 rounded-full qt-bg-muted px-3 py-1 text-sm text-foreground"
            >
              {alias}
              <button
                type="button"
                onClick={() => onAliasesChange(formData.aliases.filter((_, i) => i !== index))}
                className="ml-1 qt-text-secondary hover:text-foreground"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <AliasInput onAdd={(alias) => {
          if (alias && !formData.aliases.includes(alias)) {
            onAliasesChange([...formData.aliases, alias])
          }
        }} />
      </div>

      {/* Pronouns Field */}
      <div>
        <label className="block text-sm font-medium mb-2 text-foreground">
          Pronouns (Optional)
        </label>
        <p className="text-xs qt-text-secondary mb-2">
          The character&apos;s pronouns, included in system prompts so the LLM uses them correctly.
        </p>
        <select
          value={getPronounPreset(formData.pronouns)}
          onChange={(e) => {
            const selected = PRONOUN_PRESETS.find((p) => p.label === e.target.value)
            if (!selected) return
            if (selected.value === null) {
              onPronounsChange(null)
            } else if (selected.value === 'custom') {
              onPronounsChange(formData.pronouns || { subject: '', object: '', possessive: '' })
            } else {
              onPronounsChange({ ...selected.value })
            }
          }}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {PRONOUN_PRESETS.map((preset) => (
            <option key={preset.label} value={preset.label}>
              {preset.label}
            </option>
          ))}
        </select>
        {formData.pronouns && getPronounPreset(formData.pronouns) === 'Custom' && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Subject</label>
              <input
                type="text"
                value={formData.pronouns.subject}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, subject: e.target.value })}
                placeholder="e.g., they"
                className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Object</label>
              <input
                type="text"
                value={formData.pronouns.object}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, object: e.target.value })}
                placeholder="e.g., them"
                className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Possessive</label>
              <input
                type="text"
                value={formData.pronouns.possessive}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, possessive: e.target.value })}
                placeholder="e.g., their"
                className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        )}
      </div>

      {/* Title Field */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium mb-2 text-foreground">
          Title (Optional)
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={onChange}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g., Student, Teacher, Narrator"
        />
      </div>

      {/* Description Field */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-2 text-foreground">
          Description (Optional)
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={onChange}
          rows={4}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describe the character's appearance, background, and key traits"
        />
      </div>

      {/* Personality Field */}
      <div>
        <label htmlFor="personality" className="block text-sm font-medium mb-2 text-foreground">
          Personality (Optional)
        </label>
        <textarea
          id="personality"
          name="personality"
          value={formData.personality}
          onChange={onChange}
          rows={4}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describe the character's personality traits and behavioral patterns"
        />
      </div>

      {/* Scenarios Field */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-medium text-foreground">
            Scenarios (Optional)
          </label>
          <button
            type="button"
            onClick={() => {
              const now = new Date().toISOString()
              const newScenario: CharacterScenario = {
                id: crypto.randomUUID(),
                title: '',
                content: '',
                createdAt: now,
                updatedAt: now,
              }
              onScenariosChange([...formData.scenarios, newScenario])
            }}
            className="qt-button-secondary qt-button-sm"
          >
            + Add Scenario
          </button>
        </div>
        <p className="text-xs qt-text-secondary mb-3">
          Named settings and contexts for conversations. Each scenario can be selected when starting a chat.
        </p>
        {formData.scenarios.length === 0 ? (
          <div className="qt-card text-center py-6">
            <p className="qt-text-small mb-3">
              No scenarios yet. Add one to give this character distinct roleplay contexts.
            </p>
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString()
                const newScenario: CharacterScenario = {
                  id: crypto.randomUUID(),
                  title: '',
                  content: '',
                  createdAt: now,
                  updatedAt: now,
                }
                onScenariosChange([newScenario])
              }}
              className="qt-button-primary"
            >
              Add First Scenario
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {formData.scenarios.map((scenario, index) => (
              <div key={scenario.id} className="qt-card">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    value={scenario.title}
                    onChange={(e) => {
                      const updated = formData.scenarios.map((s, i) =>
                        i === index
                          ? { ...s, title: e.target.value, updatedAt: new Date().toISOString() }
                          : s
                      )
                      onScenariosChange(updated)
                    }}
                    placeholder="Scenario title"
                    className="flex-1 rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => onScenariosChange(formData.scenarios.filter((_, i) => i !== index))}
                    className="qt-button-icon qt-button-ghost hover:qt-text-destructive"
                    title="Remove scenario"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <textarea
                  value={scenario.content}
                  onChange={(e) => {
                    const updated = formData.scenarios.map((s, i) =>
                      i === index
                        ? { ...s, content: e.target.value, updatedAt: new Date().toISOString() }
                        : s
                    )
                    onScenariosChange(updated)
                  }}
                  rows={3}
                  placeholder="Describe the setting and context for this scenario"
                  className="w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-sm text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* First Message Field */}
      <div>
        <label htmlFor="firstMessage" className="block text-sm font-medium mb-2 text-foreground">
          First Message (Optional)
        </label>
        <textarea
          id="firstMessage"
          name="firstMessage"
          value={formData.firstMessage}
          onChange={onChange}
          rows={3}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="The character's opening message to start conversations"
        />
      </div>

      {/* Example Dialogues Field */}
      <div>
        <label htmlFor="exampleDialogues" className="block text-sm font-medium mb-2 text-foreground">
          Example Dialogues (Optional)
        </label>
        <textarea
          id="exampleDialogues"
          name="exampleDialogues"
          value={formData.exampleDialogues}
          onChange={onChange}
          rows={6}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Example conversations to guide the AI's responses"
        />
      </div>

      {/* System Prompt Field */}
      <div>
        <label htmlFor="systemPrompt" className="block text-sm font-medium mb-2 text-foreground">
          System Prompt (Optional)
        </label>
        <textarea
          id="systemPrompt"
          name="systemPrompt"
          value={formData.systemPrompt}
          onChange={onChange}
          rows={4}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Custom system instructions (will be combined with auto-generated prompt)"
        />
      </div>

      {/* Tag Editor */}
      <TagEditor entityType="character" entityId={characterId} />
    </div>
  )
}
