/**
 * Calliope's proposals — judging a change set (Calliope Live, Spec J
 * decisions 7 and 8).
 *
 * `judgeChangeSet` applies a change set to a draft and runs everything the
 * engine would say about the result — validation (schemas, registry names,
 * the type check, references and cycles, the scoper over the stylesheet),
 * the hook lint over the stylesheet, and contrast — on the draft before and
 * after, and returns what the change *introduces* (present after, not before)
 * beside what it *removes*. A proposal that cannot be applied, or that
 * introduces an error, is not one to show the author; one that introduces
 * only warnings is shown with them.
 *
 * Issues are compared by message with line numbers taken out, so a passage
 * that moves down the stylesheet is not counted as new.
 *
 * Server-side: validation scopes the stylesheet with PostCSS, and the
 * validation context reads the icon and subsystem registries.
 *
 * @module themes/assist/judge
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { HOOK_CATALOGUE } from '../hooks';
import { lintThemeSelectors } from '../hooks/lint';
import { checkContrast, compileTheme, resolveTheme, validateThemeDocument, type ContrastFinding, type ThemeTokensDocument } from '../engine';
import { THEME_REGISTRY_VIEW, validationContextFor } from '../theme-bundle';
import { applyChangeSet, type ChangeSet, type ChangeTarget } from './change-set';

const logger = createServiceLogger('CalliopeJudge');

/** A draft as the judge needs it. */
export interface JudgeInput extends ChangeTarget {
  /** The parsed theme.json (anything; a broken manifest is judged as it is). */
  manifest: unknown;
  /** Every file in the draft, bundle-relative. */
  files: Iterable<string>;
}

export interface JudgedIssue {
  severity: 'error' | 'warning';
  /** Where it comes from: validation (incl. the type check and the scoper), the hook lint. */
  source: 'validation' | 'hooks';
  message: string;
  /** Line in the stylesheet, when the issue is in it. */
  line?: number;
}

/** One contrast pair in one mode, before and after. */
export interface ContrastChange {
  foreground: string;
  background: string;
  kind: string;
  mode: 'light' | 'dark';
  threshold: number;
  before: { status: ContrastFinding['status']; ratio?: number };
  after: { status: ContrastFinding['status']; ratio?: number; reason?: string };
}

export type ChangeSetJudgement =
  | { ok: false; stage: 'apply'; index: number; reason: string }
  | {
      ok: true;
      tokens: ThemeTokensDocument;
      css: string | null;
      tokensChanged: boolean;
      cssChanged: boolean;
      /** Errors the change brings in: any one keeps the proposal from the author. */
      introducedErrors: JudgedIssue[];
      /** Warnings the change brings in (hook findings and such); contrast is apart. */
      introducedWarnings: JudgedIssue[];
      /** Issues present before and gone after. */
      removed: JudgedIssue[];
      /** Pairs that fail (or can no longer be checked) after and did not before. */
      contrastWorse: ContrastChange[];
      /** Pairs that failed before and pass after. */
      contrastFixed: ContrastChange[];
      /** No error introduced: the proposal may be shown. */
      acceptable: boolean;
    };

/** An issue's identity for before/after comparison: its message without line numbers. */
export function issueKey(issue: Pick<JudgedIssue, 'source' | 'message'>): string {
  const message = issue.message
    .replace(/\(line \d+\)/g, '(line)')
    .replace(/\bline \d+\b/g, 'line')
    .replace(/(\.css):\d+:/g, '$1:');
  return `${issue.source}\u0000${message}`;
}

/**
 * The manifest and files as they will be once a stylesheet is kept: a
 * stylesheet the draft does not have yet is named by the manifest and present
 * in the bundle.
 */
function asKept(manifest: unknown, files: ReadonlySet<string>, css: string | null): { manifest: unknown; files: ReadonlySet<string> } {
  if (css === null || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { manifest, files };
  const m = manifest as Record<string, unknown>;
  const stylesPath = typeof m.stylesPath === 'string' && m.stylesPath !== '' ? m.stylesPath : 'styles.css';
  return {
    manifest: m.stylesPath === stylesPath ? m : { ...m, stylesPath },
    files: files.has(stylesPath) ? files : new Set([...files, stylesPath]),
  };
}

/**
 * The custom stylesheet as the draft's preview would wear it once `tokens`
 * and `css` are kept: validated and scoped by the same engine path as a saved
 * draft (`validateThemeDocument` → `compileTheme`). Null when the result does
 * not validate — the preview then keeps what it has.
 */
export function compileKeptCustomCss(input: JudgeInput, tokens: ThemeTokensDocument, css: string | null): string | null {
  const kept = asKept(input.manifest, new Set(input.files), css);
  const result = validateThemeDocument({ manifest: kept.manifest, tokens, css: css ?? undefined }, validationContextFor(kept.files));
  if (!result.valid) {
    logger.debug('Kept result does not validate; nothing to compile', { errors: result.errors.length });
    return null;
  }
  return compileTheme(result.document, result.scopedCss, THEME_REGISTRY_VIEW).css.custom;
}

function evaluate(input: { manifest: unknown; tokens: ThemeTokensDocument; css: string | null; files: ReadonlySet<string> }): JudgedIssue[] {
  const { manifest, files } = asKept(input.manifest, input.files, input.css);
  const issues: JudgedIssue[] = [];
  const result = validateThemeDocument({ manifest, tokens: input.tokens, css: input.css ?? undefined }, validationContextFor(files));
  for (const e of result.errorIssues) issues.push({ severity: 'error', source: 'validation', message: e.message, ...(e.line ? { line: e.line } : {}) });
  // Contrast lines are compared pair by pair below, not as messages.
  for (const w of result.warningIssues) if (!w.message.startsWith('contrast (')) issues.push({ severity: 'warning', source: 'validation', message: w.message, ...(w.line ? { line: w.line } : {}) });
  if (input.css !== null && input.css.trim() !== '') {
    try {
      for (const f of lintThemeSelectors(input.css, HOOK_CATALOGUE)) {
        issues.push({ severity: 'warning', source: 'hooks', message: `${f.selector} — ${f.reasons.map((r) => r.message).join('; ')}`, line: f.line });
      }
    } catch {
      // A stylesheet that does not parse is already a validation error.
    }
  }
  return issues;
}

const pairKey = (f: ContrastFinding) => `${f.pair.foreground}\u0000${f.pair.background}\u0000${f.mode}`;

function contrastOf(tokens: ThemeTokensDocument): Map<string, ContrastFinding> {
  return new Map(checkContrast(resolveTheme(tokens, THEME_REGISTRY_VIEW)).map((f) => [pairKey(f), f]));
}

/** Judge `changeSet` against the draft `input` (decision 8). Pure apart from the debug log. */
export function judgeChangeSet(input: JudgeInput, changeSet: Pick<ChangeSet, 'operations'>): ChangeSetJudgement {
  const applied = applyChangeSet(input, changeSet);
  if (!applied.ok) {
    logger.debug('Change set does not apply', { index: applied.index, op: applied.operation.op, reason: applied.reason });
    return { ok: false, stage: 'apply', index: applied.index, reason: applied.reason };
  }
  const files = new Set(input.files);
  const before = evaluate({ manifest: input.manifest, tokens: input.tokens, css: input.css, files });
  const after = evaluate({ manifest: input.manifest, tokens: applied.tokens, css: applied.css, files });
  const beforeKeys = new Set(before.map(issueKey));
  const afterKeys = new Set(after.map(issueKey));
  const introduced = after.filter((i) => !beforeKeys.has(issueKey(i)));
  const removed = before.filter((i) => !afterKeys.has(issueKey(i)));

  const contrastBefore = contrastOf(input.tokens);
  const contrastWorse: ContrastChange[] = [];
  const contrastFixed: ContrastChange[] = [];
  for (const [key, a] of contrastOf(applied.tokens)) {
    const b = contrastBefore.get(key);
    const change: ContrastChange = {
      foreground: a.pair.foreground,
      background: a.pair.background,
      kind: a.pair.kind,
      mode: a.mode,
      threshold: a.threshold,
      before: { status: b?.status ?? 'unchecked', ...(b?.ratio !== undefined ? { ratio: b.ratio } : {}) },
      after: { status: a.status, ...(a.ratio !== undefined ? { ratio: a.ratio } : {}), ...(a.reason ? { reason: a.reason } : {}) },
    };
    if (a.status !== 'pass' && b?.status === 'pass') contrastWorse.push(change);
    else if (a.status === 'fail' && b?.status === 'unchecked') contrastWorse.push(change);
    else if (a.status === 'pass' && b?.status === 'fail') contrastFixed.push(change);
  }

  const introducedErrors = introduced.filter((i) => i.severity === 'error');
  const introducedWarnings = introduced.filter((i) => i.severity === 'warning');
  logger.debug('Judged change set', {
    operations: changeSet.operations.length,
    introducedErrors: introducedErrors.length,
    introducedWarnings: introducedWarnings.length,
    removed: removed.length,
    contrastWorse: contrastWorse.length,
    contrastFixed: contrastFixed.length,
  });
  return {
    ok: true,
    tokens: applied.tokens,
    css: applied.css,
    tokensChanged: applied.tokensChanged,
    cssChanged: applied.cssChanged,
    introducedErrors,
    introducedWarnings,
    removed,
    contrastWorse,
    contrastFixed,
    acceptable: introducedErrors.length === 0,
  };
}
