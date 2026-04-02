'use client';

/**
 * ProgressBar
 *
 * An animated three-segment progress bar for the Character Optimizer,
 * corresponding to the three stages of refinement: loading, analyzing,
 * and generating. Each segment fills over an estimated duration while
 * active, and an elapsed timer ticks below.
 */

import { useEffect, useState, useRef } from 'react';

interface ProgressBarProps {
  currentStep: string | null;
  startedAt: number | null;
}

interface SegmentConfig {
  key: string;
  label: string;
  estimatedDurationMs: number;
}

const SEGMENTS: SegmentConfig[] = [
  { key: 'loading', label: 'Retrieving', estimatedDurationMs: 3000 },
  { key: 'analyzing', label: 'Analysing', estimatedDurationMs: 15000 },
  { key: 'generating', label: 'Composing', estimatedDurationMs: 20000 },
];

const STEP_ORDER = ['loading', 'analyzing', 'generating'];

function getStepIndex(step: string | null): number {
  if (!step) return -1;
  return STEP_ORDER.indexOf(step);
}

export function ProgressBar({ currentStep, startedAt }: ProgressBarProps) {
  const [fillPercents, setFillPercents] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepStartTimeRef = useRef<Record<string, number>>({});

  const currentStepIndex = getStepIndex(currentStep);

  // Track when each step starts
  useEffect(() => {
    if (currentStep && !stepStartTimeRef.current[currentStep]) {
      stepStartTimeRef.current[currentStep] = Date.now();
    }
  }, [currentStep]);

  // Animate fill percentages
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const now = Date.now();

      const isDone = currentStep === null && startedAt !== null;

      setFillPercents(() => {
        const next: Record<string, number> = {};
        for (const seg of SEGMENTS) {
          if (isDone) {
            // All segments complete
            next[seg.key] = 100;
          } else {
            const segIndex = getStepIndex(seg.key);
            if (segIndex < currentStepIndex) {
              // Completed segment
              next[seg.key] = 100;
            } else if (segIndex === currentStepIndex) {
              // Active segment — animate from 0 to ~90%
              const startTime = stepStartTimeRef.current[seg.key] ?? now;
              const elapsed = now - startTime;
              const progress = Math.min(elapsed / seg.estimatedDurationMs, 0.9) * 100;
              next[seg.key] = progress;
            } else {
              // Inactive segment
              next[seg.key] = 0;
            }
          }
        }
        return next;
      });

      // Update elapsed timer
      if (startedAt) {
        setElapsed(Math.floor((now - startedAt) / 1000));
      }
    }, 500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [currentStep, currentStepIndex, startedAt]);

  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Three-segment bar */}
      <div className="flex gap-1 h-2 rounded-full overflow-hidden qt-bg-muted">
        {SEGMENTS.map((seg) => {
          const fill = fillPercents[seg.key] ?? 0;
          const segIndex = getStepIndex(seg.key);
          const isActive = segIndex === currentStepIndex;
          const isDone = segIndex < currentStepIndex || (currentStep === null && startedAt);

          return (
            <div
              key={seg.key}
              className="flex-1 rounded-full overflow-hidden qt-bg-muted"
              title={seg.label}
            >
              <div
                className={`h-full transition-all duration-500 ease-out rounded-full ${
                  isDone ? 'bg-green-500' : isActive ? 'bg-primary' : 'bg-transparent'
                }`}
                style={{ width: `${fill}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Labels row */}
      <div className="flex justify-between">
        <div className="flex gap-1">
          {SEGMENTS.map((seg) => {
            const segIndex = getStepIndex(seg.key);
            const isActive = segIndex === currentStepIndex;
            const isDone = segIndex < currentStepIndex || (currentStep === null && startedAt);
            return (
              <span
                key={seg.key}
                className={`text-[10px] ${
                  isActive ? 'text-primary font-medium' : isDone ? 'qt-text-success' : 'qt-text-secondary'
                }`}
              >
                {seg.label}
              </span>
            );
          })}
        </div>
        {startedAt && (
          <span className="text-[10px] qt-text-secondary tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}
