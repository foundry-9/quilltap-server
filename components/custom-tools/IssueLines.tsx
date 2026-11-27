'use client'

/**
 * IssueLines — a Workbench section's validation messages, as each section
 * shows them under its fields: errors in the destructive colour, warnings
 * muted behind a ⚠. Pick the messages with `issuesAt` (`lib/pascal/tool-draft`).
 *
 * @module components/custom-tools/IssueLines
 */

interface IssueLinesProps {
  errors?: readonly string[]
  warnings?: readonly string[]
}

export function IssueLines({ errors = [], warnings = [] }: Readonly<IssueLinesProps>) {
  return (
    <>
      {errors.map((message) => (
        <p key={message} className="text-xs qt-text-destructive">
          {message}
        </p>
      ))}
      {warnings.map((message) => (
        <p key={message} className="text-xs qt-text-secondary">
          ⚠ {message}
        </p>
      ))}
    </>
  )
}

export default IssueLines
