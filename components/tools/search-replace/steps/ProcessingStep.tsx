'use client';

/**
 * ProcessingStep Component
 *
 * Step 4: Show progress during execution.
 */

interface ProcessingStepProps {
  phase: string;
}

export function ProcessingStep({ phase }: ProcessingStepProps) {

  return (
    <div className="space-y-6 py-8">
      <div className="flex flex-col items-center justify-center">
        {/* Spinner */}
        <div className="w-12 h-12 border-4 qt-border-primary/20 border-t-primary rounded-full animate-spin mb-6" />

        <h3 className="qt-text-primary text-lg font-medium mb-2">
          Processing...
        </h3>

        <p className="qt-text-secondary text-sm text-center">
          {phase || 'Please wait while changes are being applied.'}
        </p>
      </div>

      <div className="text-center">
        <p className="text-xs qt-text-secondary">
          Do not close this window until the operation completes.
        </p>
      </div>
    </div>
  );
}
