'use client';

import { formatData, DebugEntry } from '@/components/providers/debug-provider';
import { DebugEntryCardProps } from './types';
import { ChevronIcon, ProviderIcon } from './icons';
import { CopyButton, SyntaxHighlightedJSON } from './utilities';

/**
 * Individual debug entry card component
 * Displays comprehensive information about a single API request/response
 * Includes LLM details, tools, memory logs, and raw data
 */
export function DebugEntryRow({ entry }: DebugEntryCardProps) {
  const isOutgoing = entry.direction === 'outgoing';
  const formattedData = formatData(entry.data, entry.contentType);
  const hasStitchedContent = entry.stitchedContent !== undefined && entry.stitchedContent.length > 0;

  const statusClass = {
    pending: 'qt-debug-status-pending',
    streaming: 'qt-debug-status-streaming',
    complete: 'qt-debug-status-complete',
    error: 'qt-debug-status-error',
  }[entry.status];

  return (
    <div className={`qt-debug-entry ${isOutgoing ? 'qt-debug-entry-outgoing' : 'qt-debug-entry-incoming'}`}>
      {/* Header */}
      <div className="qt-debug-entry-header">
        <div className="flex items-center gap-2">
          <span className={`qt-debug-status ${statusClass}`} title={entry.status} />
          <span className={`qt-debug-direction ${isOutgoing ? 'qt-debug-direction-out' : 'qt-debug-direction-in'}`}>
            {isOutgoing ? '→ OUT' : '← IN'}
          </span>
          {/* Provider badge with icon */}
          <span
            className="qt-debug-provider"
            title={`Provider: ${entry.providerType || 'Unknown'}${entry.model ? `\nModel: ${entry.model}` : ''}`}
          >
            <ProviderIcon type={entry.providerType} className="qt-debug-provider-icon" />
            {entry.provider}
          </span>
          {entry.model && (
            <span className="qt-debug-model" title={entry.model}>
              {entry.model}
            </span>
          )}
        </div>
        <span className="qt-text-xs">
          {entry.timestamp.toLocaleTimeString()}
        </span>
      </div>

      {/* LLM Request Details (shown for incoming responses with debug info) */}
      {entry.llmRequestDetails && (
        <details className="qt-debug-section qt-debug-section-cyan">
          <summary>
            <ChevronIcon />
            <span className="qt-debug-section-title">LLM Request Details</span>
            {entry.llmRequestDetails.hasTools && (
              <span className="qt-debug-badge qt-debug-badge-purple ml-2">
                Has Tools
              </span>
            )}
            <span className="qt-debug-section-meta qt-text-xs">
              {entry.llmRequestDetails.messageCount} messages
            </span>
            <div className="qt-debug-copy-container">
              <CopyButton content={JSON.stringify(entry.llmRequestDetails, null, 2)} />
            </div>
          </summary>
          <div className="qt-debug-section-content">
            {/* Request parameters */}
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="qt-debug-badge">
                temp: {entry.llmRequestDetails.temperature ?? 'default'}
              </span>
              <span className="qt-debug-badge">
                maxTokens: {entry.llmRequestDetails.maxTokens ?? 'default'}
              </span>
              {entry.llmRequestDetails.topP !== undefined && (
                <span className="qt-debug-badge">
                  topP: {entry.llmRequestDetails.topP}
                </span>
              )}
            </div>
            {/* Message summary */}
            {entry.llmRequestDetails.messages && (
              <div className="mb-2">
                <div className="qt-text-xs font-semibold mb-1">Messages:</div>
                <div className="flex flex-wrap gap-1">
                  {entry.llmRequestDetails.messages.map((msg, idx) => (
                    <span
                      key={idx}
                      className={`qt-debug-badge ${
                        msg.role === 'system' ? 'qt-debug-role-system' :
                        msg.role === 'user' ? 'qt-debug-role-user' :
                        'qt-debug-role-assistant'
                      }`}
                    >
                      {msg.role} ({msg.contentLength} chars){msg.hasAttachments ? ' +files' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Context Management Info */}
            {entry.llmRequestDetails.contextManagement && (
              <ContextManagementSection contextMgmt={entry.llmRequestDetails.contextManagement} />
            )}

            {/* Tools */}
            {entry.llmRequestDetails.tools && entry.llmRequestDetails.tools.length > 0 && (
              <div className="group/tools">
                <div className="flex items-center justify-between mb-1">
                  <div className="qt-text-xs font-semibold">Tools:</div>
                  <div className="qt-debug-copy-container">
                    <CopyButton content={JSON.stringify(entry.llmRequestDetails.tools, null, 2)} />
                  </div>
                </div>
                <div className="qt-debug-code">
                  <SyntaxHighlightedJSON content={JSON.stringify(entry.llmRequestDetails.tools, null, 2)} />
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {/* Tool Invocations and Results */}
      {entry.toolResults && entry.toolResults.length > 0 && (
        <div className="qt-debug-section-content qt-debug-tool-results-bg">
          <div className="text-xs font-semibold mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
            </svg>
            Tool Executions ({entry.toolResults.length})
          </div>
          <div className="space-y-2">
            {entry.toolResults.map((tool, idx) => (
              <details
                key={`tool-${idx}`}
                className="qt-debug-section qt-debug-section-purple"
              >
                <summary>
                  <ChevronIcon />
                  <span className="font-mono text-xs font-semibold">
                    {tool.name}
                  </span>
                  <span className={`qt-debug-badge ${tool.success ? 'qt-debug-tool-success' : 'qt-debug-tool-failed'}`}>
                    {tool.success ? '✓ Success' : '✗ Failed'}
                  </span>
                  <div className="qt-debug-copy-container ml-auto">
                    <CopyButton content={JSON.stringify(tool, null, 2)} />
                  </div>
                </summary>
                <div className="qt-debug-section-content">
                  <div className="qt-debug-code qt-debug-code-lg">
                    <SyntaxHighlightedJSON content={JSON.stringify(tool.result, null, 2)} />
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Memory Extraction Debug Logs - shown regardless of LLM Request Details */}
      {entry.debugMemoryLogs && entry.debugMemoryLogs.length > 0 && (
        <div className="qt-debug-section-content qt-debug-memory-section-bg">
          <div className="text-xs font-semibold mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000-2H6a6 6 0 016 6v3h2a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6a2 2 0 012-2h2V7a1 1 0 000 2H4z" clipRule="evenodd" />
            </svg>
            🧠 Memory Extraction ({entry.debugMemoryLogs.length})
          </div>
          <div className="space-y-2">
            {entry.debugMemoryLogs.map((log) => (
              <div key={`log-${log.substring(0, 50)}`} className="qt-debug-memory-log">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final Event JSON (shown by default for completed streaming responses) */}
      {entry.finalEvent && (
        <div className="qt-debug-section-content qt-debug-final-response-bg">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold">
              Final Response
            </span>
            <span className="ml-auto" />
            {entry.finalMetadata?.usage && (
              <span className="qt-debug-section-meta text-xs">
                {entry.finalMetadata.usage.totalTokens} tokens
              </span>
            )}
            <div className="qt-debug-copy-container">
              <CopyButton content={JSON.stringify(entry.finalEvent, null, 2)} />
            </div>
          </div>
          <div className="qt-debug-code">
            <SyntaxHighlightedJSON content={JSON.stringify(entry.finalEvent, null, 2)} />
          </div>
        </div>
      )}

      {/* Stitched Content (collapsible, for completed streaming responses) */}
      {hasStitchedContent && (
        <details className="qt-debug-section qt-debug-section-emerald">
          <summary>
            <ChevronIcon />
            <span className="qt-debug-section-title">Stitched Response Content</span>
            <span className="qt-debug-section-meta qt-text-xs">
              {entry.stitchedContent?.length || 0} chars
            </span>
            <div className="qt-debug-copy-container">
              <CopyButton content={entry.stitchedContent || ''} />
            </div>
          </summary>
          <div className="qt-debug-section-content">
            <div className="qt-debug-code qt-debug-code-lg font-mono text-sm text-foreground whitespace-pre-wrap break-words">
              {entry.stitchedContent}
            </div>
            {/* Metadata badges */}
            {entry.finalMetadata && (
              <div className="flex flex-wrap gap-2 mt-2">
                {entry.finalMetadata.messageId && (
                  <span className="qt-debug-badge">
                    ID: {entry.finalMetadata.messageId.slice(0, 8)}...
                  </span>
                )}
                {entry.finalMetadata.toolsDetected && (
                  <span className="qt-debug-badge qt-debug-badge-purple">
                    {entry.finalMetadata.toolsDetected} tool(s) detected
                  </span>
                )}
                {entry.finalMetadata.toolsExecuted && (
                  <span className="qt-debug-badge qt-debug-badge-orange">
                    Tools executed
                  </span>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {/* Raw Data (collapsible) */}
      <details className="qt-debug-section qt-debug-section-muted">
        <summary>
          <ChevronIcon />
          {isOutgoing ? 'Show request payload' : hasStitchedContent ? 'Show raw SSE data' : 'Show response data'}
          <div className="qt-debug-copy-container ml-auto">
            {!entry.error && (
              <CopyButton content={formattedData} />
            )}
          </div>
        </summary>
        <div className="qt-debug-section-content qt-debug-code qt-debug-code-xl">
          {entry.error ? (
            <div className="text-red-600 dark:text-red-400">
              <strong>Error:</strong> {entry.error}
            </div>
          ) : (
            <SyntaxHighlightedJSON content={formattedData} />
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * Context Management Section component
 * Displays token usage, memories, summaries, and system prompts
 */
function ContextManagementSection({ contextMgmt }: { contextMgmt: any }) {
  return (
    <div className="mb-2 p-2 rounded border qt-debug-nested qt-debug-nested-violet">
      <div className="text-xs font-semibold mb-2 flex items-center gap-1">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"/>
        </svg>
        Context Management
      </div>
      {/* Token usage breakdown */}
      <div className="grid grid-cols-2 gap-1 text-xs mb-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">System Prompt:</span>
          <span className="font-mono">
            {contextMgmt.tokenUsage.systemPrompt.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Memories:</span>
          <span className="font-mono">
            {contextMgmt.tokenUsage.memories.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Summary:</span>
          <span className="font-mono">
            {contextMgmt.tokenUsage.summary.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Messages:</span>
          <span className="font-mono">
            {contextMgmt.tokenUsage.recentMessages.toLocaleString()}
          </span>
        </div>
      </div>
      {/* Total usage bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">
            Total: {contextMgmt.tokenUsage.total.toLocaleString()} / {contextMgmt.budget.total.toLocaleString()}
          </span>
          <span className="font-semibold">
            {Math.round((contextMgmt.tokenUsage.total / contextMgmt.budget.total) * 100)}%
          </span>
        </div>
        <div className="qt-debug-progress">
          <div
            className="qt-debug-progress-bar"
            style={{
              width: `${Math.min(100, (contextMgmt.tokenUsage.total / contextMgmt.budget.total) * 100)}%`
            }}
          />
        </div>
      </div>
      {/* Status badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className="qt-debug-badge qt-debug-badge-violet">
          {contextMgmt.memoriesIncluded} memories
        </span>
        <span className="qt-debug-badge qt-debug-badge-violet">
          {contextMgmt.messagesIncluded} messages
        </span>
        {contextMgmt.includedSummary && (
          <span className="qt-debug-badge qt-debug-badge-green">
            Has Summary
          </span>
        )}
        {contextMgmt.messagesTruncated && (
          <span className="qt-debug-badge qt-debug-badge-amber">
            Truncated
          </span>
        )}
      </div>

      {/* Expandable: View Memories */}
      {contextMgmt.debugMemories && contextMgmt.debugMemories.length > 0 && (
        <details className="qt-debug-section qt-debug-section-violet mb-2">
          <summary>
            <ChevronIcon />
            View Memories ({contextMgmt.debugMemories.length})
          </summary>
          <div className="qt-debug-nested qt-debug-nested-violet">
            {contextMgmt.debugMemories.map((mem: any, idx: number) => (
              <div key={idx} className="text-xs mb-2 last:mb-0 pb-2 last:pb-0 border-b last:border-b-0 border-violet-200 dark:border-violet-700">
                <div className="text-foreground">{mem.summary}</div>
                <div className="flex gap-2 mt-1 opacity-75">
                  <span>Score: {(mem.score * 100).toFixed(0)}%</span>
                  <span>Importance: {(mem.importance * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Expandable: View Summary */}
      {contextMgmt.debugSummary && (
        <details className="qt-debug-section qt-debug-section-emerald mb-2">
          <summary>
            <ChevronIcon />
            View Conversation Summary
          </summary>
          <div className="qt-debug-nested qt-debug-nested-green">
            <div className="text-xs text-foreground whitespace-pre-wrap">
              {contextMgmt.debugSummary}
            </div>
          </div>
        </details>
      )}

      {/* Expandable: View System Prompt */}
      {contextMgmt.debugSystemPrompt && (
        <details className="qt-debug-section qt-debug-section-amber">
          <summary>
            <ChevronIcon />
            View System Prompt ({contextMgmt.tokenUsage.systemPrompt.toLocaleString()} tokens)
          </summary>
          <div className="qt-debug-nested qt-debug-nested-yellow qt-debug-code-lg">
            <div className="text-xs text-foreground whitespace-pre-wrap font-mono">
              {contextMgmt.debugSystemPrompt}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
