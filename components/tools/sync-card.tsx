'use client'

/**
 * Sync Card
 *
 * Tool card for managing sync instances and viewing sync history.
 * Allows users to add remote Quilltap instances, test connections,
 * trigger manual syncs, and view operation history.
 *
 * @module components/tools/sync-card
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { SyncFormData, SyncInstanceDisplay, INITIAL_FORM_DATA } from '@/components/settings/sync/types'
import { useSyncInstances, useSyncOperations, useSyncTrigger, useSyncApiKeys, useSyncCleanup, useSyncProgress } from '@/components/settings/sync/hooks'
import { InstanceList, InstanceForm, SyncHistoryPanel, ApiKeyPanel, CleanupPanel, SyncProgressBar } from '@/components/settings/sync/components'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import type { SyncDirection } from '@/lib/sync/types'

/**
 * Sync card component for the Tools page
 */
export function SyncCard() {
  // Form state
  const [formData, setFormData] = useState<SyncFormData>(INITIAL_FORM_DATA)
  const [editingInstance, setEditingInstance] = useState<SyncInstanceDisplay | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  // Hooks
  const instances = useSyncInstances()
  const operations = useSyncOperations()
  const syncTrigger = useSyncTrigger()
  const apiKeys = useSyncApiKeys()
  const cleanup = useSyncCleanup()

  // Track the name of the instance being synced for progress display
  const [syncingInstanceName, setSyncingInstanceName] = useState<string>('')

  // Get instance name for progress bar
  const currentSyncingInstance = useMemo(() => {
    if (syncTrigger.syncingInstanceId) {
      const instance = instances.instances.find(i => i.id === syncTrigger.syncingInstanceId)
      return instance?.name || ''
    }
    return ''
  }, [syncTrigger.syncingInstanceId, instances.instances])

  // Update syncing instance name when sync starts
  useEffect(() => {
    if (currentSyncingInstance) {
      setSyncingInstanceName(currentSyncingInstance)
    }
  }, [currentSyncingInstance])

  // Progress tracking
  const syncProgress = useSyncProgress(
    syncTrigger.activeOperationId,
    syncingInstanceName
  )

  // Fetch data on mount
  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 0))

      if (!isMounted) return

      instances.fetchInstances()
      operations.fetchOperations()
      apiKeys.fetchKeys()
    }

    fetchData()

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Log renders
  useEffect(() => {
    clientLogger.debug('SyncCard: rendered', {
      instanceCount: instances.instances.length,
      operationCount: operations.operations.length,
      apiKeyCount: apiKeys.keys.length,
      isFormOpen,
      editingInstanceId: editingInstance?.id,
    })
  }, [instances.instances.length, operations.operations.length, apiKeys.keys.length, isFormOpen, editingInstance])

  // Open create form
  const openCreateForm = useCallback(() => {
    setEditingInstance(null)
    setFormData(INITIAL_FORM_DATA)
    setIsFormOpen(true)
  }, [])

  // Open edit form
  const openEditForm = useCallback((instance: SyncInstanceDisplay) => {
    clientLogger.debug('SyncCard: opening edit form', { instanceId: instance.id })
    setEditingInstance(instance)
    setFormData({
      name: instance.name,
      url: instance.url,
      apiKey: '',
      isActive: instance.isActive,
    })
    setIsFormOpen(true)
  }, [])

  // Close form
  const closeForm = useCallback(() => {
    setIsFormOpen(false)
    setEditingInstance(null)
    setFormData(INITIAL_FORM_DATA)
  }, [])

  // Handle form field change
  const handleFormChange = useCallback((field: keyof SyncFormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }, [])

  // Handle form submit
  const handleFormSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    clientLogger.debug('SyncCard: form submitted', {
      isEditing: !!editingInstance,
      formData: { ...formData, apiKey: formData.apiKey ? '[REDACTED]' : '' },
    })

    if (editingInstance) {
      const result = await instances.updateInstance(editingInstance.id, {
        name: formData.name,
        isActive: formData.isActive,
        ...(formData.apiKey ? { apiKey: formData.apiKey } : {}),
      })
      if (result) {
        closeForm()
      }
    } else {
      const result = await instances.createInstance(formData)
      if (result) {
        closeForm()
        operations.fetchOperations()
      }
    }
  }, [editingInstance, formData, instances, operations, closeForm])

  // Handle sync trigger
  const handleSync = useCallback(
    async (
      instanceId: string,
      forceFull: boolean = false,
      direction: SyncDirection = 'BIDIRECTIONAL'
    ) => {
      clientLogger.debug('SyncCard: triggering sync', { instanceId, forceFull, direction })
      const result = await syncTrigger.triggerSync(instanceId, forceFull, direction)
      if (result) {
        instances.fetchInstances()
        operations.fetchOperations()
      }
    },
    [syncTrigger, instances, operations]
  )

  // Handle connection test
  const handleTest = useCallback(async (instanceId: string) => {
    clientLogger.debug('SyncCard: testing connection', { instanceId })
    const result = await instances.testConnection(instanceId)
    if (result) {
      if (result.success) {
        clientLogger.info('SyncCard: connection test successful', {
          instanceId,
          versionInfo: result.versionInfo,
        })
      } else {
        clientLogger.warn('SyncCard: connection test failed', {
          instanceId,
          error: result.error,
        })
      }
    }
  }, [instances])

  // Handle delete
  const handleDelete = useCallback(async (instanceId: string) => {
    clientLogger.debug('SyncCard: deleting instance', { instanceId })
    await instances.deleteInstance(instanceId)
  }, [instances])

  // Handle progress bar dismiss
  const handleDismissProgress = useCallback(() => {
    syncProgress.clearProgress()
    syncTrigger.clearActiveOperation()
    setSyncingInstanceName('')
  }, [syncProgress, syncTrigger])

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">
            Sync
          </h2>
          <p className="qt-text-small">
            Sync your data with other Quilltap instances
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
      </div>

      {/* Loading state */}
      {instances.fetchOp.loading && instances.instances.length === 0 ? (
        <LoadingState message="Loading sync instances..." />
      ) : (
        <div className="space-y-6">
          {/* Sync Progress Bar */}
          {(syncProgress.progress || syncTrigger.syncingInstanceId) && (
            <SyncProgressBar
              progress={syncProgress.progress}
              instanceName={syncingInstanceName}
              isComplete={syncProgress.isComplete}
              isFailed={syncProgress.isFailed}
              onDismiss={handleDismissProgress}
            />
          )}

          {/* API Key Panel - for receiving sync requests */}
          <ApiKeyPanel
            keys={apiKeys.keys}
            newlyCreatedKey={apiKeys.newlyCreatedKey}
            isLoading={apiKeys.fetchOp.loading}
            isCreating={apiKeys.createOp.loading}
            deleteConfirmId={apiKeys.deleteConfirm}
            success={apiKeys.success}
            error={apiKeys.createOp.error || apiKeys.deleteOp.error}
            onCreateKey={apiKeys.createKey}
            onDeleteKey={apiKeys.deleteKey}
            onDeleteConfirmToggle={apiKeys.setDeleteConfirm}
            onClearNewKey={apiKeys.clearNewlyCreatedKey}
          />

          {/* Cleanup Panel - for resetting sync state */}
          <CleanupPanel
            showConfirm={cleanup.showConfirm}
            lastResult={cleanup.lastResult}
            isLoading={cleanup.cleanupOp.loading}
            error={cleanup.cleanupOp.error}
            onShowConfirm={cleanup.setShowConfirm}
            onCleanup={cleanup.executeCleanup}
            onClearResult={cleanup.clearResult}
          />

          {/* Error alerts */}
          {instances.fetchOp.error && (
            <ErrorAlert
              message={instances.fetchOp.error}
              onRetry={instances.fetchInstances}
            />
          )}

          {instances.saveOp.error && (
            <ErrorAlert
              message={instances.saveOp.error}
              onRetry={() => {}}
            />
          )}

          {instances.deleteOp.error && (
            <ErrorAlert
              message={instances.deleteOp.error}
              onRetry={() => {}}
            />
          )}

          {syncTrigger.syncOp.error && (
            <ErrorAlert
              message={syncTrigger.syncOp.error}
              onRetry={() => {}}
            />
          )}

          {instances.testOp.error && (
            <ErrorAlert
              message={`Connection test failed: ${instances.testOp.error}`}
              onRetry={() => {}}
            />
          )}

          {/* Success message */}
          {instances.success && (
            <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
              {instances.success}
            </div>
          )}

          {/* Form section */}
          {isFormOpen ? (
            <div className="qt-bg-card qt-border rounded-lg p-4">
              <h3 className="qt-text-primary font-medium mb-4">
                {editingInstance ? 'Edit Sync Instance' : 'Add Sync Instance'}
              </h3>
              <InstanceForm
                formData={formData}
                isEditing={!!editingInstance}
                isSaving={instances.saveOp.loading}
                onSubmit={handleFormSubmit}
                onChange={handleFormChange}
                onCancel={closeForm}
              />
            </div>
          ) : (
            <InstanceList
              instances={instances.instances}
              syncingInstanceId={syncTrigger.syncingInstanceId}
              deleteConfirmId={instances.deleteConfirm}
              onEdit={openEditForm}
              onDelete={handleDelete}
              onSync={handleSync}
              onTest={handleTest}
              onDeleteConfirmToggle={instances.setDeleteConfirm}
              onCreate={openCreateForm}
            />
          )}

          {/* Sync history panel */}
          {!isFormOpen && (
            <SyncHistoryPanel
              operations={operations.operations}
              isLoading={operations.fetchOp.loading}
            />
          )}
        </div>
      )}
    </div>
  )
}
