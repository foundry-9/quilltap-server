'use client'

/**
 * Create a character.
 *
 * The one form in Aurora with a Create button, because there is no row to
 * autosave against until there is one. Its field blocks are the character
 * page's own (`components/characters/fields/`), bound to local state instead
 * of autosave — one set of field components for create and edit.
 *
 * What the character POST takes goes in its body; the System Prompt and the
 * opening Scenario become a named prompt and a named scenario (the POST has no
 * scalar for either, and used to drop them — #146); the vault-kept facts
 * (aliases, pronouns, birthday, kind) and the AI Wizard's extras follow in
 * writes against the new id. Then the new character's page opens.
 *
 * @module app/aurora/new/NewCharacterView
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import {
  AIWizardModal,
  type GeneratedCharacterData,
  type GeneratedPhysicalDescription,
  type GeneratedWardrobeItem,
  normalizeGeneratedScenarios,
} from '@/components/characters/ai-wizard'
import { ImportModal } from '@/components/characters/system-prompts-editor/ImportModal'
import type { PromptTemplate } from '@/components/characters/system-prompts-editor/types'
import { CharacterKindPicker } from '@/components/characters/CharacterKindPicker'
import { CharacterFactsFields } from '@/components/characters/fields/CharacterFactsFields'
import { CharacterDossierFields } from '@/components/characters/fields/CharacterDossierFields'
import { MarkdownField } from '@/components/characters/fields/MarkdownField'
import {
  DOSSIER_FIELDS,
  type DossierField,
  type MarkdownFieldBinding,
  type Pronouns,
} from '@/components/characters/fields/types'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { DEFAULT_CHARACTER_KIND, type CharacterKind } from '@/lib/characters/kind'
import {
  buildWizardCurrentData,
  generatedSystemPrompt,
  getGeneratedCharacterTextEntries,
  systemPromptsForCreate,
} from '../shared/wizard-text-fields'
import { saveGeneratedWardrobeItems } from '../shared/save-generated-wardrobe'
import { saveGeneratedPhysicalDescription } from '../shared/save-generated-physical-description'
import { saveGeneratedScenarios } from '../shared/save-generated-scenarios'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'

type Prose = Record<DossierField | 'systemPrompt' | 'scenario', string>

const EMPTY_PROSE: Prose = {
  identity: '',
  description: '',
  manifesto: '',
  personality: '',
  firstMessage: '',
  exampleDialogues: '',
  systemPrompt: '',
  scenario: '',
}

/** The name a create-form opening scenario is saved under. */
const FIRST_SCENARIO_TITLE = 'Opening scene'

export function NewCharacterView() {
  const router = useRouter()
  // Keep-alive-safe: inside the workspace, finishing creation opens the new
  // character's page as a tab and closes this create tab; outside it pushes
  // to the page.
  const navigate = useWorkspaceNavigate()
  const closeSelf = useCloseSelfTab()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { profiles } = useConnectionProfiles()
  const [showWizard, setShowWizard] = useState(false)
  const [showTemplateImport, setShowTemplateImport] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  // Bumped whenever fields are replaced from outside (wizard, template import)
  // so the editors remount and re-parse the new values.
  const [externalUpdateCount, setExternalUpdateCount] = useState(0)

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [aliases, setAliases] = useState<string[]>([])
  const [pronouns, setPronouns] = useState<Pronouns | null>(null)
  const [birthday, setBirthday] = useState<string | null>(null)
  const [kind, setKind] = useState<CharacterKind>(DEFAULT_CHARACTER_KIND)
  const [prose, setProse] = useState<Prose>(EMPTY_PROSE)
  const [defaultConnectionProfileId, setDefaultConnectionProfileId] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  // The wizard's extras, written once the character exists.
  const pendingPhysicalDescription = useRef<GeneratedPhysicalDescription | null>(null)
  const pendingScenarios = useRef<Array<{ title: string; content: string }> | null>(null)
  const pendingWardrobeItems = useRef<GeneratedWardrobeItem[] | null>(null)

  const proseBinding = (field: keyof Prose): MarkdownFieldBinding => ({
    value: prose[field],
    onChange: (value) => setProse((prev) => ({ ...prev, [field]: value })),
    remountKey: externalUpdateCount,
  })
  const dossierBindings = Object.fromEntries(
    DOSSIER_FIELDS.map((field) => [field, proseBinding(field)]),
  ) as Record<DossierField, MarkdownFieldBinding>

  const handleWizardApply = (data: GeneratedCharacterData) => {
    const updates: Partial<Prose> = {}
    for (const entry of getGeneratedCharacterTextEntries(data)) {
      if (entry.field === 'name') setName(entry.value)
      else if (entry.field === 'title') setTitle(entry.value)
      else updates[entry.field] = entry.value
    }
    const systemPrompt = generatedSystemPrompt(data)
    if (systemPrompt) updates.systemPrompt = systemPrompt
    setProse((prev) => ({ ...prev, ...updates }))
    if (data.properties?.pronouns && !pronouns) setPronouns(data.properties.pronouns)
    if (data.properties && data.properties.aliases.length > 0) {
      setAliases((prev) => {
        const lower = new Set(prev.map((a) => a.toLowerCase()))
        return [...prev, ...data.properties!.aliases.filter((a) => !lower.has(a.toLowerCase()))]
      })
    }
    if (data.physicalDescription) pendingPhysicalDescription.current = data.physicalDescription
    const scenarios = normalizeGeneratedScenarios(data.scenarios)
    if (scenarios.length > 0) pendingScenarios.current = scenarios
    if (data.wardrobeItems && data.wardrobeItems.length > 0) pendingWardrobeItems.current = data.wardrobeItems
    setExternalUpdateCount((n) => n + 1)
  }

  const openTemplateImport = async () => {
    setShowTemplateImport(true)
    if (templates.length === 0) {
      try {
        setLoadingTemplates(true)
        const res = await fetch('/api/v1/prompt-templates')
        if (res.ok) {
          const data = await res.json()
          setTemplates(data.templates || [])
        }
      } catch (err) {
        console.error('Error fetching templates', err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingTemplates(false)
      }
    }
  }

  const handleTemplateImport = (content: string) => {
    setProse((prev) => ({ ...prev, systemPrompt: content }))
    setExternalUpdateCount((n) => n + 1)
    setShowTemplateImport(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setNameError('A character must have a name.')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const opening = prose.scenario.trim()
      // One create carries everything, the vault-kept facts included.
      const body = {
        name: name.trim(),
        title: title.trim() || undefined,
        identity: prose.identity,
        description: prose.description,
        manifesto: prose.manifesto,
        personality: prose.personality,
        firstMessage: prose.firstMessage,
        exampleDialogues: prose.exampleDialogues,
        defaultConnectionProfileId: defaultConnectionProfileId || undefined,
        systemPrompts: systemPromptsForCreate(prose.systemPrompt),
        scenarios: opening ? [{ title: FIRST_SCENARIO_TITLE, content: opening }] : undefined,
        ...(aliases.length > 0 && { aliases }),
        ...(pronouns && { pronouns }),
        ...(birthday && { birthday }),
        ...(kind !== DEFAULT_CHARACTER_KIND && { kind }),
      }

      const res = await fetch('/api/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create character')
      }
      const data = await res.json()
      const characterId = data.character.id as string

      if (pendingScenarios.current && pendingScenarios.current.length > 0) {
        await saveGeneratedScenarios(characterId, pendingScenarios.current)
        pendingScenarios.current = null
      }
      if (pendingPhysicalDescription.current) {
        await saveGeneratedPhysicalDescription(characterId, pendingPhysicalDescription.current, {
          failureMessage: 'Character created, but physical description failed to save',
        })
        pendingPhysicalDescription.current = null
      }
      if (pendingWardrobeItems.current && pendingWardrobeItems.current.length > 0) {
        const { saved, outfits } = await saveGeneratedWardrobeItems(characterId, pendingWardrobeItems.current)
        if (saved > 0) {
          const outfitText = outfits > 0 ? ` (including ${outfits} outfit${outfits > 1 ? 's' : ''})` : ''
          showSuccessToast(`${saved} wardrobe item${saved > 1 ? 's' : ''} created${outfitText}`)
        }
        pendingWardrobeItems.current = null
      }

      if (closeSelf()) {
        navigate(`/aurora/${characterId}`)
      } else {
        router.push(`/aurora/${characterId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="qt-page-container">
      <div className="mb-8">
        <Link href="/aurora" className="qt-link mb-4 inline-block">
          ← Back to Characters
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="qt-heading-1">Create Character</h1>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="qt-button-secondary flex items-center gap-2"
            title="Use AI to generate character details"
          >
            <Icon name="wand" className="w-4 h-4" />
            AI Wizard
          </button>
        </div>
      </div>

      {error && <div className="qt-alert-error mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="qt-card space-y-4" aria-labelledby="new-character-facts">
          <h2 id="new-character-facts" className="qt-heading-4">
            Facts
          </h2>
          <CharacterFactsFields
            name={{
              value: name,
              onChange: (value) => {
                setName(value)
                if (value.trim()) setNameError(null)
              },
              error: nameError,
            }}
            title={{ value: title, onChange: setTitle }}
            aliases={{ value: aliases, onChange: setAliases }}
            pronouns={{ value: pronouns, onChange: setPronouns }}
            birthday={{ value: birthday, onChange: setBirthday }}
            kindSlot={<CharacterKindPicker kind={kind} saving={false} disabled={false} onChange={setKind} />}
          />
        </section>

        <section className="qt-card space-y-4" aria-labelledby="new-character-dossier">
          <h2 id="new-character-dossier" className="qt-heading-4">
            Dossier
          </h2>
          <CharacterDossierFields
            bindings={dossierBindings}
            namespace="NewCharacter.dossier"
            templateHighlight={{ characterName: name || null }}
          />
        </section>

        <section className="qt-card space-y-4" aria-labelledby="new-character-start">
          <h2 id="new-character-start" className="qt-heading-4">
            How a chat begins
          </h2>
          <div className="space-y-1">
            <div className="flex justify-end">
              <button type="button" onClick={openTemplateImport} className="qt-button-secondary text-xs px-2 py-1">
                Import Template
              </button>
            </div>
            <MarkdownField
              binding={proseBinding('systemPrompt')}
              hint={PROMPT_FIELD_HINTS.systemPrompt}
              namespace="NewCharacter.systemPrompt"
              minHeight="8rem"
            />
            <p className="qt-text-xs">
              Saved as their first named system prompt, &ldquo;Default&rdquo;. More can be added on their page.
            </p>
          </div>
          <div className="space-y-1">
            <MarkdownField
              binding={proseBinding('scenario')}
              hint={PROMPT_FIELD_HINTS.scenario}
              namespace="NewCharacter.scenario"
              minHeight="6rem"
            />
            <p className="qt-text-xs">
              Saved as their first scenario, &ldquo;{FIRST_SCENARIO_TITLE}&rdquo;. Rename it, or add others, on their
              page.
            </p>
          </div>
          <div>
            <label htmlFor="defaultConnectionProfileId" className="block qt-label mb-2 qt-text">
              Default connection profile
            </label>
            <select
              id="defaultConnectionProfileId"
              value={defaultConnectionProfileId}
              onChange={(e) => setDefaultConnectionProfileId(e.target.value)}
              className="qt-select"
            >
              <option value="">No default profile</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <p className="mt-1 qt-text-xs">Can be overridden for individual chats.</p>
          </div>
        </section>

        <div className="flex gap-4">
          <button type="submit" disabled={loading} className="qt-button flex-1 qt-button-primary">
            {loading ? 'Creating...' : 'Create Character'}
          </button>
          <Link href="/aurora" className="qt-button px-6 py-3 qt-button-secondary text-center">
            Cancel
          </Link>
        </div>
      </form>

      <ImportModal
        isOpen={showTemplateImport}
        loading={loadingTemplates}
        templates={templates}
        onClose={() => setShowTemplateImport(false)}
        onImport={handleTemplateImport}
      />

      <AIWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        characterName={name}
        currentData={buildWizardCurrentData({
          title,
          identity: prose.identity,
          description: prose.description,
          manifesto: prose.manifesto,
          personality: prose.personality,
          firstMessage: prose.firstMessage,
          exampleDialogues: prose.exampleDialogues,
          systemPrompt: prose.systemPrompt,
          pronouns,
          aliases,
        })}
        onApply={handleWizardApply}
      />
    </div>
  )
}
