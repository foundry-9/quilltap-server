'use client'

import { useEffect, useState } from 'react'

interface SystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
}

interface Scenario {
  id: string
  title: string
  content: string
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

interface PhysicalDescription {
  id: string
  name: string
}

interface ClothingRecord {
  id: string
  name: string
}

interface ExternalPromptDialogProps {
  characterId: string
  characterName: string | undefined
  systemPrompts?: SystemPrompt[]
  scenarios?: Scenario[]
  onCancel: () => void
  onGenerated: (prompt: string) => void
}

export function ExternalPromptDialog({
  characterId,
  characterName,
  systemPrompts,
  scenarios,
  onCancel,
  onGenerated,
}: ExternalPromptDialogProps) {
  const [connectionProfileId, setConnectionProfileId] = useState('')
  const [systemPromptId, setSystemPromptId] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [descriptionId, setDescriptionId] = useState('')
  const [clothingRecordId, setClothingRecordId] = useState('')
  const [maxTokens, setMaxTokens] = useState(4000)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [descriptions, setDescriptions] = useState<PhysicalDescription[]>([])
  const [clothingRecords, setClothingRecords] = useState<ClothingRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch connection profiles, descriptions, and clothing on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [profilesRes, descriptionsRes, clothingRes] = await Promise.all([
          fetch('/api/v1/connection-profiles'),
          fetch(`/api/v1/characters/${characterId}/descriptions`),
          fetch(`/api/v1/characters/${characterId}/clothing`),
        ])

        if (profilesRes.ok) {
          const data = await profilesRes.json()
          const fetchedProfiles = data.profiles || []
          setProfiles(fetchedProfiles)
          const defaultProfile = fetchedProfiles.find((p: ConnectionProfile) => p.isDefault)
          if (defaultProfile) {
            setConnectionProfileId(defaultProfile.id)
          } else if (fetchedProfiles.length > 0) {
            setConnectionProfileId(fetchedProfiles[0].id)
          }
        }

        if (descriptionsRes.ok) {
          const data = await descriptionsRes.json()
          setDescriptions(data.descriptions || [])
        }

        if (clothingRes.ok) {
          const data = await clothingRes.json()
          setClothingRecords(data.clothingRecords || [])
        }
      } catch {
        // Non-critical — dropdowns will just be empty
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [characterId])

  // Pre-select default system prompt
  useEffect(() => {
    if (systemPrompts && systemPrompts.length > 0 && !systemPromptId) {
      const defaultPrompt = systemPrompts.find(sp => sp.isDefault)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream systemPrompts changes (parent renders unconditionally)
      setSystemPromptId(defaultPrompt?.id || systemPrompts[0].id)
    }
  }, [systemPrompts, systemPromptId])

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !generating) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onCancel, generating])

  const handleGenerate = async () => {
    if (!connectionProfileId || !systemPromptId) return

    setGenerating(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        connectionProfileId,
        systemPromptId,
        maxTokens,
      }
      if (scenarioId) body.scenarioId = scenarioId
      if (descriptionId) body.descriptionId = descriptionId
      if (clothingRecordId) body.clothingRecordId = clothingRecordId

      const res = await fetch(`/api/v1/characters/${characterId}?action=generate-external-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || errData.message || `Generation failed (${res.status})`)
      }

      const data = await res.json()
      onGenerated(data.prompt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const estimatedChars = maxTokens * 4
  const canGenerate = connectionProfileId && systemPromptId && !generating

  const selectClasses = 'w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md md:max-w-lg rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <h3 className="mb-4 text-lg font-semibold flex-shrink-0">
          Generate External Prompt{characterName ? ` for ${characterName}` : ''}
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-6 w-6 border-2 border-foreground border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 pr-2 -mr-2 space-y-4">
            {/* Connection Profile */}
            <div>
              <label htmlFor="ext-profile" className="mb-2 block text-sm qt-text-primary">
                LLM Connection Profile *
              </label>
              <select
                id="ext-profile"
                value={connectionProfileId}
                onChange={(e) => setConnectionProfileId(e.target.value)}
                className={selectClasses}
              >
                <option value="">Select a profile</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} / {profile.modelName})
                  </option>
                ))}
              </select>
            </div>

            {/* System Prompt */}
            <div>
              <label htmlFor="ext-system-prompt" className="mb-2 block text-sm qt-text-primary">
                System Prompt *
              </label>
              <select
                id="ext-system-prompt"
                value={systemPromptId}
                onChange={(e) => setSystemPromptId(e.target.value)}
                className={selectClasses}
              >
                <option value="">Select a system prompt</option>
                {systemPrompts?.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}{prompt.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              {(!systemPrompts || systemPrompts.length === 0) && (
                <p className="mt-1 text-xs qt-text-destructive">
                  This character has no system prompts. Add one first.
                </p>
              )}
            </div>

            {/* Scenario (optional) */}
            {scenarios && scenarios.length > 0 && (
              <div>
                <label htmlFor="ext-scenario" className="mb-2 block text-sm qt-text-primary">
                  Scenario (Optional)
                </label>
                <select
                  id="ext-scenario"
                  value={scenarioId}
                  onChange={(e) => setScenarioId(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">None</option>
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Physical Description (optional) */}
            {descriptions.length > 0 && (
              <div>
                <label htmlFor="ext-description" className="mb-2 block text-sm qt-text-primary">
                  Physical Description (Optional)
                </label>
                <select
                  id="ext-description"
                  value={descriptionId}
                  onChange={(e) => setDescriptionId(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">None</option>
                  {descriptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Clothing Record (optional) */}
            {clothingRecords.length > 0 && (
              <div>
                <label htmlFor="ext-clothing" className="mb-2 block text-sm qt-text-primary">
                  Clothing / Attire (Optional)
                </label>
                <select
                  id="ext-clothing"
                  value={clothingRecordId}
                  onChange={(e) => setClothingRecordId(e.target.value)}
                  className={selectClasses}
                >
                  <option value="">None</option>
                  {clothingRecords.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Token Size Slider */}
            <div>
              <label htmlFor="ext-max-tokens" className="mb-2 block text-sm qt-text-primary">
                Maximum Output Size
              </label>
              <input
                id="ext-max-tokens"
                type="range"
                min={1000}
                max={20000}
                step={500}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="mt-1 flex justify-between text-xs qt-text-secondary">
                <span>{maxTokens.toLocaleString()} tokens</span>
                <span>~{estimatedChars.toLocaleString()} characters</span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border qt-border-destructive/50 qt-bg-destructive/10 px-3 py-2 text-sm qt-text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={generating}
            className="rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90 disabled:opacity-50"
          >
            {generating ? (
              <span className="inline-flex items-center gap-2">
                <span className="animate-spin h-4 w-4 border-2 qt-border-primary-foreground border-t-transparent rounded-full" />
                Generating...
              </span>
            ) : (
              'Generate Prompt'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
