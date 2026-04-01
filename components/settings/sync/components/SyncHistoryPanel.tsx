'use client'

/**
 * SyncHistoryPanel Component
 *
 * Collapsible panel showing recent sync operations with their status,
 * direction, timestamp, entity counts, and error counts.
 *
 * @module components/settings/sync/components/SyncHistoryPanel
 */

import { useState, useEffect } from 'react';
import { SyncOperationDisplay } from '../types';
import { SyncStatusBadge } from './SyncStatusBadge';
import { clientLogger } from '@/lib/client-logger';

interface SyncHistoryPanelProps {
  operations: SyncOperationDisplay[];
  isLoading: boolean;
}

/**
 * Formats a date string to a localized date/time string
 */
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Gets a human-readable direction label
 */
function getDirectionLabel(direction: string): string {
  switch (direction) {
    case 'PUSH':
      return 'Push';
    case 'PULL':
      return 'Pull';
    case 'BIDIRECTIONAL':
      return 'Bidirectional';
    default:
      return direction;
  }
}

/**
 * Gets direction icon
 */
function DirectionIcon({ direction }: { direction: string }) {
  if (direction === 'PUSH') {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16l-4-4m0 0l4-4m-4 4h18"
        />
      </svg>
    );
  }
  if (direction === 'PULL') {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 8l4 4m0 0l-4 4m4-4H3"
        />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  );
}

/**
 * Maps operation status to sync status for badge
 */
function mapOperationStatus(
  status: string
): 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null {
  switch (status) {
    case 'PENDING':
      return 'PENDING';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'COMPLETED':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    default:
      return null;
  }
}

/**
 * Collapsible panel showing sync operation history
 */
export function SyncHistoryPanel({ operations, isLoading }: SyncHistoryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('SyncHistoryPanel: rendered', {
      operationCount: operations.length,
      isLoading,
      isExpanded,
    });
  }, [operations.length, isLoading, isExpanded]);

  return (
    <div className="qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 qt-bg-surface hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="qt-text-primary font-medium">Recent Sync Operations</h3>
          {operations.length > 0 && (
            <span className="qt-text-small text-muted-foreground">
              ({operations.length})
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-muted-foreground transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="qt-bg-card border-t qt-border">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="qt-spinner mx-auto mb-2" />
              <p className="qt-text-small">Loading sync history...</p>
            </div>
          ) : operations.length === 0 ? (
            <div className="p-8 text-center">
              <p className="qt-text-small text-muted-foreground">No sync operations yet</p>
            </div>
          ) : (
            <div className="divide-y qt-border">
              {operations.map((operation) => (
                <div key={operation.id} className="p-4 hover:bg-accent transition-colors">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <DirectionIcon direction={operation.direction} />
                        <span className="qt-text-primary font-medium">
                          {getDirectionLabel(operation.direction)}
                        </span>
                        <span className="qt-text-small text-muted-foreground">
                          to {operation.instanceName}
                        </span>
                      </div>
                      <p className="qt-text-small text-muted-foreground">
                        {formatDateTime(operation.startedAt)}
                        {operation.completedAt && (
                          <> • Completed {formatDateTime(operation.completedAt)}</>
                        )}
                      </p>
                    </div>
                    <SyncStatusBadge status={mapOperationStatus(operation.status)} />
                  </div>

                  {/* Entity counts */}
                  {Object.keys(operation.entityCounts).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {Object.entries(operation.entityCounts).map(([entity, count]) => (
                        <span
                          key={entity}
                          className="inline-flex items-center px-2 py-0.5 rounded bg-muted qt-text-xs"
                        >
                          {entity}: {count}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Conflict/error counts */}
                  {(operation.conflictCount > 0 || operation.errorCount > 0) && (
                    <div className="flex gap-3 mt-2 qt-text-small">
                      {operation.conflictCount > 0 && (
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {operation.conflictCount} conflict{operation.conflictCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {operation.errorCount > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {operation.errorCount} error{operation.errorCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
