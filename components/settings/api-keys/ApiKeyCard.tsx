'use client'

/**
 * One API key as the settings lists show it: label, provider and preview, a
 * Test button, delete-with-confirm, last-used date and the latest test result.
 * Shared by the API Keys card and the per-provider cards, so the two rows can
 * never drift apart.
 *
 * @module components/settings/api-keys/ApiKeyCard
 */

import type { ReactNode } from 'react'
import { ProfileCard } from '@/components/ui/ProfileCard'
import type { ApiKeyActions } from './hooks/useApiKeyActions'

/** An API key as `GET /api/v1/api-keys` lists it. */
export interface ApiKeyListItem {
  id: string
  provider: string
  label: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  updatedAt: string
  keyPreview: string
}

export interface ApiKeyCardProps {
  apiKey: ApiKeyListItem
  actions: ApiKeyActions
  /** Extra header content (the per-provider view's persona badge). */
  headerExtra?: ReactNode
}

export function ApiKeyCard({ apiKey, actions, headerExtra }: ApiKeyCardProps) {
  const testResult = actions.testResults[apiKey.id]
  return (
    <ProfileCard
      title={apiKey.label}
      subtitle={`${apiKey.provider} • ${apiKey.keyPreview}`}
      headerExtra={headerExtra}
      actions={[
        {
          label: 'Test',
          onClick: () => actions.handleTest(apiKey.id),
          variant: 'secondary',
          loading: actions.testingKeyId === apiKey.id,
          loadingLabel: 'Testing...',
        },
      ]}
      deleteConfig={{
        isConfirming: actions.deleteConfirmId === apiKey.id,
        onConfirmChange: (confirming) => actions.setDeleteConfirmId(confirming ? apiKey.id : null),
        onConfirm: actions.handleDeleteConfirm,
        message: 'Delete this API key?',
        isDeleting: actions.isDeleting,
      }}
    >
      {/* Last used date */}
      {apiKey.lastUsed && (
        <p className="qt-text-xs">
          Last used: {new Date(apiKey.lastUsed).toLocaleDateString()}
        </p>
      )}

      {/* Test results */}
      {testResult && (
        <p
          className={`text-sm mt-2 ${
            testResult.startsWith('✓')
              ? 'qt-text-success'
              : 'qt-text-destructive/80'
          }`}
        >
          {testResult}
        </p>
      )}
    </ProfileCard>
  )
}
