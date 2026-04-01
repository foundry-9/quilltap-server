'use client'

/**
 * Profile Selection Step
 *
 * Step 1: Select the primary LLM connection profile for generation.
 */

import type { ConnectionProfile } from '@/lib/schemas/types'

interface ProfileSelectionStepProps {
  profiles: ConnectionProfile[]
  loading: boolean
  selectedProfileId: string
  onSelectProfile: (profileId: string) => void
  error: string | null
}

export function ProfileSelectionStep({
  profiles,
  loading,
  selectedProfileId,
  onSelectProfile,
  error,
}: ProfileSelectionStepProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg
            className="w-5 h-5 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading connection profiles...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="qt-alert-error">
        {error}
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <div className="qt-alert-error">
        <p className="font-medium">No connection profiles available</p>
        <p className="text-sm mt-1">
          Please create a connection profile in Settings before using the AI Wizard.
        </p>
      </div>
    )
  }

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Select AI Model
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose the connection profile that will generate your character&apos;s details.
        </p>
      </div>

      <div>
        <label htmlFor="primaryProfile" className="qt-label">
          Connection Profile *
        </label>
        <select
          id="primaryProfile"
          value={selectedProfileId}
          onChange={(e) => onSelectProfile(e.target.value)}
          className="qt-select"
        >
          <option value="">Select a profile...</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.provider} - {profile.modelName})
              {profile.isDefault ? ' (Default)' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedProfile && (
        <div className="p-4 rounded-lg border border-border bg-muted/30">
          <h4 className="font-medium text-foreground mb-2">Selected Profile</h4>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Provider:</dt>
            <dd className="text-foreground">{selectedProfile.provider}</dd>
            <dt className="text-muted-foreground">Model:</dt>
            <dd className="text-foreground">{selectedProfile.modelName}</dd>
            {selectedProfile.isCheap && (
              <>
                <dt className="text-muted-foreground">Type:</dt>
                <dd className="text-foreground">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    Cost-efficient
                  </span>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      <div className="p-4 rounded-lg border border-border bg-muted/20">
        <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Tip
        </h4>
        <p className="text-sm text-muted-foreground">
          For best results, choose a capable model like GPT-4, Claude Opus, or Gemini Pro.
          Cost-efficient models may produce simpler results.
        </p>
      </div>
    </div>
  )
}
