'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { useModalState } from '@/hooks/useModalState'
import { getErrorMessage } from '@/lib/error-utils'
import LoadingState from '@/components/ui/LoadingState'
import ErrorAlert from '@/components/ui/ErrorAlert'
import EmptyState from '@/components/ui/EmptyState'
import { ApiKeyModal } from './api-keys/ApiKeyModal'
import { ApiKeyCard, type ApiKeyListItem } from './api-keys/ApiKeyCard'
import { useApiKeyActions } from './api-keys/hooks/useApiKeyActions'
import { ExportKeysDialog } from './api-keys/ExportKeysDialog'
import { ImportKeysDialog } from './api-keys/ImportKeysDialog'

export default function ApiKeysTab() {
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)

  const { data, isLoading, error: loadError, refetch: mutateKeys } = useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: ({ signal }) => apiFetch<{ apiKeys: ApiKeyListItem[]; count: number }>('/api/v1/api-keys', { signal }),
  })
  const {
    isOpen: isModalOpen,
    openModal: handleOpenModal,
    closeModal: handleCloseModal,
    handleSuccess: handleModalSuccess,
  } = useModalState(() => mutateKeys())
  const apiKeys = data?.apiKeys ?? []
  const keyActions = useApiKeyActions(mutateKeys)
  const triggerAutoAssociate = useAutoAssociate()

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
  }, [triggerAutoAssociate])

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
      {keyActions.deleteError && (
        <ErrorAlert
          message={keyActions.deleteError}
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
              <ApiKeyCard key={key.id} apiKey={key} actions={keyActions} />
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
