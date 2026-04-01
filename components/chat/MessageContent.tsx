'use client'

import { useMemo, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import type { Components } from 'react-markdown'

interface MessageContentProps {
  content: string
  className?: string
  roleplayTemplateName?: string | null
}

// Pattern definitions for roleplay syntax styling
interface RoleplayPattern {
  regex: RegExp
  className: string
  wrapper: (match: string, inner: string) => string
}

// Standard template patterns: *actions*, "dialogue", ((OOC))
const STANDARD_PATTERNS: RoleplayPattern[] = [
  // Standard: ((OOC)) - double parentheses
  { regex: /\(\([^)]+\)\)/, className: 'qt-chat-ooc', wrapper: (m) => m },
  // Standard: "dialogue"
  { regex: /"[^"]+"/, className: 'qt-chat-dialogue', wrapper: (m) => m },
  // Standard: *narration* - single asterisks only (not bold **)
  { regex: /(?<!\*)\*[^*]+\*(?!\*)/, className: 'qt-chat-narration', wrapper: (m) => m },
]

// Quilltap RP template patterns: [actions], {thoughts}, // OOC, bare dialogue
const QUILLTAP_RP_PATTERNS: RoleplayPattern[] = [
  // Quilltap RP: // OOC (comment-style, line prefix)
  { regex: /^\/\/ .+$/m, className: 'qt-chat-ooc', wrapper: (m) => m },
  // Quilltap RP: {internal monologue}
  { regex: /\{[^}]+\}/, className: 'qt-chat-inner-monologue', wrapper: (m) => m },
  // Quilltap RP: [narration] - not followed by ( to avoid links
  { regex: /\[[^\]]+\](?!\()/, className: 'qt-chat-narration', wrapper: (m) => m },
]

/**
 * Get the appropriate patterns based on template name
 */
function getPatternsForTemplate(templateName?: string | null): RoleplayPattern[] {
  if (templateName === 'Quilltap RP') {
    return QUILLTAP_RP_PATTERNS
  }
  if (templateName === 'Standard') {
    return STANDARD_PATTERNS
  }
  // For unknown/custom templates or no template, use all patterns as fallback
  return [...QUILLTAP_RP_PATTERNS, ...STANDARD_PATTERNS]
}

/**
 * Escape markdown syntax characters inside roleplay brackets to prevent
 * ReactMarkdown from breaking up the segments before we can style them.
 * This handles cases like [narration with *emphasis* inside]
 */
function escapeMarkdownInBrackets(content: string, templateName?: string | null): string {
  // Characters that trigger markdown parsing
  const markdownChars = /([*_~`])/g

  let result = content

  // Escape inside [...] (Quilltap RP narration, or fallback)
  if (!templateName || templateName === 'Quilltap RP') {
    result = result.replace(/\[([^\]]+)\](?!\()/g, (match, inner) => {
      // Escape markdown characters with backslash
      const escaped = inner.replace(markdownChars, '\\$1')
      return `[${escaped}]`
    })

    // Escape inside {...} (Quilltap RP internal monologue)
    result = result.replace(/\{([^}]+)\}/g, (match, inner) => {
      const escaped = inner.replace(markdownChars, '\\$1')
      return `{${escaped}}`
    })
  }

  // Escape inside *...* for Standard template (single asterisks for narration)
  // Be careful not to double-escape or break bold **...**
  if (templateName === 'Standard') {
    // Match single asterisk pairs that aren't bold
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (match, inner) => {
      // Only escape if there are nested markdown chars (unlikely but safe)
      const escaped = inner.replace(/([_~`])/g, '\\$1')
      return `*${escaped}*`
    })
  }

  return result
}

/**
 * Process roleplay syntax in a string and return React elements
 * Applies patterns based on the active roleplay template
 */
function processRoleplayText(text: string, templateName?: string | null): ReactNode[] {
  const result: ReactNode[] = []
  let remaining = text
  let key = 0

  const patterns = getPatternsForTemplate(templateName)

  while (remaining.length > 0) {
    let earliestMatch: { index: number; length: number; className: string; text: string } | null = null

    // Find the earliest match among all patterns
    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex)
      if (match && match.index !== undefined) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          earliestMatch = {
            index: match.index,
            length: match[0].length,
            className: pattern.className,
            text: pattern.wrapper(match[0], match[0]),
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
function processChildren(children: ReactNode, templateName?: string | null): ReactNode {
  if (typeof children === 'string') {
    const processed = processRoleplayText(children, templateName)
    return processed.length === 1 && typeof processed[0] === 'string'
      ? processed[0]
      : <>{processed}</>
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        const processed = processRoleplayText(child, templateName)
        return processed.length === 1 && typeof processed[0] === 'string'
          ? processed[0]
          : <span key={i}>{processed}</span>
      }
      return child
    })
  }

  return children
}


export default function MessageContent({ content, className = '', roleplayTemplateName }: MessageContentProps) {
  // Pre-process content to escape markdown inside roleplay brackets
  const processedContent = useMemo(
    () => escapeMarkdownInBrackets(content, roleplayTemplateName),
    [content, roleplayTemplateName]
  )

  const components: Components = {
    // Code blocks with syntax highlighting
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''
      const inline = !match
      const childrenString = typeof children === 'string' || typeof children === 'number' ? String(children) : ''

      return !inline && language ? (
        <div style={{
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          borderRadius: '0.375rem',
          marginTop: '0.5rem',
          marginBottom: '0.5rem',
        }}>
          <SyntaxHighlighter
            // @ts-expect-error - style type mismatch between library versions
            style={oneDark}
            language={language}
            PreTag="div"
            wrapLines={true}
            wrapLongLines={true}
            customStyle={{
              margin: 0,
              padding: '1rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
            {...props}
          >
            {childrenString.replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      ) : (
        <code className={`${className} qt-code-inline`} {...props}>
          {children}
        </code>
      )
    },
    // Paragraph spacing - inherits font from parent, processes roleplay syntax
    p({ children }) {
      return <p className="mb-2 last:mb-0">{processChildren(children, roleplayTemplateName)}</p>
    },
    // Headings - inherit font from parent
    h1({ children }) {
      return <h1 className="text-2xl font-bold mb-2 mt-4 first:mt-0">{processChildren(children, roleplayTemplateName)}</h1>
    },
    h2({ children }) {
      return <h2 className="text-xl font-bold mb-2 mt-3 first:mt-0">{processChildren(children, roleplayTemplateName)}</h2>
    },
    h3({ children }) {
      return <h3 className="text-lg font-semibold mb-2 mt-3 first:mt-0">{processChildren(children, roleplayTemplateName)}</h3>
    },
    h4({ children }) {
      return <h4 className="text-base font-semibold mb-1 mt-2 first:mt-0">{processChildren(children, roleplayTemplateName)}</h4>
    },
    h5({ children }) {
      return <h5 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{processChildren(children, roleplayTemplateName)}</h5>
    },
    h6({ children }) {
      return <h6 className="text-xs font-semibold mb-1 mt-2 first:mt-0">{processChildren(children, roleplayTemplateName)}</h6>
    },
    // Lists - inherit font from parent
    ul({ children }) {
      return <ul className="list-disc list-inside mb-2 ml-4">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside mb-2 ml-4">{children}</ol>
    },
    li({ children }) {
      return <li className="mb-1">{processChildren(children, roleplayTemplateName)}</li>
    },
    // Blockquotes - inherit font from parent
    blockquote({ children }) {
      return (
        <blockquote className="border-l-4 border-border pl-4 py-1 my-2 italic">
          {processChildren(children, roleplayTemplateName)}
        </blockquote>
      )
    },
    // Links
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
    // Tables
    table({ children }) {
      return (
        <div className="overflow-x-auto my-2">
          <table className="min-w-full border-collapse border border-border">
            {children}
          </table>
        </div>
      )
    },
    thead({ children }) {
      return <thead className="bg-muted">{children}</thead>
    },
    th({ children }) {
      return (
        <th className="border border-border px-4 py-2 text-left font-semibold">
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td className="border border-border px-4 py-2">
          {children}
        </td>
      )
    },
    // Horizontal rule
    hr() {
      return <hr className="my-4 border-border" />
    },
    // Strong/bold
    strong({ children }) {
      return <strong className="font-bold">{children}</strong>
    },
    // Emphasis/italic
    em({ children }) {
      return <em className="italic">{children}</em>
    },
  }

  return (
    <>
      <style>{`
        .message-content pre {
          white-space: pre-wrap !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
          width: 100% !important;
          max-width: 100% !important;
          overflow: hidden !important;
        }
        .message-content code {
          white-space: pre-wrap !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
        }
      `}</style>
      <div className={`qt-chat-message-content qt-prose prose prose-sm dark:prose-invert message-content ${className}`} style={{ overflow: 'hidden' }}>
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
