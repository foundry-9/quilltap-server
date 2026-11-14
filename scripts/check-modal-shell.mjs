#!/usr/bin/env node
/**
 * Repo-wide guard: every dialog is a `BaseModal` (refactor 4.13, "One modal
 * shell"; #171).
 *
 * Fifty-odd dialogs used to hand-spell their own overlay — `useId` +
 * `useDialogFocus` + `useEscapeKey` + overlay markup — and disagreed on every
 * point the accessibility rule left to the author: whether to portal to
 * `document.body` (32 painted under the workspace toolbar, because
 * `.qt-workspace` is `isolation: isolate`), whether Escape closes only the
 * topmost dialog, whether a child dialog counts as "outside" its parent (#171),
 * the z-index, the busy guard. The shell now owns all of it, and this script
 * keeps a new hand-built overlay from growing back.
 *
 * RULE. A `.tsx` file under `app/` or `components/` that contains
 * `qt-dialog-overlay` or `fixed inset-0` fails unless it imports `BaseModal`
 * (directly, or through a named variant such as `WizardModal`) or is on the
 * allowlist below. The allowlist is the only exception, and each entry says
 * why it is not a dialog the shell should own.
 *
 * Run standalone with `node scripts/check-modal-shell.mjs`; `npm run lint` runs
 * it alongside the other repo-wide guards.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Files allowed to draw a full-screen overlay without the shell. */
export const MODAL_SHELL_ALLOWLIST = new Map([
  ['components/ui/BaseModal.tsx', 'the shell itself'],
  ['components/startup/instance-lock-gate.tsx', 'startup gate: renders before providers exist, outside the workspace'],
  ['components/startup/version-guard-gate.tsx', 'startup gate: renders before providers exist, outside the workspace'],
  ['components/images/FullScreenImageViewer.tsx', 'lightbox, a different shell'],
  ['components/chat/ImageModal.tsx', 'lightbox, to fold into FullScreenImageViewer'],
  ['components/images/image-detail/ImageDetailModal.tsx', 'lightbox, to fold into FullScreenImageViewer'],
])

const OVERLAY = /qt-dialog-overlay|fixed inset-0/
const USES_SHELL = /import[^;]*\b(BaseModal|WizardModal)\b[^;]*from\s+['"][^'"]+['"]/

export function findViolations(files, read) {
  const violations = []
  for (const file of files) {
    if (MODAL_SHELL_ALLOWLIST.has(file)) continue
    const source = read(file)
    if (!OVERLAY.test(source)) continue
    if (USES_SHELL.test(source)) continue
    const lines = source.split('\n')
    const line = lines.findIndex((l) => OVERLAY.test(l)) + 1
    violations.push({ file, line })
  }
  return violations
}

function main() {
  const files = execFileSync('git', ['ls-files', '--', 'app/*.tsx', 'components/*.tsx'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

  const violations = findViolations(files, (file) => readFileSync(path.join(REPO_ROOT, file), 'utf8'))

  if (violations.length > 0) {
    console.error('Hand-built dialog overlays found. A modal is a BaseModal (components/ui/BaseModal.tsx)')
    console.error('or a named variant of it (WizardModal); the shell owns the portal, focus, Escape')
    console.error('stacking, the backdrop and the z-index. Not a dialog? Add it to MODAL_SHELL_ALLOWLIST')
    console.error('in scripts/check-modal-shell.mjs with the reason.\n')
    for (const { file, line } of violations) console.error(`  ${file}:${line}`)
    process.exit(1)
  }
  console.log(`check-modal-shell: ${files.length} files, every dialog on the shell.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
