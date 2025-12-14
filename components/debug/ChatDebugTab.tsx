"use client";

import { useDebugOptional } from '@/components/providers/debug-provider';
import DebugPanel from './DebugPanel';

/**
 * Chat Debug Tab - wraps the existing DebugPanel component
 * Shows API traffic for LLM calls when in a chat conversation
 * Debug mode is automatically enabled when DevConsole is open (handled by DebugModeSync)
 */
export default function ChatDebugTab() {
  const debug = useDebugOptional();

  if (!debug) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 p-4">
        <svg
          className="w-12 h-12 mb-3 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-sm text-center">Debug provider not available</p>
        <p className="text-xs mt-1 text-center">
          Navigate to a chat conversation to use Chat Debug
        </p>
      </div>
    );
  }

  return <DebugPanel />;
}
