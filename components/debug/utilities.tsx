'use client';

import { useState } from 'react';
import { clientLogger } from '@/lib/client-logger';
import { CopyButtonProps, SyntaxHighlightedJSONProps } from './types';

/**
 * Copy button component for copying content to clipboard
 */
export function CopyButton({ content }: Readonly<CopyButtonProps>) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      clientLogger.error('Failed to copy:', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`qt-copy-button ${copied ? 'qt-copy-button-success' : ''}`}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  );
}

/**
 * Simple syntax highlighting for JSON
 */
export function SyntaxHighlightedJSON({ content }: SyntaxHighlightedJSONProps) {
  const highlighted = content
    // Strings
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="text-purple-600 dark:text-purple-400">$1</span>:'
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="text-green-600 dark:text-green-400">$1</span>'
    )
    // Numbers
    .replace(
      /:\s*(-?\d+\.?\d*)/g,
      ': <span class="text-blue-600 dark:text-blue-400">$1</span>'
    )
    // Booleans and null
    .replace(
      /:\s*(true|false|null)/g,
      ': <span class="text-orange-600 dark:text-orange-400">$1</span>'
    );

  return (
    <pre
      className="whitespace-pre-wrap break-all text-xs"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}
