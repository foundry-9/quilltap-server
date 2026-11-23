/**
 * How a research-kit tool's answer travels from the executor to the model.
 *
 * The kit's tools answer in prose-shaped text (names, titles, paths, dates,
 * indented snippets), already cut under the kit's ceiling. The executor wraps
 * that text as a `ResearchKitResult`, and the tool-message builder
 * (`tool-execution.service.ts`) hands the text to the model as it is, rather
 * than as JSON with every newline escaped.
 *
 * @module lib/research/result
 */

export interface ResearchKitResult {
  kitText: string
}

export function researchKitResult(text: string): ResearchKitResult {
  return { kitText: text }
}

export function isResearchKitResult(value: unknown): value is ResearchKitResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kitText?: unknown }).kitText === 'string'
  )
}
