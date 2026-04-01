'use client';

/**
 * SuggestionCard
 *
 * Presents a single proposed refinement to the character for review.
 * The discerning author may accept, reject, or amend each suggestion
 * as they see fit, guided by excerpts from the character's own memoirs.
 */

import { useState } from 'react';
import type { OptimizerSuggestion, SuggestionDecision } from '../types';

interface SuggestionCardProps {
  suggestion: OptimizerSuggestion;
  decision?: SuggestionDecision;
  editedValue?: string;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (value: string) => void;
  index: number;
  total: number;
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  personality: 'Personality',
  scenarios: 'Scenario',
  exampleDialogues: 'Example Dialogues',
  firstMessage: 'First Message',
  systemPrompt: 'System Prompt',
  systemPrompts: 'System Prompt',
  physicalDescriptions: 'Physical Description',
  clothingRecords: 'Attire Record',
  title: 'Title',
};

const FIELD_BADGE_CLASS: Record<string, string> = {
  description: 'qt-badge-secondary',
  personality: 'qt-badge-character',
  scenarios: 'qt-badge-project',
  exampleDialogues: 'qt-badge-chat',
  firstMessage: 'qt-badge-message',
  systemPrompt: 'qt-badge-memory',
  systemPrompts: 'qt-badge-memory',
  physicalDescriptions: 'qt-badge-persona',
  clothingRecords: 'qt-badge-tag',
  title: 'qt-badge-primary',
};

function SignificanceBar({ significance }: { significance: number }) {
  const level = significance >= 0.6 ? 'high' : significance >= 0.3 ? 'medium' : 'low';
  const label = level === 'high' ? 'High Significance' : level === 'medium' ? 'Moderate Significance' : 'Minor Significance';
  const barClass = level === 'high' ? 'bg-destructive' : level === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground';
  const barWidth = level === 'high' ? 'w-full' : level === 'medium' ? 'w-2/3' : 'w-1/3';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${barWidth} ${barClass} rounded-full transition-all`} />
      </div>
      <span className="qt-caption">{label}</span>
    </div>
  );
}

function MemoryExcerpts({ excerpts }: { excerpts: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (excerpts.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 qt-caption hover:text-foreground transition-colors w-full text-left"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>
          {expanded ? 'Conceal' : 'Consult'} the memoirs ({excerpts.length}{' '}
          {excerpts.length === 1 ? 'excerpt' : 'excerpts'})
        </span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {excerpts.map((excerpt, idx) => (
            <blockquote
              key={idx}
              className="border-l-2 border-primary/40 pl-3 py-1 qt-body-sm italic text-muted-foreground leading-relaxed"
            >
              &ldquo;{excerpt}&rdquo;
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

export function SuggestionCard({
  suggestion,
  decision,
  editedValue,
  onAccept,
  onReject,
  onEdit,
  index,
  total,
}: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(editedValue ?? suggestion.proposedValue);

  const fieldLabel = FIELD_LABELS[suggestion.field] ?? suggestion.field;
  const fieldBadge = FIELD_BADGE_CLASS[suggestion.field] ?? 'qt-badge-secondary';
  const displayLabel = suggestion.subName ? `${fieldLabel}: ${suggestion.subName}` : fieldLabel;

  const handleEditAccept = () => {
    onEdit(draftValue);
    setEditing(false);
  };

  const handleStartEdit = () => {
    setDraftValue(editedValue ?? suggestion.proposedValue);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setDraftValue(editedValue ?? suggestion.proposedValue);
  };

  const isAccepted = decision === 'accepted';
  const isRejected = decision === 'rejected';
  const isEdited = decision === 'edited';

  return (
    <div className={`qt-card flex flex-col gap-4 ${isAccepted || isEdited ? 'border-green-500/40' : isRejected ? 'border-destructive/30 opacity-75' : ''}`}>
      {/* Header: field badge + progress */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`${fieldBadge} text-xs`}>{displayLabel}</span>
        <span className="qt-caption">
          Proposal {index + 1} of {total}
        </span>
      </div>

      {/* Significance bar */}
      <SignificanceBar significance={suggestion.significance} />

      {/* Current vs proposed */}
      {!editing ? (
        <div className="flex flex-col gap-3">
          {suggestion.currentValue ? (
            <div className="flex flex-col gap-1">
              <span className="qt-caption uppercase tracking-wider">Present Wording</span>
              <p className="qt-body-sm bg-muted/50 rounded-md p-3 leading-relaxed border border-border/50">
                {suggestion.currentValue}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="qt-caption uppercase tracking-wider">Present Wording</span>
              <p className="qt-body-sm italic text-muted-foreground bg-muted/30 rounded-md p-3 border border-dashed border-border">
                (This field is presently unoccupied — the suggestion would furnish it anew)
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="qt-caption uppercase tracking-wider text-primary/70">
              {isEdited ? 'Your Amended Wording' : 'Proposed Refinement'}
            </span>
            <p className={`qt-body-sm rounded-md p-3 leading-relaxed border ${
              isEdited
                ? 'bg-primary/5 border-primary/30'
                : 'bg-green-500/5 border-green-500/20'
            }`}>
              {isEdited && editedValue ? editedValue : suggestion.proposedValue}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          <span className="qt-caption uppercase tracking-wider">Amend the Proposed Wording</span>
          <textarea
            className="qt-textarea text-sm min-h-[120px] flex-1 resize-none"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={handleCancelEdit} className="qt-button-ghost qt-button-sm">
              Abandon Edits
            </button>
            <button type="button" onClick={handleEditAccept} className="qt-button-primary qt-button-sm">
              Accept Amended Version
            </button>
          </div>
        </div>
      )}

      {/* Rationale */}
      {!editing && (
        <div className="flex flex-col gap-1">
          <span className="qt-caption uppercase tracking-wider">Rationale</span>
          <p className="qt-body-sm text-muted-foreground leading-relaxed">{suggestion.rationale}</p>
        </div>
      )}

      {/* Memory excerpts */}
      {!editing && <MemoryExcerpts excerpts={suggestion.memoryExcerpts} />}

      {/* Action buttons */}
      {!editing && (
        <div className="flex gap-2 flex-wrap pt-1 border-t border-border">
          {!isAccepted && !isEdited && (
            <button
              type="button"
              onClick={onAccept}
              className="qt-button-success qt-button-sm flex-1 min-w-[80px]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Accept
            </button>
          )}
          {(isAccepted || isEdited) && (
            <button
              type="button"
              onClick={onAccept}
              className="qt-button-ghost qt-button-sm flex-1 min-w-[80px] qt-text-success"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {isEdited ? 'Accepted (Edited)' : 'Accepted'}
            </button>
          )}

          {!isRejected && (
            <button
              type="button"
              onClick={onReject}
              className="qt-button-destructive qt-button-sm flex-1 min-w-[80px]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reject
            </button>
          )}
          {isRejected && (
            <button
              type="button"
              onClick={onAccept}
              className="qt-button-ghost qt-button-sm flex-1 min-w-[80px] text-destructive"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Rejected
            </button>
          )}

          <button
            type="button"
            onClick={handleStartEdit}
            className="qt-button-secondary qt-button-sm flex-1 min-w-[80px]"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit &amp; Accept
          </button>
        </div>
      )}
    </div>
  );
}
