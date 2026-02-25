'use client'

import { useState, useCallback, useMemo } from 'react'
import { formatMessageTime } from '@/lib/format-time'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'

interface ToolMessageProps {
  readonly message: {
    id: string
    content: string
    createdAt: string
    attachments?: Array<{
      id: string
      filename: string
      filepath: string
      mimeType: string
    }>
  }
  readonly character?: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
  }
  readonly onImageClick?: (filepath: string, filename: string, fileId: string) => void
  readonly onAttachmentDeleted?: (attachmentId: string) => void
  /** Whether this tool message is embedded inside an assistant message */
  readonly embedded?: boolean
}

interface ToolResult {
  tool?: string
  toolName?: string
  initiatedBy?: 'user' | 'character'
  success?: boolean
  /** Result can be a string or object (for backwards compatibility with older RNG results) */
  result?: string | Record<string, unknown>
  arguments?: Record<string, unknown>
  provider?: string
  model?: string
  prompt?: string
  images?: Array<{ id: string; filename: string }>
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Copy image to clipboard from URL
 */
async function copyImageToClipboard(imageUrl: string): Promise<boolean> {
  try {
    const response = await fetch(imageUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ])
    return true
  } catch {
    return false
  }
}

/**
 * Get preview text from content (first line, truncated)
 */
function getPreviewText(content: string, maxLength: number = 80): string {
  const firstLine = content.split('\n')[0] || ''
  if (firstLine.length <= maxLength) return firstLine
  return firstLine.slice(0, maxLength) + '...'
}

/**
 * Format tool arguments/prompt for display
 */
function formatRequestContent(toolData: ToolResult): string {
  if (toolData.prompt) {
    return toolData.prompt
  }
  return JSON.stringify(toolData.arguments || {}, null, 2)
}

/**
 * Format tool result for display
 */
function formatResultContent(toolData: ToolResult): string {
  if (!toolData.result) return ''

  // Handle result as string or object (backwards compatibility)
  const resultString = typeof toolData.result === 'object'
    ? (toolData.result as Record<string, unknown>).formattedText as string
      || JSON.stringify(toolData.result, null, 2)
    : toolData.result

  // Try to pretty-print as JSON
  try {
    const parsed = JSON.parse(resultString)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return resultString
  }
}

export default function ToolMessage({ message, character, onImageClick, onAttachmentDeleted, embedded = false }: ToolMessageProps) {
  const [showRequest, setShowRequest] = useState(false)
  const [showResponse, setShowResponse] = useState(false)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  const toolData: ToolResult = useMemo(() => {
    try {
      const parsed = JSON.parse(message.content)
      // Handle both old format (toolName) and new format (tool)
      return {
        ...parsed,
        toolName: parsed.toolName || parsed.tool || 'unknown',
      }
    } catch {
      // If parsing fails, use defaults
      return {
        toolName: 'unknown',
        success: false,
        result: 'Unable to parse tool result',
      }
    }
  }, [message.content])

  // Determine if character initiated this or user did
  const showCharacterName = toolData.initiatedBy !== 'user' && character

  // Get image attachments
  const imageAttachments = (message.attachments || []).filter((a) =>
    a.mimeType.startsWith('image/')
  )

  // Map tool names to display names and icons
  const toolInfo: Record<string, { displayName: string; icon: string; bgColor: string }> = {
    generate_image: {
      displayName: 'Image Generation',
      icon: '🎨',
      bgColor: 'bg-muted border border-border',
    },
    search_memories: {
      displayName: 'Memory Search',
      icon: '🧠',
      bgColor: 'bg-muted border border-border',
    },
    search_web: {
      displayName: 'Web Search',
      icon: '🔍',
      bgColor: 'bg-muted border border-border',
    },
    project_info: {
      displayName: 'Project Info',
      icon: '📋',
      bgColor: 'bg-muted border border-border',
    },
    file_management: {
      displayName: 'File Management',
      icon: '📁',
      bgColor: 'bg-muted border border-border',
    },
    rng: {
      displayName: 'Random Number Generator',
      icon: '🎲',
      bgColor: 'bg-muted border border-border',
    },
    state: {
      displayName: 'State Manager',
      icon: '🗃️',
      bgColor: 'bg-muted border border-border',
    },
    search_help: {
      displayName: 'Help Search',
      icon: '📖',
      bgColor: 'bg-muted border border-border',
    },
  }

  const info = toolInfo[toolData.toolName!] || {
    displayName: toolData.toolName,
    icon: '⚙️',
    bgColor: 'bg-muted border border-border',
  }

  // Copy handlers
  const handleCopyRequest = useCallback(async () => {
    const content = formatRequestContent(toolData)
    const success = await copyToClipboard(content)
    if (success) {
      showSuccessToast('Request copied to clipboard')
    } else {
      showErrorToast('Failed to copy to clipboard')
    }
  }, [toolData])

  const handleCopyResponse = useCallback(async () => {
    const content = formatResultContent(toolData)
    const success = await copyToClipboard(content)
    if (success) {
      showSuccessToast('Response copied to clipboard')
    } else {
      showErrorToast('Failed to copy to clipboard')
    }
  }, [toolData])

  const handleCopyImage = useCallback(async (filepath: string) => {
    const imageUrl = filepath.startsWith('/') ? filepath : `/${filepath}`
    const success = await copyImageToClipboard(imageUrl)
    if (success) {
      showSuccessToast('Image copied to clipboard')
    } else {
      showErrorToast('Failed to copy image')
    }
  }, [])

  // Get preview text for collapsed sections
  const requestPreview = getPreviewText(formatRequestContent(toolData))
  const responsePreview = getPreviewText(formatResultContent(toolData))

  // Embedded layout - more compact, no avatar
  if (embedded) {
    return (
      <div className="qt-chat-tool-embedded rounded-lg border border-border bg-muted/50 overflow-hidden">
        {/* Tool header - compact */}
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
          <span className="text-base">{info.icon}</span>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {showCharacterName && (
              <span className="qt-text-label-xs truncate">
                {character?.name} requested
              </span>
            )}
            {toolData.initiatedBy === 'user' && (
              <span className="qt-text-label-xs">
                You requested
              </span>
            )}
            <span className="font-medium text-sm text-foreground">
              {info.displayName}
            </span>
          </div>
          <span
            className={`inline-block px-2 py-0.5 qt-text-label-xs rounded ${
              toolData.success
                ? 'qt-badge-success'
                : 'qt-badge-destructive'
            }`}
          >
            {toolData.success ? 'Success' : 'Failed'}
          </span>
          {toolData.provider && toolData.model && (
            <span className="qt-text-label-xs text-muted-foreground hidden sm:inline">
              {toolData.provider} {toolData.model}
            </span>
          )}
        </div>

        <div className="px-3 py-2 space-y-2">
          {/* Tool Request collapsible */}
          {(toolData.arguments || toolData.prompt) && (
            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRequest(!showRequest)}
                  className="qt-text-label-xs hover:text-foreground transition-colors flex items-center gap-1"
                  type="button"
                >
                  <span className="w-3 inline-block">{showRequest ? '▼' : '▶'}</span>
                  <span>Request</span>
                </button>
                {!showRequest && (
                  <span className="qt-text-xs text-muted-foreground truncate flex-1">
                    {requestPreview}
                  </span>
                )}
                <button
                  onClick={handleCopyRequest}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy request"
                  type="button"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              {showRequest && (
                <div className="mt-2 bg-background rounded p-2 border border-border">
                  <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                    {formatRequestContent(toolData)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Tool Response collapsible */}
          {(toolData.result || (toolData.toolName === 'generate_image' && imageAttachments.length > 0)) && (
            <div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowResponse(!showResponse)}
                  className="qt-text-label-xs hover:text-foreground transition-colors flex items-center gap-1"
                  type="button"
                >
                  <span className="w-3 inline-block">{showResponse ? '▼' : '▶'}</span>
                  <span>Response</span>
                </button>
                {!showResponse && toolData.result && (
                  <span className="qt-text-xs text-muted-foreground truncate flex-1">
                    {responsePreview}
                  </span>
                )}
                {!showResponse && toolData.toolName === 'generate_image' && imageAttachments.length > 0 && (
                  <span className="qt-text-xs text-muted-foreground">
                    {imageAttachments.length} image{imageAttachments.length > 1 ? 's' : ''}
                  </span>
                )}
                {toolData.result && (
                  <button
                    onClick={handleCopyResponse}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy response"
                    type="button"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                )}
              </div>
              {showResponse && (
                <div className="mt-2 bg-background rounded p-2 border border-border">
                  {/* Image thumbnails for generate_image */}
                  {toolData.toolName === 'generate_image' && imageAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {imageAttachments.map((attachment) => (
                        <div key={attachment.id} className="relative group/thumb">
                          {missingImages.has(attachment.id) ? (
                            <div className="w-16 h-16 flex items-center justify-center bg-muted rounded">
                              <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          ) : (
                            <div className="relative">
                              <button
                                onClick={() => {
                                  const normalizedPath = attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`
                                  onImageClick?.(normalizedPath, attachment.filename, attachment.id)
                                }}
                                className="block rounded overflow-hidden border border-border hover:border-primary/50 transition-colors"
                                type="button"
                              >
                                <img
                                  src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                                  alt={attachment.filename}
                                  className="w-16 h-16 object-cover"
                                  onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                                />
                              </button>
                              <button
                                onClick={() => handleCopyImage(attachment.filepath)}
                                className="absolute -top-1 -right-1 p-1 bg-background border border-border rounded qt-shadow-sm opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                title="Copy image"
                                type="button"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Text result */}
                  {toolData.result && (
                    <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                      {formatResultContent(toolData)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Standalone layout - full width with avatar
  return (
    <div className="qt-chat-message-row-tool">
      {/* Tool icon avatar with tooltip */}
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-muted text-lg relative group cursor-help">

        {info.icon}
        {toolData.provider && toolData.model && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50">
            <div className="bg-foreground text-background text-xs px-2 py-1 rounded whitespace-nowrap">
              {toolData.provider} {toolData.model}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground"></div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 group relative">
        <div className={`px-4 py-3 rounded-lg ${info.bgColor}`}>
          {/* Tool header */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {showCharacterName && (
                  <span className="qt-text-label-xs">
                    {character?.name} requested
                  </span>
                )}
                {toolData.initiatedBy === 'user' && (
                  <span className="qt-text-label-xs">
                    You requested
                  </span>
                )}
                <span className="font-semibold text-sm text-foreground">
                  {info.displayName}
                </span>
              </div>
            </div>
            <span
              className={`inline-block px-2 py-0.5 qt-text-label-xs rounded ml-auto ${
                toolData.success
                  ? 'qt-badge-success'
                  : 'qt-badge-destructive'
              }`}
            >
              {toolData.success ? 'Success' : 'Failed'}
            </span>
          </div>

          {/* Tool Request collapsible - shows arguments/prompt sent to the tool */}
          {(toolData.arguments || toolData.prompt) && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRequest(!showRequest)}
                  className="qt-text-label-xs hover:text-foreground transition-colors flex items-center gap-1"
                  type="button"
                >
                  <span className="w-3 inline-block">{showRequest ? '▼' : '▶'}</span>
                  <span>Tool Request</span>
                </button>
                {!showRequest && (
                  <span className="qt-text-xs text-muted-foreground truncate flex-1">
                    {requestPreview}
                  </span>
                )}
                <button
                  onClick={handleCopyRequest}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy request"
                  type="button"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              {showRequest && (
                <div className="mt-2 bg-background rounded p-3 border border-border">
                  <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                    {formatRequestContent(toolData)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Tool Response collapsible - shows the result with pretty-printed JSON */}
          {/* For image generation, also include the image attachments inside this collapsible */}
          {(toolData.result || (toolData.toolName === 'generate_image' && imageAttachments.length > 0)) && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowResponse(!showResponse)}
                  className="qt-text-label-xs hover:text-foreground transition-colors flex items-center gap-1"
                  type="button"
                >
                  <span className="w-3 inline-block">{showResponse ? '▼' : '▶'}</span>
                  <span>Tool Response</span>
                </button>
                {!showResponse && toolData.result && (
                  <span className="qt-text-xs text-muted-foreground truncate flex-1">
                    {responsePreview}
                  </span>
                )}
                {!showResponse && toolData.toolName === 'generate_image' && imageAttachments.length > 0 && !toolData.result && (
                  <span className="qt-text-xs text-muted-foreground">
                    {imageAttachments.length} image{imageAttachments.length > 1 ? 's' : ''}
                  </span>
                )}
                {toolData.result && (
                  <button
                    onClick={handleCopyResponse}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy response"
                    type="button"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                )}
              </div>
              {showResponse && (
                <div className="mt-2 bg-background rounded p-3 border border-border tool-response-content">
                  {/* For image generation, show image thumbnails */}
                  {toolData.toolName === 'generate_image' && imageAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {imageAttachments.map((attachment) => (
                        <div key={attachment.id} className="relative group/thumb overflow-hidden rounded border border-border hover:border-primary/50 transition-colors">
                          {missingImages.has(attachment.id) ? (
                            <div className="w-20 h-20 flex items-center justify-center bg-muted">
                              <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1.5}
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                            </div>
                          ) : (
                            <div className="relative">
                              <button
                                onClick={() => {
                                  const normalizedPath = attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`
                                  onImageClick?.(normalizedPath, attachment.filename, attachment.id)
                                }}
                                className="relative group/thumb overflow-hidden rounded cursor-pointer block"
                                type="button"
                              >
                                <div className="relative w-20 h-20 bg-muted">
                                  <img
                                    src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                                    alt={attachment.filename}
                                    className="w-full h-full object-cover"
                                    onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                                  />
                                </div>
                                <div className="absolute inset-0 qt-bg-overlay-none group-hover/thumb:qt-bg-overlay-light transition-colors flex items-center justify-center">
                                  <svg className="w-6 h-6 qt-text-overlay opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                  </svg>
                                </div>
                              </button>
                              <button
                                onClick={() => handleCopyImage(attachment.filepath)}
                                className="absolute -top-1 -right-1 p-1 bg-background border border-border rounded qt-shadow-sm opacity-0 group-hover/thumb:opacity-100 transition-opacity z-10"
                                title="Copy image"
                                type="button"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Show JSON/text result if present */}
                  {toolData.result && (
                    <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                      {formatResultContent(toolData)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Image attachments for non-image-generation tools */}
          {toolData.toolName !== 'generate_image' && imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {imageAttachments.map((attachment) => (
                <div key={attachment.id} className="relative group/thumb overflow-hidden rounded border border-border hover:border-primary/50 transition-colors">
                  {missingImages.has(attachment.id) ? (
                    <div className="w-20 h-20 flex items-center justify-center bg-muted">
                      <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        // Normalize filepath - some files have leading slash, some don't
                        const normalizedPath = attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`
                        onImageClick?.(normalizedPath, attachment.filename, attachment.id)
                      }}
                      className="relative group/thumb overflow-hidden rounded cursor-pointer block"
                      type="button"
                    >
                      <div className="relative w-20 h-20 bg-muted">
                        {missingImages.has(attachment.id) ? (
                          <DeletedImagePlaceholder
                            imageId={attachment.id}
                            filename={attachment.filename}
                            onCleanup={async () => {
                              try {
                                const response = await fetch(`/api/v1/chat-files/${attachment.id}`, {
                                  method: 'DELETE',
                                })

                                if (!response.ok) {
                                  const data = await response.json()
                                  throw new Error(data.error || 'Failed to delete attachment')
                                }

                                // Remove from missing images set
                                setMissingImages((prev) => {
                                  const next = new Set(prev)
                                  next.delete(attachment.id)
                                  return next
                                })

                                // Notify parent component
                                onAttachmentDeleted?.(attachment.id)
                              } catch (error) {
                                showErrorToast(
                                  error instanceof Error ? error.message : 'Failed to delete attachment'
                                )
                              }
                            }}
                            className="w-full h-full absolute inset-0 !p-2"
                          />
                        ) : (

                          <img
                            src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                            alt={attachment.filename}
                            className="w-full h-full object-cover"
                            onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                          />
                        )}
                      </div>
                      <div className="absolute inset-0 qt-bg-overlay-none group-hover/thumb:qt-bg-overlay-light transition-colors flex items-center justify-center">
                        <svg className="w-6 h-6 qt-text-overlay opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                        </svg>
                      </div>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Timestamp */}
          <div className="qt-text-xs mt-2">
            {formatMessageTime(message.createdAt)}
          </div>
        </div>
      </div>
    </div>
  )
}
