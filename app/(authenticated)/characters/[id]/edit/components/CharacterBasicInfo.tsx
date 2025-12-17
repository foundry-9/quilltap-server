'use client'

import { TagEditor } from '@/components/tags/tag-editor'
import { CharacterFormData } from '../types'

interface CharacterBasicInfoProps {
  characterId: string
  formData: CharacterFormData
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}

/**
 * Component for editing basic character information
 * Includes name, title, description, personality, scenario, first message, and example dialogues
 */
export function CharacterBasicInfo({ characterId, formData, onChange }: CharacterBasicInfoProps) {
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
