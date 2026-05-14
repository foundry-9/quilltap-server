'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { useModalState } from '@/hooks/useModalState'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import LoadingState from '@/components/ui/LoadingState'
import ErrorAlert from '@/components/ui/ErrorAlert'
import EmptyState from '@/components/ui/EmptyState'
import { ProfileCard } from '@/components/ui/ProfileCard'
import { ApiKeyModal } from './api-keys/ApiKeyModal'
import { ExportKeysDialog } from './api-keys/ExportKeysDialog'
import { ImportKeysDialog } from './api-keys/ImportKeysDialog'

interface ApiKey {
  id: string
  provider: string
  label: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  updatedAt: string
  keyPreview: string
}

export default function ApiKeysTab() {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<{ [key: string]: string }>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data, isLoading, error: loadError, mutate: mutateKeys } = useSWR<{ apiKeys: ApiKey[]; count: number }>(
    '/api/v1/api-keys'
  )
  const {
    isOpen: isModalOpen,
    openModal: handleOpenModal,
    closeModal: handleCloseModal,
    handleSuccess: handleModalSuccess,
  } = useModalState(() => mutateKeys())
  const apiKeys = data?.apiKeys ?? []
  const deleteKey = useAsyncOperation<void>()
  const testKey = useAsyncOperation<{ valid: boolean; error?: string }>()
  const triggerAutoAssociate = useAutoAssociate()

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
  }, [triggerAutoAssociate])

  const handleDeleteClick = (id: string) => {
    setDeleteConfirmId(id)
  }

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return

    const result = await deleteKey.execute(async () => {
      const response = await fetchJson<void>(`/api/v1/api-keys/${deleteConfirmId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete API key')
      }
    })

    if (result !== null) {
      setDeleteConfirmId(null)
      await mutateKeys()
    }
  }

  const handleTest = async (id: string) => {
    setTestingKeyId(id)
    setTestResults({})

    const result = await testKey.execute(async () => {
      const response = await fetchJson<{ valid: boolean; error?: string }>(
        `/api/v1/api-keys/${id}?action=test`,
        { method: 'POST' }
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to test API key')
      }

      return response.data || { valid: false }
    })

    if (result) {
      if (result.valid) {
        setTestResults({ [id]: '✓ Key is valid' })
      } else {
        setTestResults({ [id]: `✗ ${result.error || 'Key is invalid'}` })
      }
    } else {
      setTestResults({ [id]: 'Connection failed' })
      console.error('API key test connection failed', { id })
    }

    setTestingKeyId(null)
  }

  const handleOpenExportDialog = () => {
    setIsExportDialogOpen(true)
  }

  const handleCloseExportDialog = () => {
    setIsExportDialogOpen(false)
  }

  const handleOpenImportDialog = () => {
    setIsImportDialogOpen(true)
  }

  const handleCloseImportDialog = () => {
    setIsImportDialogOpen(false)
  }

  const handleImportSuccess = () => {
    mutateKeys()
  }

  // Show loading state while fetching initial data
  if (isLoading && apiKeys.length === 0) {
    return <LoadingState message="Loading API keys..." />
  }

  const sortedKeys = apiKeys.toSorted((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      {/* Main error state */}
      {loadError && (
        <ErrorAlert
          message={getErrorMessage(loadError, 'Failed to fetch API keys')}
          onRetry={() => mutateKeys()}
          className="mb-4"
        />
      )}

      {/* Delete key error state */}
      {deleteKey.error && (
        <ErrorAlert
          message={deleteKey.error}
          className="mb-4"
        />
      )}

      {/* API Keys List */}
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="qt-text-section text-foreground flex-1">
            Your API Keys ({sortedKeys.length})
          </h2>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleOpenImportDialog}
              className="qt-button-secondary qt-button-sm"
            >
              Import
            </button>
            <button
              type="button"
              onClick={handleOpenExportDialog}
              className="qt-button-secondary qt-button-sm"
              disabled={sortedKeys.length === 0}
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => handleOpenModal()}
              className="qt-button-secondary qt-button-sm"
            >
              + Add API Key
            </button>
          </div>
        </div>

        {sortedKeys.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Add one to get started."
            action={{
              label: 'Add API Key',
              onClick: () => handleOpenModal(),
            }}
          />
        ) : (
          <div className="qt-card-grid-auto">
            {sortedKeys.map((key) => (
              <ProfileCard
                key={key.id}
                title={key.label}
                subtitle={`${key.provider} • ${key.keyPreview}`}
                actions={[
                  {
                    label: 'Test',
                    onClick: () => handleTest(key.id),
                    variant: 'secondary',
                    loading: testingKeyId === key.id,
                    loadingLabel: 'Testing...',
                  },
                ]}
                deleteConfig={{
                  isConfirming: deleteConfirmId === key.id,
                  onConfirmChange: (confirming) => confirming ? handleDeleteClick(key.id) : handleDeleteCancel(),
                  onConfirm: handleDeleteConfirm,
                  message: 'Delete this API key?',
                  isDeleting: deleteKey.loading,
                }}
              >
                {/* Last used date */}
                {key.lastUsed && (
                  <p className="qt-text-xs">
                    Last used: {new Date(key.lastUsed).toLocaleDateString()}
                  </p>
                )}

                {/* Test results */}
                {testResults[key.id] && (
                  <p
                    className={`text-sm mt-2 ${
                      testResults[key.id].startsWith('✓')
                        ? 'qt-text-success'
                        : 'qt-text-destructive/80'
                    }`}
                  >
                    {testResults[key.id]}
                  </p>
                )}
              </ProfileCard>
            ))}
          </div>
        )}
      </div>

      {/* Add API Key Modal */}
      <ApiKeyModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
      />

      {/* Export Keys Dialog */}
      <ExportKeysDialog
        isOpen={isExportDialogOpen}
        onClose={handleCloseExportDialog}
        keyCount={sortedKeys.length}
      />

      {/* Import Keys Dialog */}
      <ImportKeysDialog
        isOpen={isImportDialogOpen}
        onClose={handleCloseImportDialog}
        onSuccess={handleImportSuccess}
      />
    </div>
  )
}
