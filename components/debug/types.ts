// Debug-related TypeScript types and interfaces
import { DebugEntry, LLMProviderType } from '@/components/providers/debug-provider';

export type { DebugEntry, LLMProviderType };

// UI component prop types
export interface ChevronIconProps {
  className?: string;
}

export interface CopyButtonProps {
  content: string;
}

export interface ProviderIconProps {
  type?: LLMProviderType;
  className?: string;
}

export interface SyntaxHighlightedJSONProps {
  content: string;
}

export interface DebugEntryCardProps {
  entry: DebugEntry;
}

export interface DebugPanelProps {
  maxHeight?: string;
  showLegend?: boolean;
}

// Status and direction types
export type DebugStatus = 'pending' | 'streaming' | 'complete' | 'error';
export type DebugDirection = 'incoming' | 'outgoing';

// Tool-related types
export interface ToolResult {
  name: string;
  success: boolean;
  result: unknown;
}

// Memory-related types
export interface MemoryDebugInfo {
  summary: string;
  score: number;
  importance: number;
}

// Context management types
export interface ContextManagement {
  tokenUsage: {
    systemPrompt: number;
    memories: number;
    summary: number;
    recentMessages: number;
    total: number;
  };
  budget: {
    total: number;
  };
  memoriesIncluded: number;
  messagesIncluded: number;
  includedSummary: boolean;
  messagesTruncated: boolean;
  debugMemories?: MemoryDebugInfo[];
  debugSummary?: string;
  debugSystemPrompt?: string;
}

// LLM Request Details
export interface LLMRequestDetails {
  hasTools: boolean;
  messageCount: number;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  messages?: Array<{
    role: string;
    contentLength: number;
    hasAttachments?: boolean;
  }>;
  contextManagement?: ContextManagement;
  tools?: unknown[];
}

// Final metadata
export interface FinalMetadata {
  messageId?: string;
  usage?: {
    totalTokens: number;
  };
  toolsDetected?: number;
  toolsExecuted?: boolean;
}
