'use client';

/**
 * AnalysisSummary
 *
 * Displays the behavioral pattern analysis derived from a character's
 * accumulated memories. Presents the AI's findings in a readable,
 * structured format before the suggestion review commences.
 */

import type { OptimizerAnalysis, BehavioralPattern } from '../types';

interface AnalysisSummaryProps {
  analysis: OptimizerAnalysis;
  memoryCount: number;
}

function FrequencyBadge({ frequency }: { frequency: string }) {
  const normalized = (frequency ?? '').toLowerCase();
  let badgeClass = 'qt-badge-secondary';

  if (normalized.includes('often') || normalized.includes('frequent') || normalized.includes('always') || normalized.includes('consistent')) {
    badgeClass = 'qt-badge-info';
  } else if (normalized.includes('occasion') || normalized.includes('sometimes') || normalized.includes('moderate')) {
    badgeClass = 'qt-badge-warning';
  } else if (normalized.includes('rare') || normalized.includes('seldom') || normalized.includes('infreq')) {
    badgeClass = 'qt-badge-outline';
  }

  return (
    <span className={`${badgeClass} flex-shrink whitespace-normal text-left`}>
      {frequency}
    </span>
  );
}

function PatternEntry({ pattern }: { pattern: BehavioralPattern }) {
  return (
    <div className="qt-card p-3 flex flex-col gap-1.5 overflow-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-foreground leading-snug">{pattern.pattern}</span>
        <FrequencyBadge frequency={pattern.frequency} />
      </div>
      <p className="text-xs italic qt-text-secondary leading-relaxed">{pattern.evidence}</p>
    </div>
  );
}

export function AnalysisSummary({ analysis, memoryCount }: AnalysisSummaryProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Header card */}
      <div className="qt-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <h3 className="qt-section-title text-sm">Analysis Complete</h3>
          <span className="qt-badge-info ml-auto">
            {memoryCount} {memoryCount === 1 ? 'memory' : 'memories'} consulted
          </span>
        </div>
        <p className="qt-body text-sm leading-relaxed">{analysis.summary}</p>
      </div>

      {/* Behavioral patterns */}
      {analysis.behavioralPatterns.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="qt-label text-xs uppercase tracking-wider qt-text-secondary">
            Observed Behavioural Tendencies
          </h4>
          <div className="flex flex-col gap-2">
            {analysis.behavioralPatterns.map((pattern, idx) => (
              <PatternEntry key={idx} pattern={pattern} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
