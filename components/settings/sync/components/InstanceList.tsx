'use client'

/**
 * InstanceList Component
 *
 * List of sync instance cards with header and "Add Instance" button.
 * Shows empty state when no instances exist.
 *
 * @module components/settings/sync/components/InstanceList
 */

import { useEffect } from 'react';
import { SyncInstanceDisplay } from '../types';
import { InstanceCard } from './InstanceCard';
import { clientLogger } from '@/lib/client-logger';
import type { SyncDirection } from '@/lib/sync/types';

interface InstanceListProps {
  instances: SyncInstanceDisplay[];
  syncingInstanceId: string | null;
  deleteConfirmId: string | null;
  onEdit: (instance: SyncInstanceDisplay) => void;
  onDelete: (instanceId: string) => void;
  onSync: (instanceId: string, forceFull?: boolean, direction?: SyncDirection) => void;
  onTest: (instanceId: string) => void;
  onDeleteConfirmToggle: (instanceId: string | null) => void;
  onCreate: () => void;
}

/**
 * List component displaying sync instance cards
 */
export function InstanceList({
  instances,
  syncingInstanceId,
  deleteConfirmId,
  onEdit,
  onDelete,
  onSync,
  onTest,
  onDeleteConfirmToggle,
  onCreate,
}: InstanceListProps) {
  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('InstanceList: rendered', {
      instanceCount: instances.length,
      syncingInstanceId,
    });
  }, [instances.length, syncingInstanceId]);

  // Empty state
  if (instances.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
        <h3 className="mt-4 qt-text-primary font-medium">No sync instances</h3>
        <p className="mt-2 qt-text-small max-w-md mx-auto">
          Add a sync instance to synchronize your data with other Quilltap installations.
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="mt-6 qt-button-primary"
        >
          Add Instance
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header with Add button */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="qt-text-primary font-medium">Sync Instances</h3>
        <button
          type="button"
          onClick={onCreate}
          className="qt-button-primary qt-button-sm"
        >
          Add Instance
        </button>
      </div>

      {/* Instance cards */}
      <div className="space-y-4">
        {instances.map((instance) => (
          <InstanceCard
            key={instance.id}
            instance={instance}
            isSyncing={syncingInstanceId === instance.id}
            onEdit={onEdit}
            onDelete={onDelete}
            onSync={onSync}
            onTest={onTest}
            deleteConfirmId={deleteConfirmId}
            onDeleteConfirmToggle={onDeleteConfirmToggle}
          />
        ))}
      </div>
    </div>
  );
}
