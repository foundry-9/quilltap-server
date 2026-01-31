/**
 * Built-in Embeddings Icon Component
 *
 * Renders a simple icon representing text/document embedding.
 * Uses an abstract representation of text being transformed into vectors.
 */

'use client';

import React from 'react';

interface IconProps {
  className?: string;
}

/**
 * Built-in Embeddings Icon
 *
 * Displays an icon representing text-to-vector transformation.
 * Shows document lines transforming into a vector pattern.
 */
export function BuiltinEmbeddingsIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Document/text representation on left */}
      <rect x="3" y="4" width="8" height="16" rx="1" />
      <line x1="5" y1="8" x2="9" y2="8" />
      <line x1="5" y1="11" x2="9" y2="11" />
      <line x1="5" y1="14" x2="9" y2="14" />

      {/* Arrow showing transformation */}
      <path d="M11 12 L14 12" />
      <polyline points="13 10 15 12 13 14" />

      {/* Vector representation on right (dots in a pattern) */}
      <circle cx="18" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="17" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="9.5" r="1" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="20" cy="14.5" r="1" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  );
}

export default BuiltinEmbeddingsIcon;
