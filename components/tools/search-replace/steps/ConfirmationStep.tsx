'use client';

/**
 * ConfirmationStep Component
 *
 * Step 3: Review and confirm the search/replace operation.
 */

import type { SearchReplacePreview } from '../types';

interface ConfirmationStepProps {
  searchText: string;
  replaceText: string;
  preview: SearchReplacePreview | null;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}

export function ConfirmationStep({
  searchText,
  replaceText,
  preview,
  confirmed,
  onConfirmedChange,
}: ConfirmationStepProps) {

  const totalMatches = (preview?.messageMatches || 0) + (preview?.memoryMatches || 0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="qt-text-primary text-lg font-medium mb-2">
          Confirm Changes
        </h3>
        <p className="qt-text-secondary text-sm">
          Review the changes before proceeding.
        </p>
      </div>

      {/* Summary */}
      <div className="p-4 rounded-lg border border-border bg-background">
        <div className="space-y-3">
          <div>
            <div className="text-sm qt-text-secondary">Find:</div>
            <div className="font-mono qt-text-primary bg-muted px-2 py-1 rounded mt-1">
              &quot;{searchText}&quot;
            </div>
          </div>
          <div>
            <div className="text-sm qt-text-secondary">Replace with:</div>
            <div className="font-mono qt-text-primary bg-muted px-2 py-1 rounded mt-1">
              {replaceText ? `"${replaceText}"` : <span className="italic text-muted-foreground">(delete)</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {preview && (
        <div className="p-4 rounded-lg bg-muted/50">
          <div className="font-medium qt-text-primary mb-3">Changes to be made:</div>
          <div className="space-y-2 text-sm">
            {preview.messageMatches > 0 && (
              <div className="flex justify-between">
                <span className="qt-text-secondary">Messages to update:</span>
                <span className="qt-text-primary font-medium">
                  {preview.messageMatches} in {preview.affectedChats} chat{preview.affectedChats !== 1 ? 's' : ''}
                </span>
              </div>
            )}
            {preview.memoryMatches > 0 && (
              <div className="flex justify-between">
                <span className="qt-text-secondary">Memories to update:</span>
                <span className="qt-text-primary font-medium">
                  {preview.memoryMatches}
                </span>
              </div>
            )}
            <div className="pt-2 border-t border-border">
              <div className="flex justify-between font-medium">
                <span className="qt-text-primary">Total changes:</span>
                <span className="text-primary">
                  {totalMatches}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Warning */}
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
        <div className="flex gap-3">
          <div className="text-destructive text-xl">⚠️</div>
          <div>
            <div className="font-medium text-destructive mb-1">
              This action cannot be undone
            </div>
            <p className="text-sm text-destructive/80">
              The changes will be applied immediately and permanently.
              Make sure you have reviewed the search and replace text carefully.
            </p>
          </div>
        </div>
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="qt-checkbox mt-1"
        />
        <span className="qt-text-primary">
          I understand that this action cannot be undone and want to proceed with the replacement.
        </span>
      </label>
    </div>
  );
}
