'use client'

/**
 * FilePreviewText Component
 *
 * Renders a text file in the preview modal with syntax highlighting hints.
 * Markdown files (.md) are rendered with full markdown formatting.
 * Supports wikilinks [[File]] and [[File#Header]] with navigation.
 */

import { useEffect, useMemo, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { clientLogger } from '@/lib/client-logger'
import { FileInfo } from '../types'

interface FilePreviewTextProps {
  /** The file being previewed */
  file: FileInfo
  /** The text content to display */
  content: string | null
  /** Whether content is loading */
  isLoading: boolean
  /** Error message if loading failed */
  error: string | null
  /** All files in the current view (for wikilink navigation) */
  files?: FileInfo[]
  /** Called when navigating to a different file via wikilink */
  onNavigate?: (file: FileInfo, heading?: string) => void
  /** Optional heading to scroll to after content loads */
  targetHeading?: string
}

interface ParsedFrontmatter {
  data: Record<string, unknown>
  content: string
}

/**
 * Check if a file is a markdown file
 */
function isMarkdownFile(file: FileInfo): boolean {
  // Check MIME type
  if (file.mimeType.includes('markdown')) return true
  // Check file extension
  const filename = file.originalFilename.toLowerCase()
  return filename.endsWith('.md') || filename.endsWith('.markdown')
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns the frontmatter data and the content without frontmatter
 */
function parseFrontmatter(content: string): ParsedFrontmatter {
  // Check if content starts with ---
  if (!content.startsWith('---')) {
    return { data: {}, content }
  }

  // Find the closing ---
  const endIndex = content.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { data: {}, content }
  }

  const yamlContent = content.slice(4, endIndex).trim()
  const markdownContent = content.slice(endIndex + 4).trim()

  // Parse simple YAML (key: value pairs)
  const data: Record<string, unknown> = {}
  const lines = yamlContent.split('\n')

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    let value: unknown = line.slice(colonIndex + 1).trim()

    // Handle quoted strings
    if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
      value = (value as string).slice(1, -1)
    } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
      value = (value as string).slice(1, -1)
    }
    // Handle arrays (simple inline format: [a, b, c])
    else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
      const arrayContent = (value as string).slice(1, -1)
      value = arrayContent.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, ''))
    }
    // Handle booleans
    else if (value === 'true') {
      value = true
    } else if (value === 'false') {
      value = false
    }
    // Handle numbers
    else if (!isNaN(Number(value)) && value !== '') {
      value = Number(value)
    }

    if (key) {
      data[key] = value
    }
  }

  return { data, content: markdownContent }
}

/**
 * Format a frontmatter value for display
 */
function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (value === null || value === undefined) {
    return '—'
  }
  return String(value)
}

/**
 * Get a language hint from MIME type for styling
 */
function getLanguageHint(mimeType: string): string {
  if (mimeType.includes('json')) return 'json'
  if (mimeType.includes('javascript')) return 'javascript'
  if (mimeType.includes('typescript')) return 'typescript'
  if (mimeType.includes('html')) return 'html'
  if (mimeType.includes('css')) return 'css'
  if (mimeType.includes('xml')) return 'xml'
  if (mimeType.includes('markdown')) return 'markdown'
  if (mimeType.includes('yaml')) return 'yaml'
  return 'text'
}

/**
 * Process wikilinks in markdown content
 * Converts [[File]], [[File#Header]], [[File|Text]], [[File#Header|Text]]
 * to standard markdown links with special data attributes for navigation
 */
function processWikilinks(content: string): string {
  // Match wikilinks: [[target]] or [[target|display]] or [[target#header]] or [[target#header|display]]
  const wikilinkRegex = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g

  return content.replace(wikilinkRegex, (match, target, header, displayText) => {
    const filename = target.trim()
    const heading = header?.trim()
    const customText = displayText?.trim()

    // Build the display text
    let display: string
    if (customText) {
      display = customText
    } else if (heading) {
      display = `${filename} → ${heading}`
    } else {
      display = filename
    }

    // Build the href - use #wikilink/ prefix which is a valid anchor format
    // URL-encode the parts to handle spaces and special characters
    const encodedFilename = encodeURIComponent(filename)
    const encodedHeading = heading ? encodeURIComponent(heading) : null
    const href = encodedHeading
      ? `#wikilink/${encodedFilename}/${encodedHeading}`
      : `#wikilink/${encodedFilename}`

    return `[${display}](${href})`
  })
}

/**
 * Find a file by name (case-insensitive, with or without extension)
 */
function findFileByName(files: FileInfo[], targetName: string): FileInfo | null {
  const normalizedTarget = targetName.toLowerCase()

  // Try exact match first (with extension)
  let found = files.find(f =>
    f.originalFilename.toLowerCase() === normalizedTarget ||
    f.originalFilename.toLowerCase() === `${normalizedTarget}.md` ||
    f.originalFilename.toLowerCase() === `${normalizedTarget}.markdown`
  )

  if (found) return found

  // Try matching without extension
  found = files.find(f => {
    const nameWithoutExt = f.originalFilename.replace(/\.(md|markdown)$/i, '').toLowerCase()
    return nameWithoutExt === normalizedTarget
  })

  return found || null
}

export default function FilePreviewText({
  file,
  content,
  isLoading,
  error,
  files = [],
  onNavigate,
  targetHeading,
}: Readonly<FilePreviewTextProps>) {
  // Ref for scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const languageHint = getLanguageHint(file.mimeType)
  const isMarkdown = isMarkdownFile(file)

  // Parse frontmatter and process wikilinks for markdown files (must be before any early returns)
  const parsed = useMemo(() => {
    if (!content || !isMarkdown) {
      return null
    }
    const frontmatter = parseFrontmatter(content)
    // Process wikilinks in the content
    return {
      ...frontmatter,
      content: processWikilinks(frontmatter.content),
    }
  }, [content, isMarkdown])

  const hasFrontmatter = parsed && Object.keys(parsed.data).length > 0

  // Handle link clicks for wikilinks and relative markdown links
  const handleLinkClick = useCallback((href: string, e: React.MouseEvent) => {
    // Check if it's a wikilink (format: #wikilink/filename or #wikilink/filename/heading)
    if (href.startsWith('#wikilink/')) {
      e.preventDefault()
      const target = href.slice(10) // Remove '#wikilink/' prefix
      const parts = target.split('/')
      const encodedFilename = parts[0]
      const encodedHeading = parts[1] // May be undefined
      // Decode the URL-encoded filename and heading
      const filename = decodeURIComponent(encodedFilename)
      const heading = encodedHeading ? decodeURIComponent(encodedHeading) : undefined

      const targetFile = findFileByName(files, filename)
      if (targetFile && onNavigate) {
        clientLogger.debug('[FilePreviewText] Navigating via wikilink', {
          from: file.originalFilename,
          to: targetFile.originalFilename,
          heading,
        })
        onNavigate(targetFile, heading)
      } else {
        clientLogger.debug('[FilePreviewText] Wikilink target not found', {
          target: filename,
          availableFiles: files.map(f => f.originalFilename),
        })
      }
      return
    }

    // Check if it's a relative markdown link (not http/https)
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
      e.preventDefault()
      // Extract filename and heading from path and decode
      const urlParts = href.split('#')
      const rawFilename = urlParts[0].split('/').pop() || urlParts[0]
      const filename = decodeURIComponent(rawFilename)
      const heading = urlParts[1] ? decodeURIComponent(urlParts[1]) : undefined
      const targetFile = findFileByName(files, filename)
      if (targetFile && onNavigate) {
        clientLogger.debug('[FilePreviewText] Navigating via relative link', {
          from: file.originalFilename,
          to: targetFile.originalFilename,
          heading,
        })
        onNavigate(targetFile, heading)
      }
    }
    // External links open normally
  }, [files, file.originalFilename, onNavigate])

  // Custom link component for ReactMarkdown
  // Note: We destructure and discard node and onClick from props to prevent them
  // from being passed to the DOM element or overriding our click handler
  const markdownComponents: Components = useMemo(() => ({
    a: ({ href, children, node: _node, onClick: _onClick, ...restProps }) => {
      const isWikilink = href?.startsWith('#wikilink/')
      const isRelativeLink = href && !isWikilink && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('#')
      const isInternalLink = isWikilink || isRelativeLink

      // Check if target file exists for wikilinks/relative links
      let targetExists = false
      if (isWikilink && href) {
        const parts = href.slice(10).split('/') // Remove '#wikilink/' prefix
        const encodedTarget = parts[0]
        const target = decodeURIComponent(encodedTarget)
        targetExists = !!findFileByName(files, target)
      } else if (isRelativeLink && href) {
        const rawFilename = href.split('/').pop()?.split('#')[0] || href
        const filename = decodeURIComponent(rawFilename)
        targetExists = !!findFileByName(files, filename)
      }

      const linkClassName = isInternalLink
        ? targetExists
          ? 'qt-wikilink cursor-pointer'
          : 'qt-wikilink qt-wikilink-broken'
        : undefined

      // For internal links (wikilinks, relative), use a button styled as a link
      // This completely avoids any browser navigation behavior
      if (isInternalLink) {
        const onButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault()
          e.stopPropagation()
          if (href) {
            handleLinkClick(href, e as unknown as React.MouseEvent)
          }
        }

        return (
          <button
            type="button"
            onClick={onButtonClick}
            className={linkClassName}
            title={!targetExists ? 'File not found' : undefined}
          >
            {children}
          </button>
        )
      }

      // External links use normal anchor behavior
      return (
        <a
          {...restProps}
          href={href}
          className={linkClassName}
        >
          {children}
        </a>
      )
    },
  }), [files, handleLinkClick])

  useEffect(() => {
    clientLogger.debug('[FilePreviewText] Rendering text', {
      fileId: file.id,
      languageHint,
      contentLength: content?.length,
      isMarkdown,
    })
  }, [file.id, languageHint, content?.length, isMarkdown])

  // Scroll to heading or top when file/heading changes
  useEffect(() => {
    if (!scrollContainerRef.current || isLoading) return

    // Small delay to ensure content is rendered
    const timeoutId = setTimeout(() => {
      if (!scrollContainerRef.current) return

      if (targetHeading) {
        // Try to find the heading element
        // Headings in markdown are rendered with id attributes based on their text
        // Convert heading text to slug format (lowercase, spaces to hyphens)
        const headingSlug = targetHeading.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
        const headingElement = scrollContainerRef.current.querySelector(`#${CSS.escape(headingSlug)}`)

        if (headingElement) {
          clientLogger.debug('[FilePreviewText] Scrolling to heading', { targetHeading, headingSlug })
          headingElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
          // Fallback: try to find heading by text content
          const headings = scrollContainerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
          for (const h of headings) {
            if (h.textContent?.toLowerCase().includes(targetHeading.toLowerCase())) {
              clientLogger.debug('[FilePreviewText] Scrolling to heading by text match', { targetHeading })
              h.scrollIntoView({ behavior: 'smooth', block: 'start' })
              return
            }
          }
          // If still not found, scroll to top
          clientLogger.debug('[FilePreviewText] Heading not found, scrolling to top', { targetHeading })
          scrollContainerRef.current.scrollTop = 0
        }
      } else {
        // No heading specified, scroll to top
        clientLogger.debug('[FilePreviewText] Scrolling to top')
        scrollContainerRef.current.scrollTop = 0
      }
    }, 50)

    return () => clearTimeout(timeoutId)
  }, [file.id, targetHeading, isLoading])

  if (isLoading) {
    return (
      <div className="qt-file-preview-loading">
        <div className="qt-file-preview-loading-text">Loading file...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="qt-file-preview-empty">
        <div className="qt-file-preview-empty-icon">{'\u{1F4C3}'}</div>
        <p>{error}</p>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="qt-file-preview-empty">
        <div className="qt-file-preview-empty-icon">{'\u{1F4C3}'}</div>
        <p>No content available</p>
      </div>
    )
  }

  // Render markdown files with ReactMarkdown
  if (isMarkdown && parsed) {
    return (
      <div ref={scrollContainerRef} className="qt-file-preview-scroll">
        <div className="qt-file-preview-panel">
          {/* Frontmatter display */}
          {hasFrontmatter && (
            <div className="qt-frontmatter">
              <div className="qt-frontmatter-title">Document Info</div>
              <table className="qt-frontmatter-table">
                <tbody>
                  {Object.entries(parsed.data).map(([key, value]) => (
                    <tr key={key}>
                      <th>{key}</th>
                      <td>{formatFrontmatterValue(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Markdown content */}
          <div className="qt-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{parsed.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  // Render other text files as plain text
  return (
    <div ref={scrollContainerRef} className="qt-file-preview-scroll">
      <pre className="qt-file-preview-code">
        <code data-language={languageHint}>{content}</code>
      </pre>
    </div>
  )
}
