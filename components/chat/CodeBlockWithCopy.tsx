'use client'

import { useState, useCallback } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'

/**
 * Code block with copy button component
 */
export function CodeBlockWithCopy({ code, language }: { code: string; language: string }) {
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
