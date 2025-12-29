'use client';

/**
 * SearchInputStep Component
 *
 * Step 2: Enter search and replace text with live preview.
 */

import { useEffect } from 'react';
import { clientLogger } from '@/lib/client-logger';
import type { SearchReplacePreview } from '../types';

interface SearchInputStepProps {
  searchText: string;
  replaceText: string;
  includeMessages: boolean;
  includeMemories: boolean;
  preview: SearchReplacePreview | null;
  loadingPreview: boolean;
  previewError: string | null;
  onSearchTextChange: (text: string) => void;
  onReplaceTextChange: (text: string) => void;
  onIncludeMessagesChange: (include: boolean) => void;
  onIncludeMemoriesChange: (include: boolean) => void;
}

export function SearchInputStep({
  searchText,
  replaceText,
  includeMessages,
  includeMemories,
  preview,
  loadingPreview,
  previewError,
  onSearchTextChange,
  onReplaceTextChange,
  onIncludeMessagesChange,
  onIncludeMemoriesChange,
}: SearchInputStepProps) {
  useEffect(() => {
    clientLogger.debug('[SearchInputStep] Rendered', {
      searchTextLength: searchText.length,
      hasPreview: !!preview,
    });
  }, []);

  const totalMatches = (preview?.messageMatches || 0) + (preview?.memoryMatches || 0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="qt-text-primary text-lg font-medium mb-2">
          Search & Replace
        </h3>
        <p className="qt-text-secondary text-sm">
          Enter the text you want to find and what to replace it with.
        </p>
      </div>

      {/* Search input */}
      <div>
        <label className="qt-label block mb-2">
          Find
        </label>
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          placeholder="Text to search for..."
          className="qt-input w-full"
          autoFocus
        />
      </div>

      {/* Replace input */}
      <div>
        <label className="qt-label block mb-2">
          Replace with
        </label>
        <input
          type="text"
          value={replaceText}
          onChange={(e) => onReplaceTextChange(e.target.value)}
          placeholder="Replacement text (leave empty to delete)"
          className="qt-input w-full"
        />
      </div>

      {/* Options */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeMessages}
            onChange={(e) => onIncludeMessagesChange(e.target.checked)}
            className="qt-checkbox"
          />
          <span className="qt-text-primary">Include chat messages</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeMemories}
            onChange={(e) => onIncludeMemoriesChange(e.target.checked)}
            className="qt-checkbox"
          />
          <span className="qt-text-primary">Include memories</span>
        </label>
      </div>

      {/* Preview */}
      <div className="p-4 rounded-lg bg-muted/50">
        <div className="font-medium qt-text-primary mb-2">Preview</div>

        {!searchText.trim() ? (
          <p className="text-sm qt-text-secondary">
            Enter search text to see matches
          </p>
        ) : loadingPreview ? (
          <p className="text-sm qt-text-secondary">
            Searching...
          </p>
        ) : previewError ? (
          <p className="text-sm text-destructive">
            {previewError}
          </p>
        ) : preview ? (
          <div className="space-y-2 text-sm">
            {totalMatches === 0 ? (
              <p className="qt-text-secondary">
                No matches found
              </p>
            ) : (
              <>
                {includeMessages && (
                  <div className="flex justify-between">
                    <span className="qt-text-secondary">Messages:</span>
                    <span className="qt-text-primary font-medium">
                      {preview.messageMatches} matches in {preview.affectedChats} chat{preview.affectedChats !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
                {includeMemories && (
                  <div className="flex justify-between">
                    <span className="qt-text-secondary">Memories:</span>
                    <span className="qt-text-primary font-medium">
                      {preview.memoryMatches} match{preview.memoryMatches !== 1 ? 'es' : ''}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-border">
                  <div className="flex justify-between font-medium">
                    <span className="qt-text-primary">Total:</span>
                    <span className="text-primary">
                      {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
