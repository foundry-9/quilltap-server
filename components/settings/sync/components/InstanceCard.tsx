'use client'

/**
 * InstanceCard Component
 *
 * Card displaying a single sync instance with its details and action buttons.
 * Shows name, URL, status, last sync time, schema/app versions, and provides
 * buttons for syncing, testing connection, editing, and deleting.
 *
 * @module components/settings/sync/components/InstanceCard
 */

import { useEffect, useState, useRef } from 'react';
import { SyncInstanceDisplay } from '../types';
import { SyncStatusBadge } from './SyncStatusBadge';
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover';
import { clientLogger } from '@/lib/client-logger';

interface InstanceCardProps {
  instance: SyncInstanceDisplay;
  isSyncing: boolean;
  onEdit: (instance: SyncInstanceDisplay) => void;
  onDelete: (instanceId: string) => void;
  onSync: (instanceId: string, forceFull?: boolean) => void;
  onTest: (instanceId: string) => void;
  deleteConfirmId: string | null;
  onDeleteConfirmToggle: (instanceId: string | null) => void;
}

/**
 * Formats a date string to a relative time string (e.g., "2 hours ago")
 */
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

/**
 * Card component for displaying a sync instance
 */
export function InstanceCard({
  instance,
  isSyncing,
  onEdit,
  onDelete,
  onSync,
  onTest,
  deleteConfirmId,
  onDeleteConfirmToggle,
}: InstanceCardProps) {
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const syncMenuRef = useRef<HTMLDivElement>(null);

  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('InstanceCard: rendered', {
      instanceId: instance.id,
      isSyncing,
    });
  }, [instance.id, isSyncing]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (syncMenuRef.current && !syncMenuRef.current.contains(event.target as Node)) {
        setShowSyncMenu(false);
      }
    };

    if (showSyncMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSyncMenu]);

  const handleSyncNow = () => {
    setShowSyncMenu(false);
    onSync(instance.id, false);
  };

  const handleForceFullSync = () => {
    setShowSyncMenu(false);
    onSync(instance.id, true);
  };

  return (
    <div className="qt-bg-card qt-border rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="qt-text-primary truncate font-medium">{instance.name}</h3>
          <p className="qt-text-small truncate mt-0.5">{instance.url}</p>
        </div>
        <SyncStatusBadge status={instance.lastSyncStatus} />
      </div>

      <div className="space-y-2 mb-3 qt-text-small">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Last synced:</span>
          <span className="qt-text-primary">{formatRelativeTime(instance.lastSyncAt)}</span>
        </div>
        {instance.schemaVersion && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Schema version:</span>
            <span className="qt-text-primary font-mono text-xs">{instance.schemaVersion}</span>
          </div>
        )}
        {instance.appVersion && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">App version:</span>
            <span className="qt-text-primary font-mono text-xs">{instance.appVersion}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Status:</span>
          <span className="qt-text-primary">
            {instance.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {/* Sync dropdown */}
        <div className="relative" ref={syncMenuRef}>
          <button
            type="button"
            onClick={() => setShowSyncMenu(!showSyncMenu)}
            disabled={isSyncing || !instance.isActive}
            className="qt-button-primary qt-button-sm flex items-center gap-1"
          >
            {isSyncing ? (
              <span className="flex items-center gap-2">
                <span className="qt-spinner-sm" />
                Syncing...
              </span>
            ) : (
              <>
                Sync
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </>
            )}
          </button>
          {showSyncMenu && !isSyncing && (
            <div className="absolute left-0 mt-1 qt-dropdown min-w-[180px]">
              <button
                type="button"
                onClick={handleSyncNow}
                className="qt-dropdown-item w-full text-left"
              >
                Sync Now
              </button>
              <div className="qt-dropdown-separator" />
              <button
                type="button"
                onClick={handleForceFullSync}
                className="qt-dropdown-item w-full text-left flex-col items-start"
              >
                <div>Force Full Sync</div>
                <div className="text-xs text-muted-foreground">
                  Pulls all data from remote
                </div>
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onTest(instance.id)}
          disabled={isSyncing}
          className="qt-button-secondary qt-button-sm"
        >
          Test Connection
        </button>
        <button
          type="button"
          onClick={() => onEdit(instance)}
          disabled={isSyncing}
          className="qt-button-secondary qt-button-sm"
        >
          Edit
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() =>
              onDeleteConfirmToggle(deleteConfirmId === instance.id ? null : instance.id)
            }
            disabled={isSyncing}
            className="qt-button-destructive qt-button-sm"
          >
            Delete
          </button>
          <DeleteConfirmPopover
            isOpen={deleteConfirmId === instance.id}
            isDeleting={false}
            onCancel={() => onDeleteConfirmToggle(null)}
            onConfirm={() => onDelete(instance.id)}
            message="Are you sure you want to delete this sync instance?"
          />
        </div>
      </div>
    </div>
  );
}
