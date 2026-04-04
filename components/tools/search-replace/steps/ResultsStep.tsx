'use client';

/**
 * ResultsStep Component
 *
 * Step 5: Show results of the search/replace operation.
 */

import type { SearchReplaceResult } from '../types';

interface ResultsStepProps {
  result: SearchReplaceResult | null;
  error: string | null;
}

export function ResultsStep({ result, error }: ResultsStepProps) {

  if (error) {
    return (
      <div className="space-y-6 py-4">
        <div className="flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full qt-bg-destructive/10 flex items-center justify-center mb-4">
            <span className="text-2xl">❌</span>
          </div>

          <h3 className="qt-text-destructive text-lg font-medium mb-2">
            Operation Failed
          </h3>

          <p className="qt-text-secondary text-sm text-center max-w-md">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="space-y-6 py-4">
        <div className="flex flex-col items-center justify-center">
          <p className="qt-text-secondary">No results available</p>
        </div>
      </div>
    );
  }

  const totalUpdated = result.messagesUpdated + result.memoriesUpdated;
  const hasErrors = result.errors.length > 0;

  return (
    <div className="space-y-6 py-4">
      <div className="flex flex-col items-center justify-center">
        <div className={`
          w-16 h-16 rounded-full flex items-center justify-center mb-4
          ${hasErrors ? 'qt-bg-warning/10' : 'qt-bg-success/10'}
        `}>
          <span className="text-2xl">
            {hasErrors ? '⚠️' : '✅'}
          </span>
        </div>

        <h3 className="qt-text-primary text-lg font-medium mb-2">
          {hasErrors ? 'Completed with Warnings' : 'Operation Complete'}
        </h3>

        <p className="qt-text-secondary text-sm text-center">
          Successfully updated {totalUpdated} item{totalUpdated !== 1 ? 's' : ''}.
        </p>
      </div>

      {/* Stats */}
      <div className="p-4 rounded-lg qt-bg-muted/50">
        <div className="space-y-2 text-sm">
          {result.messagesUpdated > 0 && (
            <div className="flex justify-between">
              <span className="qt-text-secondary">Messages updated:</span>
              <span className="qt-text-primary font-medium">
                {result.messagesUpdated} in {result.chatsAffected} chat{result.chatsAffected !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {result.memoriesUpdated > 0 && (
            <div className="flex justify-between">
              <span className="qt-text-secondary">Memories updated:</span>
              <span className="qt-text-primary font-medium">
                {result.memoriesUpdated}
              </span>
            </div>
          )}
          <div className="pt-2 border-t qt-border-default">
            <div className="flex justify-between font-medium">
              <span className="qt-text-primary">Total:</span>
              <span className="text-primary">
                {totalUpdated} updated
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Errors */}
      {hasErrors && (
        <div className="p-4 rounded-lg qt-bg-destructive/10 border qt-border-destructive/20">
          <div className="font-medium qt-text-destructive mb-2">
            Warnings ({result.errors.length})
          </div>
          <ul className="text-sm qt-text-destructive/80 space-y-1 list-disc list-inside">
            {result.errors.map((err, index) => (
              <li key={index}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
