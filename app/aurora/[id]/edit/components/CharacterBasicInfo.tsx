'use client'

import { useState } from 'react'
import { TagEditor } from '@/components/tags/tag-editor'
import { CharacterFormData, CharacterScenario } from '../types'

interface CharacterBasicInfoProps {
  characterId: string
  formData: CharacterFormData
  hasLinkedVault: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onAliasesChange: (aliases: string[]) => void
  onPronounsChange: (pronouns: { subject: string; object: string; possessive: string } | null) => void
  onScenariosChange: (scenarios: CharacterScenario[]) => void
  onSystemTransparencyChange: (enabled: boolean) => void
  onReadFromDocStoreToggle: (enabled: boolean) => void
  onSyncPropertiesFromVault: () => void
  onSyncPropertiesToVault: () => void
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

export function CharacterBasicInfo({
  characterId,
  formData,
  hasLinkedVault,
  onChange,
  onAliasesChange,
  onPronounsChange,
  onScenariosChange,
  onSystemTransparencyChange,
  onReadFromDocStoreToggle,
  onSyncPropertiesFromVault,
  onSyncPropertiesToVault,
}: CharacterBasicInfoProps) {
  const overlayOn = formData.readPropertiesFromDocumentStore === true
  // When the overlay is on, all vault-managed fields remain editable; the
  // repository's write overlay routes those edits to vault files instead of
  // the database row, keeping the form and vault in step automatically.
  const toggleDisabled = !hasLinkedVault && !overlayOn

  return (
    <div className="space-y-6">
      {/* System Transparency Switch */}
      <div className="qt-card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <label
              htmlFor="systemTransparency"
              className="block qt-text-label"
            >
              System transparency
            </label>
            <p className="text-xs qt-text-secondary mt-1">
              {formData.systemTransparency ? (
                <>
                  <em>On:</em> &ldquo;My character will be able to verify everything about
                  their existence, including how they are crafted and how they
                  interact with me.&rdquo;
                </>
              ) : (
                <>
                  <em>Off:</em> &ldquo;My character will trust me without being able to
                  verify me. I accept the covenant of that trust.&rdquo;
                </>
              )}
            </p>
            <p className="text-xs qt-text-secondary mt-2">
              When off, this character cannot use the <code>self_inventory</code>{' '}
              tool, cannot perceive announcements from the Staff (the Lantern,
              Aurora, the Librarian, and so on), and cannot reach any character
              vault &mdash; their own included &mdash; through the document tools.
              This setting overrides any chat- or project-level toggles for those
              three things; turning it on simply lets the chat- and project-level
              settings have their say.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer select-none">
            <input
              id="systemTransparency"
              type="checkbox"
              checked={formData.systemTransparency}
              onChange={(e) => onSystemTransparencyChange(e.target.checked)}
              className="h-5 w-5 qt-accent-primary"
            />
          </label>
        </div>
      </div>

      {/* Scriptorium Overlay Switch */}
      <div className="qt-card">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <label
              htmlFor="readPropertiesFromDocumentStore"
              className="block qt-text-label"
            >
              Read this character&rsquo;s core fields from the Scriptorium vault
            </label>
            <p className="text-xs qt-text-secondary mt-1">
              When on, the character&rsquo;s basic properties (aliases, pronouns, title, first
              message, talkativeness), description, personality, example dialogues, first physical
              description plus its prompts, named system prompt variants, named scenarios, and
              wardrobe items plus outfit presets are all read live from files inside the linked
              Scriptorium vault
              (<code className="mx-1">properties.json</code>,
              <code className="mx-1">description.md</code>,
              <code className="mx-1">personality.md</code>,
              <code className="mx-1">example-dialogues.md</code>,
              <code className="mx-1">physical-description.md</code>,
              <code className="mx-1">physical-prompts.json</code>,
              <code className="mx-1">Prompts/*.md</code>,
              <code className="mx-1">Scenarios/*.md</code>,
              <code className="mx-1">Wardrobe/*.md</code>,
              <code className="mx-1">Outfits/*.md</code>).
              Edits made here are saved straight to the vault files, so the form
              and the vault stay in step. Use &ldquo;Snapshot to database&rdquo;
              before turning the switch off if you want the database row to
              carry the vault&rsquo;s current values; otherwise toggling off
              reverts those fields to the values they held when the switch was
              first turned on.
            </p>
            {!hasLinkedVault && (
              <p className="text-xs qt-text-destructive mt-2">
                No Scriptorium vault is linked to this character, so the overlay cannot be enabled.
              </p>
            )}
          </div>
          <label className="inline-flex items-center cursor-pointer select-none">
            <input
              id="readPropertiesFromDocumentStore"
              type="checkbox"
              checked={overlayOn}
              disabled={toggleDisabled}
              onChange={(e) => onReadFromDocStoreToggle(e.target.checked)}
              className="h-5 w-5 qt-accent-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </div>
        {hasLinkedVault && (
          <div className="mt-3 rounded-md qt-bg-muted px-3 py-2 space-y-2">
            {overlayOn ? (
              <p className="text-xs qt-text-secondary">
                Values below reflect the vault. Edits save to the vault files;
                the database row stays frozen at its pre-overlay state.
              </p>
            ) : (
              <p className="text-xs qt-text-secondary">
                Values below reflect the database row. Use the buttons to copy
                state between the database and the linked vault.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onSyncPropertiesFromVault}
                className="qt-button-secondary qt-button-sm whitespace-nowrap"
                title="Copy the current vault values into the database record so the row matches the vault"
              >
                Copy vault &rarr; database
              </button>
              <button
                type="button"
                onClick={onSyncPropertiesToVault}
                className="qt-button-secondary qt-button-sm whitespace-nowrap"
                title="Copy the current database values into the vault files so the vault matches the database"
              >
                Copy database &rarr; vault
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Name Field */}
      <div>
        <label htmlFor="name" className="block qt-text-label mb-2">
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
        <label className="block qt-text-label mb-2">
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
        <label className="block qt-text-label mb-2">
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
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
                className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Object</label>
              <input
                type="text"
                value={formData.pronouns.object}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, object: e.target.value })}
                placeholder="e.g., them"
                className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs qt-text-secondary mb-1">Possessive</label>
              <input
                type="text"
                value={formData.pronouns.possessive}
                onChange={(e) => onPronounsChange({ ...formData.pronouns!, possessive: e.target.value })}
                placeholder="e.g., their"
                className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>
        )}
      </div>

      {/* Title Field */}
      <div>
        <label htmlFor="title" className="block qt-text-label mb-2">
          Title (Optional)
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={onChange}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Your private label for this character — e.g., the protagonist, the rival, the love interest. Not how strangers refer to them."
        />
      </div>

      {/* Identity Field */}
      <div>
        <label htmlFor="identity" className="block qt-text-label mb-2">
          Identity (Optional)
        </label>
        <textarea
          id="identity"
          name="identity"
          value={formData.identity}
          onChange={onChange}
          rows={3}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="What strangers know about the character on sight or by reputation — name, station, occupation, public reputation. The shallow first impression."
        />
      </div>

      {/* Description Field */}
      <div>
        <label htmlFor="description" className="block qt-text-label mb-2">
          Description (Optional)
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={onChange}
          rows={4}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="How acquaintances perceive the character — behaviour, mannerisms, verbal patterns. Not physical appearance."
        />
      </div>

      {/* Personality Field */}
      <div>
        <label htmlFor="personality" className="block qt-text-label mb-2">
          Personality (Optional)
        </label>
        <textarea
          id="personality"
          name="personality"
          value={formData.personality}
          onChange={onChange}
          rows={4}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="What the character knows about themselves. The internal driver of speech and behaviour. Other characters don't see it unless shared."
        />
      </div>

      {/* Scenarios Field */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block qt-text-label">
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
          {overlayOn
            ? 'Scenarios live in the vault\u2019s Scenarios/ folder. Edits here save straight to those files.'
            : 'Named settings and contexts for conversations. Each scenario can be selected when starting a chat.'}
        </p>
        {formData.scenarios.length === 0 ? (
          <div className="qt-card text-center py-6">
            <p className="qt-text-small mb-3">
              {!overlayOn
                ? 'No scenarios yet. Add one to give this character distinct roleplay contexts.'
                : 'No scenario files in the vault\u2019s Scenarios/ folder yet. Add one and it\u2019ll be written there.'}
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
                onScenariosChange([...formData.scenarios, newScenario])
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
                    className="flex-1 rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-sm text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* First Message Field */}
      <div>
        <label htmlFor="firstMessage" className="block qt-text-label mb-2">
          First Message (Optional)
        </label>
        <textarea
          id="firstMessage"
          name="firstMessage"
          value={formData.firstMessage}
          onChange={onChange}
          rows={3}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="The character's opening message to start conversations"
        />
      </div>

      {/* Example Dialogues Field */}
      <div>
        <label htmlFor="exampleDialogues" className="block qt-text-label mb-2">
          Example Dialogues (Optional)
        </label>
        <textarea
          id="exampleDialogues"
          name="exampleDialogues"
          value={formData.exampleDialogues}
          onChange={onChange}
          rows={6}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Example conversations to guide the AI's responses"
        />
      </div>

      {/* System Prompt Field */}
      <div>
        <label htmlFor="systemPrompt" className="block qt-text-label mb-2">
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
