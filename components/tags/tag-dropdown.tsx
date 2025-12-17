'use client';

/**
 * TagDropdown Component
 * A collapsible dropdown that displays tags and allows selection without taking up full width
 */

import { useState, useRef, useEffect } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { Tag } from './tag-editor';
import { TagBadge } from '@/components/tags/tag-badge';

interface TagDropdownProps {
  tags: Tag[];
  isOpen: boolean;
  onToggle: () => void;
  onTagRemove: (tagId: string) => void;
  onTagAdd: (tagName: string) => void;
  loading?: boolean;
}

export function TagDropdown({
  tags,
  isOpen,
  onToggle,
  onTagRemove,
  onTagAdd,
  loading = false,
}: TagDropdownProps) {
  const [inputValue, setInputValue] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useClickOutside(dropdownRef, onToggle, { enabled: isOpen });

  // Focus input when add mode is enabled
  useEffect(() => {
    if (showAddInput) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [showAddInput]);

  const handleAddTag = () => {
    if (inputValue.trim()) {
      onTagAdd(inputValue.trim());
      setInputValue('');
      setShowAddInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Escape') {
      setShowAddInput(false);
      setInputValue('');
    }
  };

  const tagCount = tags.length;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors text-foreground hover:bg-accent bg-muted border border-border"
        aria-label={`${isOpen ? 'Close' : 'Open'} tags dropdown`}
        title={`Tags (${tagCount})`}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded">
          {tagCount}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-64 bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
            {/* Tags List */}
            {tagCount > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Tags ({tagCount})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <TagBadge
                      key={tag.id}
                      tag={tag}
                      onRemove={() => onTagRemove(tag.id)}
                      disabled={loading}
                      size="sm"
                    />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No tags yet
              </p>
            )}

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Add Tag Section */}
            {!showAddInput ? (
              <button
                onClick={() => setShowAddInput(true)}
                disabled={loading}
                className="w-full px-2 py-1.5 text-xs font-medium text-left text-foreground hover:bg-accent rounded transition-colors disabled:opacity-50"
              >
                + Add Tag
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter tag name..."
                  disabled={loading}
                  className="w-full px-2 py-1.5 text-xs border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-foreground disabled:opacity-50"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAddTag}
                    disabled={loading || !inputValue.trim()}
                    className="flex-1 px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowAddInput(false);
                      setInputValue('');
                    }}
                    disabled={loading}
                    className="flex-1 px-2 py-1 text-xs font-medium bg-muted text-foreground rounded hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
