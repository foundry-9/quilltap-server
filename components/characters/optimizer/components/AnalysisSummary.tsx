'use client';

/**
 * AnalysisSummary
 *
 * Displays the behavioral pattern analysis derived from a character's
 * accumulated memories. Presents the AI's findings in a readable,
 * structured format before the suggestion review commences.
 */

import { Icon } from '@/components/ui/icon';
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
          <Icon name="shield" className="w-4 h-4 text-primary flex-shrink-0" />
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
