'use client'

import { useMemo, useState, useCallback, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import type { Components } from 'react-markdown'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

/**
 * Code block with copy button component
 */
function CodeBlockWithCopy({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code block', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [code])

  return (
    <div
      className="qt-code-block-container"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        borderRadius: '0.375rem',
        marginTop: '0.5rem',
        marginBottom: '0.5rem',
      }}
    >
      <button
        onClick={handleCopy}
        className={`qt-copy-button qt-code-block-copy ${copied ? 'qt-copy-button-success' : ''}`}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? '✓' : '📋'}
        <span className="qt-copy-button-text">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {language === 'text' ? (
        <pre
          style={{
            margin: 0,
            padding: '1rem',
            paddingTop: '2.5rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            background: 'rgb(40, 44, 52)',
            color: '#abb2bf',
            fontFamily: 'var(--qt-code-font, monospace)',
            fontSize: '0.875rem',
            lineHeight: '1.5',
          }}
        >
          <code>{code.replace(/\n$/, '')}</code>
        </pre>
      ) : (
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          wrapLines={true}
          wrapLongLines={true}
          customStyle={{
            margin: 0,
            padding: '1rem',
            paddingTop: '2.5rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
          codeTagProps={{
            style: {
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            },
          }}
        >
          {code.replace(/\n$/, '')}
        </SyntaxHighlighter>
      )}
    </div>
  )
}

interface MessageContentProps {
  content: string
  className?: string
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null
  /**
   * Mount point ID for resolving relative image paths. When set, an image
   * reference like `![alt](images/avatar.webp)` will resolve to the blob
   * API at `/api/v1/mount-points/<id>/blobs/images/avatar.webp` so
   * database-backed stores' images render inline.
   */
  blobMountPointId?: string
}

// Internal compiled pattern type
interface CompiledPattern {
  regex: RegExp
  className: string
}

/**
 * Default rendering patterns used when template doesn't specify any.
 * Includes common patterns from both Standard and Quilltap-style formatting.
 */
const DEFAULT_RENDERING_PATTERNS: RenderingPattern[] = [
  // OOC: ((comments)) - double parentheses
  { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
  // OOC: // comment - line prefix style
  { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' },
  // Dialogue: "speech" - straight and curly quotes
  { pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' },
  // Narration: *actions* - single asterisks (not bold **)
  { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
  // Narration: [actions] - square brackets (not links)
  { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
  // Internal monologue: {thoughts} - excludes {{template}} variables
  { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' },
]

/**
 * Default dialogue detection for paragraph-level styling.
 * Handles straight and curly quotes.
 */
const DEFAULT_DIALOGUE_DETECTION: DialogueDetection = {
  openingChars: ['"', '"'],
  closingChars: ['"', '"'],
  className: 'qt-chat-dialogue',
}

/**
 * Compile string patterns to RegExp objects
 */
function compilePatterns(patterns: RenderingPattern[]): CompiledPattern[] {
  return patterns.map(p => ({
    regex: new RegExp(p.pattern, p.flags || ''),
    className: p.className,
  }))
}

/**
 * Escape markdown syntax characters inside roleplay brackets to prevent
 * ReactMarkdown from breaking up the segments before we can style them.
 * This handles cases like [narration with *emphasis* inside]
 *
 * IMPORTANT: This function preserves fenced code blocks (``` ... ```) unchanged
 * to prevent corrupting code content with escape sequences.
 */
function escapeMarkdownInBrackets(content: string, patterns: RenderingPattern[]): string {
  // Characters that trigger markdown parsing
  const markdownChars = /([*_~`])/g

  // Check if patterns include bracket-style narration [...]
  const hasBracketNarration = patterns.some(p => p.pattern.includes('\\['))
  // Check if patterns include brace-style monologue {...}
  const hasBraceMonologue = patterns.some(p => p.pattern.includes('\\{'))
  // Check if patterns include single-asterisk narration *...*
  const hasAsteriskNarration = patterns.some(p =>
    p.pattern.includes('\\*') && p.className === 'qt-chat-narration'
  )

  // If no relevant patterns, return content unchanged
  if (!hasBracketNarration && !hasBraceMonologue && !hasAsteriskNarration) {
    return content
  }

  // Split content by fenced code blocks to preserve them unchanged
  // Match ``` optionally followed by language, then content, then closing ```
  const codeBlockRegex = /(```[\s\S]*?```)/g
  const parts = content.split(codeBlockRegex)

  // Process only non-code-block parts
  const processedParts = parts.map((part, index) => {
    // Odd indices are code blocks (captured groups from split)
    if (index % 2 === 1) {
      return part // Return code blocks unchanged
    }

    let result = part

    // Escape inside [...] if bracket narration is in patterns
    if (hasBracketNarration) {
      result = result.replace(/\[([^\]]+)\](?!\()/g, (match, inner) => {
        // Escape markdown characters with backslash
        const escaped = inner.replace(markdownChars, '\\$1')
        return `[${escaped}]`
      })
    }

    // Escape inside {...} if brace monologue is in patterns
    // Excludes {{template}} variables using lookbehind/lookahead
    if (hasBraceMonologue) {
      result = result.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (match, inner) => {
        const escaped = inner.replace(markdownChars, '\\$1')
        return `{${escaped}}`
      })
    }

    // Escape inside *...* if single asterisks are used for narration
    // Be careful not to double-escape or break bold **...**
    if (hasAsteriskNarration) {
      // Match single asterisk pairs that aren't bold
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (match, inner) => {
        // Only escape if there are nested markdown chars (unlikely but safe)
        const escaped = inner.replace(/([_~`])/g, '\\$1')
        return `*${escaped}*`
      })
    }

    return result
  })

  return processedParts.join('')
}

/**
 * Process roleplay syntax in a string and return React elements
 * Applies patterns based on the compiled pattern list
 */
function processRoleplayText(text: string, compiledPatterns: CompiledPattern[]): ReactNode[] {
  const result: ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    let earliestMatch: { index: number; length: number; className: string; text: string } | null = null

    // Find the earliest match among all patterns
    for (const pattern of compiledPatterns) {
      const match = remaining.match(pattern.regex)
      if (match && match.index !== undefined) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          earliestMatch = {
            index: match.index,
            length: match[0].length,
            className: pattern.className,
            text: match[0],
          }
        }
      }
    }

    if (earliestMatch) {
      // Add text before the match
      if (earliestMatch.index > 0) {
        result.push(remaining.substring(0, earliestMatch.index))
      }

      // Add the styled span
      result.push(
        <span key={key++} className={earliestMatch.className}>
          {earliestMatch.text}
        </span>
      )

      // Continue with remaining text
      remaining = remaining.substring(earliestMatch.index + earliestMatch.length)
    } else {
      // No more matches, add remaining text
      result.push(remaining)
      break
    }
  }

  return result
}

/**
 * Recursively process children to apply roleplay styling to text nodes
 */
function processChildren(children: ReactNode, compiledPatterns: CompiledPattern[]): ReactNode {
  if (typeof children === 'string') {
    const processed = processRoleplayText(children, compiledPatterns)
    return processed.length === 1 && typeof processed[0] === 'string'
      ? processed[0]
      : <>{processed}</>
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        const processed = processRoleplayText(child, compiledPatterns)
        return processed.length === 1 && typeof processed[0] === 'string'
          ? processed[0]
          : <span key={i}>{processed}</span>
      }
      return child
    })
  }

  return children
}

/**
 * Extract plain text content from React children (recursively)
 * Used to detect paragraph-level patterns when content contains formatting
 */
function extractTextContent(children: ReactNode): string {
  if (typeof children === 'string') {
    return children
  }
  if (typeof children === 'number') {
    return String(children)
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('')
  }
  // Handle React elements - extract text from their children
  if (children && typeof children === 'object' && 'props' in children) {
    const element = children as { props: { children?: ReactNode } }
    return extractTextContent(element.props.children)
  }
  return ''
}

/**
 * Check if text content represents dialogue based on configured detection
 * Uses the openingChars and closingChars from DialogueDetection config
 */
function isDialogueParagraph(text: string, detection: DialogueDetection): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false

  const firstChar = trimmed[0]
  const lastChar = trimmed[trimmed.length - 1]

  return detection.openingChars.includes(firstChar) && detection.closingChars.includes(lastChar)
}


export default function MessageContent({
  content,
  className = '',
  renderingPatterns,
  dialogueDetection,
  blobMountPointId,
}: MessageContentProps) {
  // Use provided patterns or fall back to defaults
  const patterns = renderingPatterns && renderingPatterns.length > 0
    ? renderingPatterns
    : DEFAULT_RENDERING_PATTERNS

  // Use provided dialogue detection or fall back to default
  const dialogueConfig = dialogueDetection || DEFAULT_DIALOGUE_DETECTION

  // Compile patterns once for efficient matching
  const compiledPatterns = useMemo(
    () => compilePatterns(patterns),
    [patterns]
  )

  // Pre-process content: trim leading/trailing whitespace (a leading tab triggers
  // markdown's indented code block rule, rendering the whole message as preformatted),
  // then escape markdown inside roleplay brackets
  const processedContent = useMemo(
    () => escapeMarkdownInBrackets(content.trim(), patterns),
    [content, patterns]
  )

  const components: Components = useMemo(() => ({
    // Fenced code blocks - handled by pre component since they're <pre><code>
    // This ensures ALL fenced code blocks get block styling, regardless of language
    pre({ children }) {
      // Extract the code element's props from children
      const codeElement = children as any
      const className = codeElement?.props?.className || ''
      const codeChildren = codeElement?.props?.children

      const match = /language-(\w+)/.exec(className)
      const language = match ? match[1] : 'text'
      const codeString = typeof codeChildren === 'string' || typeof codeChildren === 'number'
        ? String(codeChildren)
        : ''

      return <CodeBlockWithCopy code={codeString} language={language} />
    },
    // Inline code only (not wrapped in pre)
    code({ className, children, ...props }) {
      return (
        <code className={`${className || ''} qt-code-inline`} {...props}>
          {children}
        </code>
      )
    },
    // Paragraph - CSS handles spacing; only custom behavior is dialogue detection
    // and roleplay pattern processing on text nodes.
    p({ children }) {
      const textContent = extractTextContent(children)
      const isDialogue = isDialogueParagraph(textContent, dialogueConfig)
      const dialogueClass = isDialogue ? dialogueConfig.className : undefined
      return <p className={dialogueClass}>{processChildren(children, compiledPatterns)}</p>
    },
    // Headings - CSS handles sizing, weight, and spacing; only custom behavior
    // is roleplay pattern processing on text nodes.
    h1({ children }) {
      return <h1>{processChildren(children, compiledPatterns)}</h1>
    },
    h2({ children }) {
      return <h2>{processChildren(children, compiledPatterns)}</h2>
    },
    h3({ children }) {
      return <h3>{processChildren(children, compiledPatterns)}</h3>
    },
    h4({ children }) {
      return <h4>{processChildren(children, compiledPatterns)}</h4>
    },
    h5({ children }) {
      return <h5>{processChildren(children, compiledPatterns)}</h5>
    },
    h6({ children }) {
      return <h6>{processChildren(children, compiledPatterns)}</h6>
    },
    // List items - CSS handles spacing; roleplay patterns processed on text nodes.
    // ul/ol have no custom behavior, so they are intentionally omitted here —
    // react-markdown renders plain <ul>/<ol> and CSS handles all styling.
    li({ children }) {
      return <li>{processChildren(children, compiledPatterns)}</li>
    },
    // Blockquote - CSS handles styling; roleplay patterns processed on text nodes.
    blockquote({ children }) {
      return (
        <blockquote>
          {processChildren(children, compiledPatterns)}
        </blockquote>
      )
    },
    // Links - must open in new tab; CSS (qt-link) handles appearance.
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="qt-link"
        >
          {children}
        </a>
      )
    },
    // Tables - the overflow-x-auto wrapper div is intentionally kept here because
    // CSS cannot inject a wrapper element, and overflow protection for wide tables
    // is a layout priority. thead/th/td have no custom behavior so they are omitted
    // — CSS handles all table cell styling.
    table({ children }) {
      return (
        <div className="overflow-x-auto">
          <table>{children}</table>
        </div>
      )
    },
    // Images — when a blob mount-point context is supplied, rewrite relative
    // references so `![alt](images/avatar.webp)` resolves to the mount-point
    // blob API. Absolute URLs, data URIs, and paths under the existing /api
    // tree pass through untouched.
    img({ src, alt, title, ...props }) {
      let resolvedSrc = typeof src === 'string' ? src : ''
      if (
        blobMountPointId &&
        resolvedSrc &&
        !/^([a-z]+:)?\/\//i.test(resolvedSrc) &&
        !resolvedSrc.startsWith('data:') &&
        !resolvedSrc.startsWith('/')
      ) {
        const encoded = resolvedSrc.split('/').map(encodeURIComponent).join('/')
        resolvedSrc = `/api/v1/mount-points/${blobMountPointId}/blobs/${encoded}`
      }
      return <img src={resolvedSrc} alt={alt || ''} title={title} {...props} />
    },
  }), [compiledPatterns, dialogueConfig, blobMountPointId])

  return (
    <>
      <div className={`qt-chat-message-content qt-prose prose prose-sm qt-prose-auto message-content ${className}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={components}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </>
  )
}
