'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { AIWizardModal, type GeneratedCharacterData, type GeneratedPhysicalDescription, normalizeGeneratedScenarios } from '@/components/characters/ai-wizard'
import { ImportModal } from '@/components/characters/system-prompts-editor/ImportModal'
import type { PromptTemplate } from '@/components/characters/system-prompts-editor/types'

interface ConnectionProfile {
  id: string
  name: string
}

export default function NewCharacterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [showWizard, setShowWizard] = useState(false)
  const [showTemplateImport, setShowTemplateImport] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  // Store pending physical description from wizard to save after character creation
  const pendingPhysicalDescription = useRef<GeneratedPhysicalDescription | null>(null)
  // Store pending scenarios from wizard to save after character creation
  const pendingScenarios = useRef<Array<{ title: string; content: string }> | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    exampleDialogues: '',
    systemPrompt: '',
    avatarUrl: '',
    defaultConnectionProfileId: '',
  })

  // Handle applying wizard-generated data
  const handleWizardApply = (data: GeneratedCharacterData) => {
    setFormData((prev) => ({
      ...prev,
      ...(data.name && { name: data.name }),
      ...(data.title && { title: data.title }),
      ...(data.description && { description: data.description }),
      ...(data.personality && { personality: data.personality }),
      ...(data.exampleDialogues && { exampleDialogues: data.exampleDialogues }),
      ...(data.systemPrompt && { systemPrompt: data.systemPrompt }),
    }))
    // Store physical description to save after character creation
    if (data.physicalDescription) {
      pendingPhysicalDescription.current = data.physicalDescription
    }
    // Store scenarios to save after character creation
    const normalizedScenarios = normalizeGeneratedScenarios(data.scenarios)
    if (normalizedScenarios.length > 0) {
      pendingScenarios.current = normalizedScenarios
    }
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

  const handleTemplateImport = (content: string, _suggestedName: string) => {
    setFormData(prev => ({ ...prev, systemPrompt: content }))
    setShowTemplateImport(false)
  }

  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const res = await fetch('/api/v1/connection-profiles')
        if (res.ok) {
          const data = await res.json()
          setProfiles(data.profiles || [])
        }
      } catch (err) {
        console.error('Failed to fetch profiles', { error: err instanceof Error ? err.message : String(err) })
      }
    }
    fetchProfiles()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Filter out empty strings for optional UUID fields
      const submitData = {
        ...formData,
        defaultConnectionProfileId: formData.defaultConnectionProfileId || undefined,
        avatarUrl: formData.avatarUrl || undefined,
      }

      const res = await fetch('/api/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create character')
      }

      const data = await res.json()
      const characterId = data.character.id

      // Save pending scenarios if any (from wizard)
      if (pendingScenarios.current && pendingScenarios.current.length > 0) {
        for (const scenario of pendingScenarios.current) {
          try {
            await fetch(`/api/v1/characters/${characterId}/scenarios`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: scenario.title, content: scenario.content }),
            })
          } catch (scenErr) {
            console.error('Error saving scenario', scenErr instanceof Error ? scenErr.message : String(scenErr))
          }
        }
        pendingScenarios.current = null
      }

      // Save pending physical description if any
      if (pendingPhysicalDescription.current) {
        try {
          const descResponse = await fetch(`/api/v1/characters/${characterId}/descriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: pendingPhysicalDescription.current.name,
              shortPrompt: pendingPhysicalDescription.current.shortPrompt,
              mediumPrompt: pendingPhysicalDescription.current.mediumPrompt,
              longPrompt: pendingPhysicalDescription.current.longPrompt,
              completePrompt: pendingPhysicalDescription.current.completePrompt,
              fullDescription: pendingPhysicalDescription.current.fullDescription,
            }),
          })

          if (descResponse.ok) {
            showSuccessToast('Physical description created')
          } else {
            const errorData = await descResponse.json()
            console.error('Failed to save physical description', errorData.error || 'Unknown error')
            showErrorToast('Character created, but physical description failed to save')
          }
        } catch (descErr) {
          console.error('Error saving physical description', descErr instanceof Error ? descErr.message : String(descErr))
          showErrorToast('Character created, but physical description failed to save')
        }
      }

      router.push(`/aurora/${characterId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  return (
    <div className="qt-page-container">
      <div className="mb-8">
        <Link
          href="/aurora"
          className="qt-link mb-4 inline-block"
        >
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Wizard
          </button>
        </div>
      </div>

      {error && (
        <div className="qt-alert-error mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2 text-foreground">
            Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="qt-input"
          />
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2 text-foreground">
            Title (Optional)
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className="qt-input"
            placeholder="e.g., The Wanderer, Knight of the Realm"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2 text-foreground">
            Description (Optional)
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={4}
            className="qt-textarea"
            placeholder="Describe the character's appearance, background, and key traits"
          />
        </div>

        <div>
          <label htmlFor="personality" className="block text-sm font-medium mb-2 text-foreground">
            Personality (Optional)
          </label>
          <textarea
            id="personality"
            name="personality"
            value={formData.personality}
            onChange={handleChange}
            rows={4}
            className="qt-textarea"
            placeholder="Describe the character's personality traits and behavioral patterns"
          />
        </div>

        <div>
          <label htmlFor="scenario" className="block text-sm font-medium mb-2 text-foreground">
            Scenario (Optional)
          </label>
          <textarea
            id="scenario"
            name="scenario"
            value={formData.scenario}
            onChange={handleChange}
            rows={4}
            className="qt-textarea"
            placeholder="Describe the setting and context for conversations"
          />
        </div>

        <div>
          <label htmlFor="firstMessage" className="block text-sm font-medium mb-2 text-foreground">
            First Message (Optional)
          </label>
          <textarea
            id="firstMessage"
            name="firstMessage"
            value={formData.firstMessage}
            onChange={handleChange}
            rows={3}
            className="qt-textarea"
            placeholder="The character's opening message to start conversations"
          />
        </div>

        <div>
          <label htmlFor="exampleDialogues" className="block text-sm font-medium mb-2 text-foreground">
            Example Dialogues (Optional)
          </label>
          <textarea
            id="exampleDialogues"
            name="exampleDialogues"
            value={formData.exampleDialogues}
            onChange={handleChange}
            rows={6}
            className="qt-textarea"
            placeholder="Example conversations to guide the AI's responses"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="systemPrompt" className="block text-sm font-medium text-foreground">
              System Prompt (Optional)
            </label>
            <button
              type="button"
              onClick={openTemplateImport}
              className="qt-button-secondary text-xs px-2 py-1"
            >
              Import Template
            </button>
          </div>
          <textarea
            id="systemPrompt"
            name="systemPrompt"
            value={formData.systemPrompt}
            onChange={handleChange}
            rows={4}
            className="qt-textarea"
            placeholder="Custom system instructions (will be combined with auto-generated prompt)"
          />
        </div>

        <div>
          <label htmlFor="avatarUrl" className="block text-sm font-medium mb-2 text-foreground">
            Avatar URL (Optional)
          </label>
          <input
            type="url"
            id="avatarUrl"
            name="avatarUrl"
            value={formData.avatarUrl}
            onChange={handleChange}
            className="qt-input"
            placeholder="https://example.com/avatar.png"
          />
        </div>

        <div>
          <label htmlFor="defaultConnectionProfileId" className="block text-sm font-medium mb-2 text-foreground">
            Default Connection Profile (Optional)
          </label>
          <select
            id="defaultConnectionProfileId"
            name="defaultConnectionProfileId"
            value={formData.defaultConnectionProfileId}
            onChange={handleChange}
            className="qt-select"
          >
            <option value="">No default profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <p className="mt-1 qt-text-xs">
            Can be overridden for individual chats
          </p>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={loading}
            className="qt-button flex-1 qt-button-primary"
          >
            {loading ? 'Creating...' : 'Create Character'}
          </button>
          <Link
            href="/aurora"
            className="qt-button px-6 py-3 qt-button-secondary text-center"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Import Template Modal */}
      <ImportModal
        isOpen={showTemplateImport}
        loading={loadingTemplates}
        templates={templates}
        onClose={() => setShowTemplateImport(false)}
        onImport={handleTemplateImport}
      />

      {/* AI Wizard Modal */}
      <AIWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        characterName={formData.name}
        currentData={{
          title: formData.title,
          description: formData.description,
          personality: formData.personality,
          exampleDialogues: formData.exampleDialogues,
          systemPrompt: formData.systemPrompt,
        }}
        onApply={handleWizardApply}
      />
    </div>
  )
}
