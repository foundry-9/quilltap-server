'use client'

import type { ChatSettings, CheapLLMSettings as CheapLLMSettingsType, ConnectionProfile, EmbeddingProfile, CheapLLMStrategy, EmbeddingProvider } from './types'

export interface CheapLLMSettingsProps {
  settings: ChatSettings
  saving: boolean
  loadingProfiles: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  onUpdate: (updates: Partial<CheapLLMSettingsType>) => Promise<void>
}

/**
 * CheapLLMSettings Component
 * Manages configuration for cheap LLM usage for background tasks
 */
export function CheapLLMSettings({
  settings,
  saving,
  loadingProfiles,
  connectionProfiles,
  embeddingProfiles,
  onUpdate,
}: CheapLLMSettingsProps) {
  return (
    <div className="border-t border-border pt-6">
      <h2 className="text-xl font-semibold mb-4">Cheap LLM Settings</h2>
      <p className="text-muted-foreground mb-4">
        Configure which LLM to use for background tasks like memory extraction and summarization
      </p>

      <div className="space-y-4">
        {/* Strategy Selection */}
        <div>
          <label className="block qt-text-label mb-2">
            Strategy
          </label>
          <div className="space-y-2">
            {[
              { value: 'USER_DEFINED' as CheapLLMStrategy, label: 'User Defined', description: 'Use the profile you select below' },
              { value: 'PROVIDER_CHEAPEST' as CheapLLMStrategy, label: 'Provider Cheapest', description: 'Automatically use the cheapest model from current provider' },
              { value: 'LOCAL_FIRST' as CheapLLMStrategy, label: 'Local First', description: 'Prefer local/Ollama models if available' },
            ].map((strategy) => (
              <label
                key={strategy.value}
                className="flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
              >
                <input
                  type="radio"
                  name="cheapLLMStrategy"
                  value={strategy.value}
                  checked={settings?.cheapLLMSettings.strategy === strategy.value}
                  onChange={() => onUpdate({ strategy: strategy.value })}
                  disabled={saving}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{strategy.label}</div>
                  <div className="qt-text-xs">
                    {strategy.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* User Defined Profile Selection */}
        {settings?.cheapLLMSettings.strategy === 'USER_DEFINED' && (
          <div>
            <label className="block qt-text-label mb-2">
              Select Cheap LLM Profile
            </label>
            <select
              value={settings?.cheapLLMSettings.userDefinedProfileId || ''}
              onChange={(e) => onUpdate({ userDefinedProfileId: e.target.value || null })}
              disabled={saving || loadingProfiles}
              className="qt-select"
            >
              <option value="">Select a profile...</option>
              {connectionProfiles.map((profile) => {
                const hasApiKey = Boolean(profile.apiKey)
                return (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                  </option>
                )
              })}
            </select>
            {connectionProfiles.length === 0 && !loadingProfiles && (
              <p className="mt-1 qt-text-xs text-amber-600 dark:text-amber-400">
                No connection profiles found. Create one in the Connection Profiles tab first.
              </p>
            )}
          </div>
        )}

        {/* Default Cheap Profile (Global Override) */}
        <div>
          <label className="block qt-text-label mb-2">
            Global Default Cheap LLM (Optional Override)
          </label>
          <p className="qt-text-xs mb-2">
            If set, this profile will always be used regardless of strategy
          </p>
          <select
            value={settings?.cheapLLMSettings.defaultCheapProfileId || ''}
            onChange={(e) => onUpdate({ defaultCheapProfileId: e.target.value || null })}
            disabled={saving || loadingProfiles}
            className="qt-select"
          >
            <option value="">Not set</option>
            {connectionProfiles.map((profile) => {
              const hasApiKey = Boolean(profile.apiKey)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
        </div>

        {/* Image Prompt Expansion LLM Override */}
        <div>
          <label className="block qt-text-label mb-2">
            Image Prompt Expansion LLM (Optional)
          </label>
          <p className="qt-text-xs mb-2">
            Override the cheap LLM specifically for image prompt crafting. A more capable model may produce better image generation prompts with richer descriptions.
          </p>
          <select
            value={settings?.cheapLLMSettings.imagePromptProfileId || ''}
            onChange={(e) => onUpdate({ imagePromptProfileId: e.target.value || null })}
            disabled={saving || loadingProfiles}
            className="qt-select"
          >
            <option value="">Use global cheap LLM</option>
            {connectionProfiles.map((profile) => {
              const hasApiKey = Boolean(profile.apiKey)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
          {connectionProfiles.length === 0 && !loadingProfiles && (
            <p className="mt-1 qt-text-xs text-amber-600 dark:text-amber-400">
              No connection profiles found. Create one in the Connection Profiles tab first.
            </p>
          )}
        </div>

        {/* Fallback to Local */}
        <label className="flex items-center gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={settings?.cheapLLMSettings.fallbackToLocal ?? true}
            onChange={(e) => onUpdate({ fallbackToLocal: e.target.checked })}
            disabled={saving}
            className="rounded"
          />
          <div className="flex-1">
            <div className="font-medium text-sm">Fallback to Local</div>
            <div className="qt-text-xs">
              Use local Ollama models as fallback if configured strategy is unavailable
            </div>
          </div>
        </label>

        {/* Embedding Provider */}
        <div>
          <label className="block qt-text-label mb-2">
            Embedding Provider
          </label>
          <div className="space-y-2">
            {[
              { value: 'SAME_PROVIDER' as EmbeddingProvider, label: 'Same Provider', description: 'Use embeddings from the same provider as the cheap LLM' },
              { value: 'OPENAI' as EmbeddingProvider, label: 'OpenAI', description: 'Use OpenAI for embeddings' },
              { value: 'LOCAL' as EmbeddingProvider, label: 'Local', description: 'Use local Ollama embeddings' },
            ].map((provider) => (
              <label
                key={provider.value}
                className="flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
              >
                <input
                  type="radio"
                  name="embeddingProvider"
                  value={provider.value}
                  checked={settings?.cheapLLMSettings.embeddingProvider === provider.value}
                  onChange={() => onUpdate({ embeddingProvider: provider.value })}
                  disabled={saving}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{provider.label}</div>
                  <div className="qt-text-xs">
                    {provider.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Embedding Profile Selection */}
        <div>
          <label className="block qt-text-label mb-2">
            Embedding Profile (Optional)
          </label>
          <p className="qt-text-xs mb-2">
            Specific embedding profile to use. Leave blank to use the default for the selected embedding provider.
          </p>
          <select
            value={settings?.cheapLLMSettings.embeddingProfileId || ''}
            onChange={(e) => onUpdate({ embeddingProfileId: e.target.value || null })}
            disabled={saving}
            className="qt-select"
          >
            <option value="">Use default for provider</option>
            {embeddingProfiles.map((profile) => {
              // OpenAI requires API key, Ollama doesn't
              const requiresApiKey = profile.provider === 'OPENAI'
              const hasApiKey = Boolean(profile.apiKey)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName}){requiresApiKey && !hasApiKey ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
          {embeddingProfiles.length === 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              No embedding profiles found. Create one in the Embedding Profiles tab.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
