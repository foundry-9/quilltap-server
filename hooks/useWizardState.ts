'use client'

import { useCallback, useMemo } from 'react'

/**
 * Configuration for a wizard step
 */
export interface WizardStepConfig<TStep extends string> {
  /** Steps that can be reached from this step via goNext */
  next?: TStep[]
  /** Step to go back to via goBack */
  prev?: TStep
  /** Whether this is a terminal step (complete, error) */
  isTerminal?: boolean
}

/**
 * Options for configuring the useWizardState hook
 */
export interface UseWizardStateOptions<TStep extends string> {
  /** The initial step when the wizard starts */
  initialStep: TStep
  /** Step configuration defining transitions */
  steps: Record<TStep, WizardStepConfig<TStep>>
  /** Callback when step changes */
  onStepChange?: (from: TStep, to: TStep) => void
}

/**
 * Result type returned by the useWizardState hook
 */
export interface UseWizardStateResult<TStep extends string> {
  /** Go to the next step - requires specifying which next step if multiple options */
  goNext: (targetStep?: TStep) => void
  /** Go to the previous step */
  goBack: () => void
  /** Go to a specific step directly */
  goTo: (step: TStep) => void
  /** Whether the wizard can go back from the current step */
  canGoBack: boolean
  /** Whether the wizard can go forward from the current step */
  canGoNext: boolean
  /** Whether the current step is a terminal step */
  isTerminal: boolean
  /** Reset to the initial step */
  resetStep: () => void
  /** Get the previous step for a given step */
  getPrevStep: (step: TStep) => TStep | undefined
  /** Get the next steps for a given step */
  getNextSteps: (step: TStep) => TStep[]
}

/**
 * Hook to manage wizard/multi-step dialog navigation.
 *
 * This hook handles step transitions for wizard-style dialogs, with support for:
 * - Linear and branching step flows
 * - Previous/next navigation
 * - Terminal states (complete, error)
 *
 * Use this with useDialogState for full dialog state management.
 * The step should be part of your dialog state.
 *
 * @param options - Configuration for the wizard
 * @param currentStep - The current step value from your state
 * @param setStep - Function to update the step in your state
 *
 * @example
 * type ExportStep = 'type' | 'select' | 'options' | 'exporting' | 'complete' | 'error'
 *
 * const { state, setState } = useDialogState<ExportState>({
 *   isOpen,
 *   initialState: { step: 'type', ... },
 *   logContext: 'useExportData',
 * })
 *
 * const wizard = useWizardState<ExportStep>(
 *   {
 *     initialStep: 'type',
 *     steps: {
 *       type: { next: ['select'] },
 *       select: { prev: 'type', next: ['options', 'exporting'] },
 *       options: { prev: 'select', next: ['exporting'] },
 *       exporting: { next: ['complete', 'error'] },
 *       complete: { isTerminal: true },
 *       error: { prev: 'options', isTerminal: true },
 *     },
 *   },
 *   state.step,
 *   (step) => setState((prev) => ({ ...prev, step }))
 * )
 *
 * // Navigate
 * wizard.goNext()           // Goes to first 'next' option
 * wizard.goNext('options')  // Goes to specific step
 * wizard.goBack()           // Goes to 'prev' step
 */
export function useWizardState<TStep extends string>(
  options: UseWizardStateOptions<TStep>,
  currentStep: TStep,
  setStep: (step: TStep) => void
): UseWizardStateResult<TStep> {
  const { initialStep, steps, onStepChange } = options

  const stepConfig = steps[currentStep]

  const canGoBack = stepConfig?.prev !== undefined
  const canGoNext = (stepConfig?.next?.length ?? 0) > 0
  const isTerminal = stepConfig?.isTerminal ?? false

  const goTo = useCallback(
    (step: TStep) => {
      const prevStep = currentStep
      setStep(step)
      onStepChange?.(prevStep, step)
    },
    [currentStep, setStep, onStepChange]
  )

  const goNext = useCallback(
    (targetStep?: TStep) => {
      const nextSteps = stepConfig?.next
      if (!nextSteps || nextSteps.length === 0) {
        return
      }

      // If target specified, validate it's in the allowed next steps
      if (targetStep) {
        if (!nextSteps.includes(targetStep)) {
          return
        }
        goTo(targetStep)
      } else {
        // Default to first next step
        goTo(nextSteps[0])
      }
    },
    [stepConfig, goTo]
  )

  const goBack = useCallback(() => {
    const prevStep = stepConfig?.prev
    if (!prevStep) {
      return
    }
    goTo(prevStep)
  }, [stepConfig, goTo])

  const resetStep = useCallback(() => {
    setStep(initialStep)
  }, [initialStep, setStep])

  const getPrevStep = useCallback(
    (step: TStep): TStep | undefined => {
      return steps[step]?.prev
    },
    [steps]
  )

  const getNextSteps = useCallback(
    (step: TStep): TStep[] => {
      return steps[step]?.next ?? []
    },
    [steps]
  )

  return useMemo(
    () => ({
      goNext,
      goBack,
      goTo,
      canGoBack,
      canGoNext,
      isTerminal,
      resetStep,
      getPrevStep,
      getNextSteps,
    }),
    [goNext, goBack, goTo, canGoBack, canGoNext, isTerminal, resetStep, getPrevStep, getNextSteps]
  )
}
