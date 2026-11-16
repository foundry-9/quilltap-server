/**
 * What the author hands Calliope from elsewhere in the Atelier (Spec J Stage
 * 3): the inspected hook and what styles it, a validation issue, a failing
 * contrast pair. Each becomes the opening of a message in her composer, for
 * the author to finish and send; nothing is sent on their behalf.
 *
 * Pure and browser-safe.
 *
 * @module components/theme-editor/calliope/hand-off
 */

import type { ContrastFinding } from '@/lib/themes/engine/client'
import type { InspectReport } from '@/components/theme-inspect/report'

/** The most lines of "what styles it" a hand-off carries. */
const MAX_USES = 12

/** "Ask Calliope about this" from the inspector. */
export function inspectHandOffText(report: InspectReport): string {
  const lines: string[] = []
  const hook = report.match?.hook
  if (hook) {
    const variants = report.match!.variants.map((v) => `[${v.attribute}="${v.value}"]`).join('')
    lines.push(`About the ${hook.label} (.${hook.className}${variants})${report.surfaceTitle ? ` on ${report.surfaceTitle}` : ''}, in ${report.mode} mode.`)
  } else {
    lines.push(`About an element with no hook of its own, in ${report.mode} mode.`)
  }
  const uses = report.base.flatMap((g) => g.uses)
  if (uses.length > 0) {
    lines.push('What styles it now:')
    for (const use of uses.slice(0, MAX_USES)) {
      const traced = use.traces
        .map((t) => `${t.name}${t.literal ? ` = ${t.literal}` : t.value ? ` = ${t.value}` : ''}${t.setByTheme ? ' (set by this theme)' : ''}`)
        .join(', ')
      lines.push(`- ${use.property}: ${traced || use.declared}${use.fromCustomCss ? ' (from the theme’s own CSS)' : ''}`)
    }
    if (uses.length > MAX_USES) lines.push(`- …and ${uses.length - MAX_USES} more`)
  }
  if (report.customRules.length > 0) {
    lines.push(`The theme’s own CSS that applies: ${report.customRules.map((r) => r.selector).join(', ')}`)
  }
  lines.push('', 'I would like ')
  return lines.join('\n')
}

/** "Ask Calliope" about a validation issue the editor shows. */
export function issueHandOffText(issue: { severity: 'error' | 'warning'; message: string }): string {
  return `The draft has this ${issue.severity}:\n${issue.message}\n\nPlease propose a fix.`
}

/** "Ask Calliope" about a contrast pair that falls short. */
export function contrastHandOffText(finding: ContrastFinding): string {
  const { pair } = finding
  const measured = finding.status === 'fail' ? `is ${finding.ratio}:1` : `cannot be checked (${finding.reason ?? 'unresolved'})`
  return (
    `In ${finding.mode} mode, ${pair.foreground} on ${pair.background} ${measured}; ${pair.kind} needs ${finding.threshold}:1.\n\n` +
    'Please propose a fix that keeps the look as close as it can.'
  )
}
