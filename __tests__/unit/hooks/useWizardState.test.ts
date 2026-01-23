/**
 * Unit tests for useWizardState hook
 * Tests wizard/multi-step dialog navigation
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { renderHook, act } from '@testing-library/react'
import { useWizardState, WizardStepConfig } from '@/hooks/useWizardState'

type TestStep = 'start' | 'middle' | 'branch1' | 'branch2' | 'end' | 'error'

describe('useWizardState', () => {
  const basicSteps: Record<TestStep, WizardStepConfig<TestStep>> = {
    start: { next: ['middle'] },
    middle: { prev: 'start', next: ['end'] },
    end: { prev: 'middle', isTerminal: true },
    branch1: {},
    branch2: {},
    error: { isTerminal: true },
  }

  describe('initialization', () => {
    it('should return all required methods and properties', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      expect(result.current.goNext).toBeDefined()
      expect(result.current.goBack).toBeDefined()
      expect(result.current.goTo).toBeDefined()
      expect(result.current.canGoBack).toBe(false)
      expect(result.current.canGoNext).toBe(true)
      expect(result.current.isTerminal).toBe(false)
      expect(result.current.resetStep).toBeDefined()
      expect(result.current.getPrevStep).toBeDefined()
      expect(result.current.getNextSteps).toBeDefined()
    })

    it('should correctly identify terminal steps', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'end', setStep)
      )

      expect(result.current.isTerminal).toBe(true)
    })
  })

  describe('canGoBack and canGoNext', () => {
    it('should return false for canGoBack when no prev step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      expect(result.current.canGoBack).toBe(false)
    })

    it('should return true for canGoBack when prev step exists', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'middle', setStep)
      )

      expect(result.current.canGoBack).toBe(true)
    })

    it('should return false for canGoNext when no next steps', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'branch1', setStep)
      )

      expect(result.current.canGoNext).toBe(false)
    })

    it('should return true for canGoNext when next steps exist', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      expect(result.current.canGoNext).toBe(true)
    })
  })

  describe('goNext', () => {
    it('should navigate to next step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      act(() => {
        result.current.goNext()
      })

      expect(setStep).toHaveBeenCalledWith('middle')
    })

    it('should navigate to first next step when multiple options', () => {
      const multiSteps: Record<TestStep, WizardStepConfig<TestStep>> = {
        ...basicSteps,
        start: { next: ['branch1', 'branch2'] },
      }

      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: multiSteps }, 'start', setStep)
      )

      act(() => {
        result.current.goNext()
      })

      expect(setStep).toHaveBeenCalledWith('branch1')
    })

    it('should navigate to specific next step when specified', () => {
      const multiSteps: Record<TestStep, WizardStepConfig<TestStep>> = {
        ...basicSteps,
        start: { next: ['branch1', 'branch2'] },
      }

      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: multiSteps }, 'start', setStep)
      )

      act(() => {
        result.current.goNext('branch2')
      })

      expect(setStep).toHaveBeenCalledWith('branch2')
    })

    it('should not navigate when target step is not in next options', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      act(() => {
        result.current.goNext('error' as any)
      })

      expect(setStep).not.toHaveBeenCalled()
    })

    it('should not navigate when no next steps', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'branch1', setStep)
      )

      act(() => {
        result.current.goNext()
      })

      expect(setStep).not.toHaveBeenCalled()
    })

    it('should call onStepChange callback', () => {
      const setStep = jest.fn()
      const onStepChange = jest.fn()

      const { result } = renderHook(() =>
        useWizardState(
          { initialStep: 'start', steps: basicSteps, onStepChange },
          'start',
          setStep
        )
      )

      act(() => {
        result.current.goNext()
      })

      expect(onStepChange).toHaveBeenCalledWith('start', 'middle')
    })
  })

  describe('goBack', () => {
    it('should navigate to previous step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'middle', setStep)
      )

      act(() => {
        result.current.goBack()
      })

      expect(setStep).toHaveBeenCalledWith('start')
    })

    it('should not navigate when no previous step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      act(() => {
        result.current.goBack()
      })

      expect(setStep).not.toHaveBeenCalled()
    })

    it('should call onStepChange callback', () => {
      const setStep = jest.fn()
      const onStepChange = jest.fn()

      const { result } = renderHook(() =>
        useWizardState(
          { initialStep: 'start', steps: basicSteps, onStepChange },
          'middle',
          setStep
        )
      )

      act(() => {
        result.current.goBack()
      })

      expect(onStepChange).toHaveBeenCalledWith('middle', 'start')
    })
  })

  describe('goTo', () => {
    it('should navigate to any step directly', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      act(() => {
        result.current.goTo('error')
      })

      expect(setStep).toHaveBeenCalledWith('error')
    })

    it('should call onStepChange callback', () => {
      const setStep = jest.fn()
      const onStepChange = jest.fn()

      const { result } = renderHook(() =>
        useWizardState(
          { initialStep: 'start', steps: basicSteps, onStepChange },
          'start',
          setStep
        )
      )

      act(() => {
        result.current.goTo('end')
      })

      expect(onStepChange).toHaveBeenCalledWith('start', 'end')
    })
  })

  describe('resetStep', () => {
    it('should reset to initial step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'middle', setStep)
      )

      act(() => {
        result.current.resetStep()
      })

      expect(setStep).toHaveBeenCalledWith('start')
    })

    it('should work from any step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'end', setStep)
      )

      act(() => {
        result.current.resetStep()
      })

      expect(setStep).toHaveBeenCalledWith('start')
    })
  })

  describe('getPrevStep and getNextSteps', () => {
    it('should return previous step for a given step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      expect(result.current.getPrevStep('middle')).toBe('start')
      expect(result.current.getPrevStep('start')).toBeUndefined()
    })

    it('should return next steps for a given step', () => {
      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: basicSteps }, 'start', setStep)
      )

      expect(result.current.getNextSteps('start')).toEqual(['middle'])
      expect(result.current.getNextSteps('branch1')).toEqual([])
    })

    it('should return multiple next steps', () => {
      const multiSteps: Record<TestStep, WizardStepConfig<TestStep>> = {
        ...basicSteps,
        start: { next: ['branch1', 'branch2', 'middle'] },
      }

      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: multiSteps }, 'start', setStep)
      )

      expect(result.current.getNextSteps('start')).toEqual(['branch1', 'branch2', 'middle'])
    })
  })

  describe('complex branching flows', () => {
    it('should handle error recovery flow', () => {
      const errorSteps: Record<TestStep, WizardStepConfig<TestStep>> = {
        start: { next: ['middle'] },
        middle: { prev: 'start', next: ['end', 'error'] },
        end: { prev: 'middle', isTerminal: true },
        error: { prev: 'middle', isTerminal: true },
        branch1: {},
        branch2: {},
      }

      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: errorSteps }, 'middle', setStep)
      )

      // Go to error
      act(() => {
        result.current.goNext('error')
      })
      expect(setStep).toHaveBeenCalledWith('error')

      // Update current step
      const { result: errorResult } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: errorSteps }, 'error', setStep)
      )

      expect(errorResult.current.isTerminal).toBe(true)
      expect(errorResult.current.canGoBack).toBe(true)

      // Go back to retry
      act(() => {
        errorResult.current.goBack()
      })
      expect(setStep).toHaveBeenCalledWith('middle')
    })

    it('should handle multi-branch wizard', () => {
      const branchSteps: Record<TestStep, WizardStepConfig<TestStep>> = {
        start: { next: ['branch1', 'branch2'] },
        branch1: { prev: 'start', next: ['end'] },
        branch2: { prev: 'start', next: ['end'] },
        end: { isTerminal: true },
        middle: {},
        error: {},
      }

      const setStep = jest.fn()

      const { result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: branchSteps }, 'start', setStep)
      )

      // Choose branch1
      act(() => {
        result.current.goNext('branch1')
      })
      expect(setStep).toHaveBeenCalledWith('branch1')

      setStep.mockClear()

      // Update to branch1
      const { result: branch1Result } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: branchSteps }, 'branch1', setStep)
      )

      // Go back and choose branch2
      act(() => {
        branch1Result.current.goBack()
      })
      expect(setStep).toHaveBeenCalledWith('start')

      setStep.mockClear()

      const { result: startResult } = renderHook(() =>
        useWizardState({ initialStep: 'start', steps: branchSteps }, 'start', setStep)
      )

      act(() => {
        startResult.current.goNext('branch2')
      })
      expect(setStep).toHaveBeenCalledWith('branch2')
    })
  })

  describe('step updates', () => {
    it('should update state when current step changes', () => {
      const setStep = jest.fn()

      const { result, rerender } = renderHook(
        ({ currentStep }) =>
          useWizardState({ initialStep: 'start', steps: basicSteps }, currentStep, setStep),
        { initialProps: { currentStep: 'start' as TestStep } }
      )

      expect(result.current.canGoBack).toBe(false)

      rerender({ currentStep: 'middle' })

      expect(result.current.canGoBack).toBe(true)
    })
  })
})
