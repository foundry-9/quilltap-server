'use client'

import { useState } from 'react'
import { formatMessageTime } from '@/lib/format-time'
import { showErrorToast } from '@/lib/toast'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'
import ReactMarkdown from 'react-markdown'

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

export default function ToolMessage({ message, character, onImageClick, onAttachmentDeleted }: ToolMessageProps) {
  const [showRequest, setShowRequest] = useState(false)
  const [showResponse, setShowResponse] = useState(false)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  let toolData: ToolResult = {
    toolName: 'unknown',
    success: false,
    result: 'Unable to parse tool result',
  }

  try {
    const parsed = JSON.parse(message.content)
    // Handle both old format (toolName) and new format (tool)
    toolData = {
      ...parsed,
      toolName: parsed.toolName || parsed.tool || 'unknown',
    }
  } catch {
    // If parsing fails, use defaults
  }

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
  }

  const info = toolInfo[toolData.toolName!] || {
    displayName: toolData.toolName,
    icon: '⚙️',
    bgColor: 'bg-muted border border-border',
  }

  return (
    <div className={`flex gap-4 w-[90%] justify-start`}>
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
              <button
                onClick={() => setShowRequest(!showRequest)}
                className="qt-text-label-xs hover:text-foreground transition-colors"
                type="button"
              >
                {showRequest ? '▼' : '▶'} Tool Request
              </button>
              {showRequest && (
                <div className="mt-2 bg-background rounded p-3 overflow-x-auto border border-border">
                  <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                    {/* Show prompt if available (image generation, RNG, etc.), otherwise show arguments */}
                    {toolData.prompt
                      ? toolData.prompt
                      : JSON.stringify(toolData.arguments || {}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Tool Response collapsible - shows the result with pretty-printed JSON */}
          {/* For image generation, also include the image attachments inside this collapsible */}
          {(toolData.result || (toolData.toolName === 'generate_image' && imageAttachments.length > 0)) && (
            <div className="mt-2">
              <button
                onClick={() => setShowResponse(!showResponse)}
                className="qt-text-label-xs hover:text-foreground transition-colors"
                type="button"
              >
                {showResponse ? '▼' : '▶'} Tool Response
              </button>
              {showResponse && (
                <div className="mt-2 bg-background rounded p-3 overflow-x-auto border border-border tool-response-content">
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
                            <button
                              onClick={() => {
                                const normalizedPath = attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`
                                onImageClick?.(normalizedPath, attachment.filename, attachment.id)
                              }}
                              className="relative group/thumb overflow-hidden rounded cursor-pointer block"
                              type="button"
                            >
                              <div className="relative w-20 h-20 bg-muted">
                                { }
                                <img
                                  src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                                  alt={attachment.filename}
                                  className="w-full h-full object-cover"
                                  onError={() => setMissingImages((prev) => new Set(prev).add(attachment.id))}
                                />
                              </div>
                              <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
                                <svg className="w-6 h-6 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                </svg>
                              </div>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Show JSON/text result if present */}
                  {toolData.result && (() => {
                    // Handle result as string or object (backwards compatibility)
                    const resultString = typeof toolData.result === 'object'
                      ? (toolData.result as Record<string, unknown>).formattedText as string
                        || JSON.stringify(toolData.result, null, 2)
                      : toolData.result

                    // Try to parse and pretty-print as JSON
                    try {
                      const parsed = JSON.parse(resultString)
                      const formatted = JSON.stringify(parsed, null, 2)
                      return (
                        <ReactMarkdown>
                          {`\`\`\`json\n${formatted}\n\`\`\``}
                        </ReactMarkdown>
                      )
                    } catch {
                      // Not JSON, display as plain text
                      return (
                        <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-words">
                          {resultString}
                        </pre>
                      )
                    }
                  })()}
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
                      <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
                        <svg className="w-6 h-6 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
