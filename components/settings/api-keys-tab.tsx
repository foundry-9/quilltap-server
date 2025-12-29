'use client'

import { useEffect, useState } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { fetchJson } from '@/lib/fetch-helpers'
import { clientLogger } from '@/lib/client-logger'
import SectionHeader from '@/components/ui/SectionHeader'
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
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<{ [key: string]: string }>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Load initial state
  const loadKeys = useAsyncOperation<ApiKey[]>()
  const deleteKey = useAsyncOperation<void>()
  const testKey = useAsyncOperation<{ valid: boolean; error?: string }>()
  const triggerAutoAssociate = useAutoAssociate('api-keys')

  const fetchApiKeysData = async () => {
    clientLogger.debug('Fetching API keys')
    const result = await loadKeys.execute(async () => {
      const response = await fetchJson<ApiKey[]>('/api/keys', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch API keys')
      }

      clientLogger.debug('API keys fetched successfully', {
        count: response.data?.length || 0,
      })
      return response.data || []
    })

    if (result) {
      setApiKeys(result)
    }
  }

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
  }, [triggerAutoAssociate])

  // Load API keys on mount
  useEffect(() => {
    clientLogger.debug('ApiKeysTab mounted, fetching API keys')
    fetchApiKeysData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDeleteClick = (id: string) => {
    clientLogger.debug('Delete confirmation requested for API key', { id })
    setDeleteConfirmId(id)
  }

  const handleDeleteCancel = () => {
    clientLogger.debug('Delete confirmation cancelled')
    setDeleteConfirmId(null)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return

    clientLogger.debug('Deleting API key', { id: deleteConfirmId })
    const result = await deleteKey.execute(async () => {
      const response = await fetchJson<void>(`/api/keys/${deleteConfirmId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete API key')
      }

      clientLogger.debug('API key deleted successfully', { id: deleteConfirmId })
    })

    if (result !== null) {
      setDeleteConfirmId(null)
      await fetchApiKeysData()
    }
  }

  const handleTest = async (id: string) => {
    clientLogger.debug('Testing API key', { id })
    setTestingKeyId(id)
    setTestResults({})

    const result = await testKey.execute(async () => {
      const response = await fetchJson<{ valid: boolean; error?: string }>(
        `/api/keys/${id}/test`,
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
        clientLogger.debug('API key test passed', { id })
      } else {
        setTestResults({ [id]: `✗ ${result.error || 'Key is invalid'}` })
        clientLogger.debug('API key test failed', { id, error: result.error })
      }
    } else {
      setTestResults({ [id]: 'Connection failed' })
      clientLogger.error('API key test connection failed', { id })
    }

    setTestingKeyId(null)
  }

  const handleOpenModal = () => {
    clientLogger.debug('Add API key modal opened')
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    clientLogger.debug('Add API key modal closed')
    setIsModalOpen(false)
  }

  const handleModalSuccess = () => {
    clientLogger.debug('API key created via modal')
    fetchApiKeysData()
  }

  const handleOpenExportDialog = () => {
    clientLogger.debug('Export keys dialog opened')
    setIsExportDialogOpen(true)
  }

  const handleCloseExportDialog = () => {
    clientLogger.debug('Export keys dialog closed')
    setIsExportDialogOpen(false)
  }

  const handleOpenImportDialog = () => {
    clientLogger.debug('Import keys dialog opened')
    setIsImportDialogOpen(true)
  }

  const handleCloseImportDialog = () => {
    clientLogger.debug('Import keys dialog closed')
    setIsImportDialogOpen(false)
  }

  const handleImportSuccess = () => {
    clientLogger.debug('API keys imported successfully')
    fetchApiKeysData()
  }

  // Show loading state while fetching initial data
  if (loadKeys.loading && apiKeys.length === 0) {
    return <LoadingState message="Loading API keys..." />
  }

  const sortedKeys = apiKeys.toSorted((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      {/* Main error state */}
      {loadKeys.error && (
        <ErrorAlert
          message={loadKeys.error}
          onRetry={fetchApiKeysData}
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
              onClick={handleOpenModal}
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
              onClick: handleOpenModal,
            }}
          />
        ) : (
          <div className="space-y-3">
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
                        ? 'text-green-600'
                        : 'text-destructive/80'
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
