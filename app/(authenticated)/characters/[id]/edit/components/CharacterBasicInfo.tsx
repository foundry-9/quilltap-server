'use client'

import { useState } from 'react'
import { TagEditor } from '@/components/tags/tag-editor'
import { CharacterFormData } from '../types'

interface CharacterBasicInfoProps {
  characterId: string
  formData: CharacterFormData
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onAliasesChange: (aliases: string[]) => void
  onPronounsChange: (pronouns: { subject: string; object: string; possessive: string } | null) => void
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
      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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

export function CharacterBasicInfo({ characterId, formData, onChange, onAliasesChange, onPronounsChange }: CharacterBasicInfoProps) {
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Aliases Field */}
      <div>
        <label className="block text-sm font-medium mb-2 text-foreground">
          Aliases (Optional)
        </label>
        <p className="text-xs text-muted-foreground mb-2">
          Alternate names this character goes by. Press Enter to add.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {formData.aliases.map((alias, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm text-foreground"
            >
              {alias}
              <button
                type="button"
                onClick={() => onAliasesChange(formData.aliases.filter((_, i) => i !== index))}
                className="ml-1 text-muted-foreground hover:text-foreground"
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
        <p className="text-xs text-muted-foreground mb-2">
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
              <label className="block text-xs text-muted-foreground mb-1">Subject</label>
              <input
                type="text"
                value={formData.pronouns.subject}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, subject: e.target.value })}
                placeholder="e.g., they"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Object</label>
              <input
                type="text"
                value={formData.pronouns.object}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, object: e.target.value })}
                placeholder="e.g., them"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Possessive</label>
              <input
                type="text"
                value={formData.pronouns.possessive}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, possessive: e.target.value })}
                placeholder="e.g., their"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describe the character's personality traits and behavioral patterns"
        />
      </div>

      {/* Scenario Field */}
      <div>
        <label htmlFor="scenario" className="block text-sm font-medium mb-2 text-foreground">
          Scenario (Optional)
        </label>
        <textarea
          id="scenario"
          name="scenario"
          value={formData.scenario}
          onChange={onChange}
          rows={4}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describe the setting and context for conversations"
        />
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Custom system instructions (will be combined with auto-generated prompt)"
        />
      </div>

      {/* Tag Editor */}
      <TagEditor entityType="character" entityId={characterId} />
    </div>
  )
}
