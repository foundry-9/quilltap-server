'use client';

import { DebugFiltersProps } from './types';

/**
 * Debug panel filter controls component
 * Allows filtering of debug entries by direction, status, and provider
 */
export function DebugFilters({
  onDirectionChange,
  onStatusChange,
  onProviderChange,
  selectedDirection = 'all',
  selectedStatus = 'all',
  selectedProvider = 'all',
}: DebugFiltersProps) {
  return (
    <div className="qt-debug-filters flex flex-wrap gap-3 p-3 border-t">
      {/* Direction Filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-muted-foreground">Direction:</label>
        <select
          value={selectedDirection}
          onChange={(e) => onDirectionChange?.(e.target.value as any)}
          className="qt-select qt-select-sm text-xs"
        >
          <option value="all">All</option>
          <option value="incoming">Incoming</option>
          <option value="outgoing">Outgoing</option>
        </select>
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-muted-foreground">Status:</label>
        <select
          value={selectedStatus}
          onChange={(e) => onStatusChange?.(e.target.value as any)}
          className="qt-select qt-select-sm text-xs"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="streaming">Streaming</option>
          <option value="complete">Complete</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* Provider Filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-muted-foreground">Provider:</label>
        <select
          value={selectedProvider}
          onChange={(e) => onProviderChange?.(e.target.value)}
          className="qt-select qt-select-sm text-xs"
        >
          <option value="all">All</option>
          <option value="ANTHROPIC">Anthropic</option>
          <option value="OPENAI">OpenAI</option>
          <option value="GROK">Grok</option>
          <option value="GOOGLE">Google</option>
          <option value="OLLAMA">Ollama</option>
          <option value="OPENROUTER">OpenRouter</option>
        </select>
      </div>
    </div>
  );
}
