/**
 * Calliope's proposals — a change set judged against a draft, and what each
 * side hears of it (Calliope Live, Spec J §2.2, decision 8).
 *
 * `assessProposal` is the one place a proposal is judged for a draft: the
 * `theme_propose` tool calls it when she proposes, the conversation's reader
 * calls it to annotate a stored proposal (and to tell it is stale), and the
 * keep action calls it before handing the operations to the editor. A
 * proposal is **offered** when it applies, changes something and brings in
 * no error; otherwise it is **refused**, with a reason for her and nothing
 * for the author.
 *
 * The draft revision recorded with an offered proposal is the pair of content
 * hashes (tokens, stylesheet) it was judged against, so a reader can say the
 * draft changed since without re-reading history.
 *
 * Pure apart from the judge's debug log. Server-side (the judge pulls PostCSS).
 *
 * @module themes/assist/proposal
 */

import { describeChangeSet, changeLineText, type ChangeLine, type ChangeSet, type ChangeTarget } from './change-set';
import { compileKeptCustomCss, judgeChangeSet, type ContrastChange, type JudgeInput, type JudgedIssue } from './judge';
import { applyChangeSet } from './change-set';
import type { ThemeTokensDocument } from '../engine/client';

/** The parts of a draft's detail a proposal is judged against (a structural subset of `DraftDetail`). */
export interface ProposalDraftSource {
  manifest: Record<string, unknown> | null;
  tokens: ThemeTokensDocument | null;
  revision: string;
  styles: { text: string; revision: string } | null;
  files: ReadonlyArray<{ path: string }>;
}

const EMPTY_TOKENS: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} };

/** The draft as the judge reads it. */
export function judgeInputFrom(draft: ProposalDraftSource): JudgeInput {
  return {
    manifest: draft.manifest,
    tokens: draft.tokens ?? EMPTY_TOKENS,
    css: draft.styles ? draft.styles.text : null,
    files: draft.files.map((f) => f.path),
  };
}

/** The tokens and stylesheet content hashes, as one string. */
export function draftRevisionOf(draft: Pick<ProposalDraftSource, 'revision' | 'styles'>): string {
  return `${draft.revision}+${draft.styles ? draft.styles.revision : 'none'}`;
}

/** What the author is shown of an offered proposal. */
export interface ProposalReview {
  /** Each operation in words, before and after. */
  lines: ChangeLine[];
  /** Warnings it brings in (a hook finding and such). */
  warnings: JudgedIssue[];
  /** Issues it clears. */
  removed: JudgedIssue[];
  /** Contrast pairs it breaks, and pairs it mends. */
  contrastWorse: ContrastChange[];
  contrastFixed: ContrastChange[];
  tokensChanged: boolean;
  cssChanged: boolean;
}

export type ProposalAssessment =
  | { verdict: 'offered'; review: ProposalReview; draftRevision: string }
  | { verdict: 'refused'; reason: string };

/** Judge `set` against `draft`: offered (with what the author sees) or refused (with why). */
export function assessProposal(draft: ProposalDraftSource, set: Pick<ChangeSet, 'operations'>): ProposalAssessment {
  const input = judgeInputFrom(draft);
  const judgement = judgeChangeSet(input, set);
  if (!judgement.ok) {
    return { verdict: 'refused', reason: `Operation ${judgement.index + 1} does not apply: ${judgement.reason}` };
  }
  if (!judgement.tokensChanged && !judgement.cssChanged) {
    return { verdict: 'refused', reason: 'It changes nothing: the draft already reads that way.' };
  }
  if (!judgement.acceptable) {
    const errors = judgement.introducedErrors.map(issueText);
    return { verdict: 'refused', reason: `It would bring in ${errors.length === 1 ? 'an error' : `${errors.length} errors`}:\n${errors.map((e) => `- ${e}`).join('\n')}` };
  }
  const target: ChangeTarget = { tokens: input.tokens, css: input.css };
  return {
    verdict: 'offered',
    draftRevision: draftRevisionOf(draft),
    review: {
      lines: describeChangeSet(target, set),
      warnings: judgement.introducedWarnings,
      removed: judgement.removed,
      contrastWorse: judgement.contrastWorse,
      contrastFixed: judgement.contrastFixed,
      tokensChanged: judgement.tokensChanged,
      cssChanged: judgement.cssChanged,
    },
  };
}

/** A proposal's result for the preview: the tokens it leaves, and the custom CSS compiled and scoped. */
export type ProposalPreview =
  | { ok: true; tokens: ThemeTokensDocument; css: string | null; custom: string }
  | { ok: false; reason: string };

/**
 * What the draft would wear with `set` kept, for **Try**: the change applied
 * to the draft as it is now and the stylesheet compiled by the same validator
 * and scoper as a saved draft's — never by the browser. Refused when the
 * proposal no longer applies or its result does not validate.
 */
export function previewProposal(draft: ProposalDraftSource, set: Pick<ChangeSet, 'operations'>): ProposalPreview {
  const input = judgeInputFrom(draft);
  const applied = applyChangeSet(input, set);
  if (!applied.ok) return { ok: false, reason: `Operation ${applied.index + 1} does not apply: ${applied.reason}` };
  const custom = compileKeptCustomCss(input, applied.tokens, applied.css);
  if (custom === null) return { ok: false, reason: 'Its result does not validate against the draft as it is now.' };
  return { ok: true, tokens: applied.tokens, css: applied.css, custom };
}

function issueText(issue: JudgedIssue): string {
  return issue.line ? `${issue.message} (line ${issue.line})` : issue.message;
}

function contrastText(change: ContrastChange): string {
  const ratio = (r?: number) => (r === undefined ? 'not checkable' : `${r}:1`);
  return `${change.foreground} on ${change.background} (${change.mode}, needs ${change.threshold}:1): ${ratio(change.before.ratio)} → ${ratio(change.after.ratio)}${change.after.reason ? ` — ${change.after.reason}` : ''}`;
}

/** What Calliope hears back from `theme_propose`. */
export function renderProposalAssessment(title: string, assessment: ProposalAssessment): string {
  if (assessment.verdict === 'refused') {
    return `Not shown to the author. ${assessment.reason}\nRead the draft or look the names up, then propose again.`;
  }
  const { review } = assessment;
  const out = [`"${title}" is before the author, who will keep or discard it. The draft is unchanged until they keep it.`, '', 'It does:'];
  for (const line of review.lines) out.push(`- ${changeLineText(line)}`);
  if (review.contrastWorse.length > 0) {
    out.push('', 'Contrast it breaks (the author is shown these):');
    for (const c of review.contrastWorse) out.push(`- ${contrastText(c)}`);
  }
  if (review.warnings.length > 0) {
    out.push('', 'Warnings it brings in (the author is shown these):');
    for (const w of review.warnings) out.push(`- ${issueText(w)}`);
  }
  if (review.contrastFixed.length > 0) {
    out.push('', 'Contrast it mends:');
    for (const c of review.contrastFixed) out.push(`- ${contrastText(c)}`);
  }
  if (review.removed.length > 0) {
    out.push('', 'Issues it clears:');
    for (const r of review.removed) out.push(`- ${issueText(r)}`);
  }
  return out.join('\n');
}
