/**
 * Unit tests for useAsyncOperation hook
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncOperation } from '@/hooks/useAsyncOperation';

describe('useAsyncOperation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initial state', () => {
    it('should initialize with loading false and error null', () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should provide execute function', () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      expect(typeof result.current.execute).toBe('function');
    });

    it('should provide clearError function', () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      expect(typeof result.current.clearError).toBe('function');
    });

    it('should provide setError function', () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      expect(typeof result.current.setError).toBe('function');
    });
  });

  describe('Successful execution', () => {
    it('should execute operation and return result', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      let executionResult: string | null = null;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(executionResult).toBe('success');
    });

    it('should return data from successful operation', async () => {
      const { result } = renderHook(() => useAsyncOperation<number>());

      let executionResult: number | null = null;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          return 42;
        });
      });

      expect(executionResult).toBe(42);
    });

    it('should handle complex object returns', async () => {
      interface TestData {
        id: string;
        name: string;
        active: boolean;
      }

      const { result } = renderHook(() => useAsyncOperation<TestData>());

      const testData: TestData = {
        id: 'test-1',
        name: 'Test Item',
        active: true,
      };

      let executionResult: TestData | null = null;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          return testData;
        });
      });

      expect(executionResult).toEqual(testData);
    });

    it('should set loading to false after successful execution', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          return 'done';
        });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should clear error on new successful execution', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      // First, set an error
      await act(async () => {
        result.current.setError('Previous error');
      });

      expect(result.current.error).toBe('Previous error');

      // Then execute a successful operation
      await act(async () => {
        await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(result.current.error).toBe(null);
    });

    it('should complete successfully without errors when operation succeeds', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('Loading state during execution', () => {
    it('should set loading to false after execution completes', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          return 'done';
        });
      });

      expect(result.current.loading).toBe(false);
    });

    it('should set loading to false after execution fails', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Operation failed');
        });
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should capture Error instances', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Test error message');
        });
      });

      expect(result.current.error).toBe('Test error message');
    });

    it('should capture string errors', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          throw 'String error';
        });
      });

      expect(result.current.error).toBe('String error');
    });

    it('should use fallback message for non-standard errors', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          throw { custom: 'object' };
        });
      });

      // The hook uses 'Operation failed' as its fallback, not 'Unknown error'
      expect(result.current.error).toBe('Operation failed');
    });

    it('should return null when operation fails', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      let executionResult: string | null = 'not-null';

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          throw new Error('Failed');
        });
      });

      expect(executionResult).toBeNull();
    });

    it('should handle multiple sequential failures', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('First error');
        });
      });

      expect(result.current.error).toBe('First error');

      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Second error');
        });
      });

      expect(result.current.error).toBe('Second error');
    });
  });

  describe('clearError function', () => {
    it('should clear error state', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Test error');
      });

      expect(result.current.error).toBe('Test error');

      await act(async () => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('should not affect loading state', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Test error');
      });

      await act(async () => {
        result.current.clearError();
      });

      expect(result.current.loading).toBe(false);
    });

    it('should successfully clear error without side effects', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Test error');
      });

      expect(result.current.error).toBe('Test error');

      await act(async () => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('should be callable multiple times', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Error 1');
        result.current.clearError();
        result.current.setError('Error 2');
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('setError function', () => {
    it('should set error message', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Custom error message');
      });

      expect(result.current.error).toBe('Custom error message');
    });

    it('should override previous error', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('First error');
      });

      expect(result.current.error).toBe('First error');

      await act(async () => {
        result.current.setError('Second error');
      });

      expect(result.current.error).toBe('Second error');
    });

    it('should not affect loading state', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Test error');
      });

      expect(result.current.loading).toBe(false);
    });

    it('should allow overwriting error messages without issues', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('First error');
      });

      expect(result.current.error).toBe('First error');

      await act(async () => {
        result.current.setError('Second error');
      });

      expect(result.current.error).toBe('Second error');
    });

    it('should accept empty string as error message', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('');
      });

      expect(result.current.error).toBe('');
    });

    it('should handle long error messages', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());
      const longMessage = 'Error message '.repeat(100);

      await act(async () => {
        result.current.setError(longMessage);
      });

      expect(result.current.error).toBe(longMessage);
    });
  });

  describe('Error clearing on new execution', () => {
    it('should clear error when starting new operation', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      // First operation fails
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('First error');
        });
      });

      expect(result.current.error).toBe('First error');

      // Second operation succeeds
      await act(async () => {
        await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(result.current.error).toBeNull();
    });

    it('should clear error from manual setError when starting execution', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      // Manually set error
      await act(async () => {
        result.current.setError('Manual error');
      });

      expect(result.current.error).toBe('Manual error');

      // Execute operation
      await act(async () => {
        await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Concurrent operations', () => {
    it('should handle sequential operations correctly', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      let result1: string | null = null;
      let result2: string | null = null;

      await act(async () => {
        result1 = await result.current.execute(async () => {
          return 'first';
        });
      });

      await act(async () => {
        result2 = await result.current.execute(async () => {
          return 'second';
        });
      });

      expect(result1).toBe('first');
      expect(result2).toBe('second');
      expect(result.current.loading).toBe(false);
    });

    it('should maintain correct error state across operations', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      // First operation fails
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Error 1');
        });
      });

      expect(result.current.error).toBe('Error 1');

      // Second operation fails differently
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Error 2');
        });
      });

      expect(result.current.error).toBe('Error 2');

      // Third operation succeeds
      await act(async () => {
        await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Generic type handling', () => {
    it('should work with different generic types', async () => {
      const stringHook = renderHook(() => useAsyncOperation<string>());
      const numberHook = renderHook(() => useAsyncOperation<number>());
      const boolHook = renderHook(() => useAsyncOperation<boolean>());

      let stringResult: string | null = null;
      let numberResult: number | null = null;
      let boolResult: boolean | null = null;

      await act(async () => {
        stringResult = await stringHook.result.current.execute(async () => 'test');
      });

      await act(async () => {
        numberResult = await numberHook.result.current.execute(async () => 123);
      });

      await act(async () => {
        boolResult = await boolHook.result.current.execute(async () => true);
      });

      expect(stringResult).toBe('test');
      expect(numberResult).toBe(123);
      expect(boolResult).toBe(true);
    });

    it('should work with array types', async () => {
      const { result } = renderHook(() => useAsyncOperation<string[]>());

      let executionResult: string[] | null = null;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          return ['a', 'b', 'c'];
        });
      });

      expect(Array.isArray(executionResult)).toBe(true);
      expect(executionResult).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Edge cases', () => {
    it('should handle operations that resolve immediately', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      let executionResult: string | null = null;

      await act(async () => {
        executionResult = await result.current.execute(async () => 'immediate');
      });

      expect(executionResult).toBe('immediate');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should handle operations with delays', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      let executionResult: string | null = null;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'delayed';
        });
      });

      expect(executionResult).toBe('delayed');
    });

    it('should handle null as valid return value', async () => {
      const { result } = renderHook(() => useAsyncOperation<null>());

      let executionResult: null | null = 'not-null' as any;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          return null;
        });
      });

      expect(executionResult).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should handle undefined as valid return value', async () => {
      const { result } = renderHook(() => useAsyncOperation<undefined>());

      let executionResult: undefined | null = 'not-undefined' as any;

      await act(async () => {
        executionResult = await result.current.execute(async () => {
          return undefined;
        });
      });

      expect(executionResult).toBeUndefined();
      expect(result.current.error).toBeNull();
    });

    it('should not throw when clearError is called with no error set', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      expect(() => {
        act(() => {
          result.current.clearError();
        });
      }).not.toThrow();
    });

    it('should handle errors with special characters', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      const specialError = 'Error with "quotes" and \n newlines';

      await act(async () => {
        result.current.setError(specialError);
      });

      expect(result.current.error).toBe(specialError);
    });
  });

  describe('State consistency', () => {
    it('should maintain consistent state after multiple clearError calls', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Error');
      });

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          result.current.clearError();
        });
        expect(result.current.error).toBeNull();
      }
    });

    it('should maintain consistent state during rapid state changes', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      await act(async () => {
        result.current.setError('Error 1');
        result.current.clearError();
        result.current.setError('Error 2');
        result.current.clearError();
        result.current.setError('Error 3');
      });

      expect(result.current.error).toBe('Error 3');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete workflow: execute -> error -> clear -> execute success', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      // First execution fails
      await act(async () => {
        await result.current.execute(async () => {
          throw new Error('Network error');
        });
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);

      // Clear error manually
      await act(async () => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();

      // Second execution succeeds
      let finalResult: string | null = null;

      await act(async () => {
        finalResult = await result.current.execute(async () => {
          return 'success';
        });
      });

      expect(finalResult).toBe('success');
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('should handle form submission pattern', async () => {
      const { result } = renderHook(() => useAsyncOperation<{ id: string }>());

      // Simulate form submission
      let submitResult: { id: string } | null = null;

      await act(async () => {
        submitResult = await result.current.execute(async () => {
          // Simulate API call
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { id: 'submitted-form' };
        });
      });

      expect(submitResult).toEqual({ id: 'submitted-form' });
      expect(result.current.loading).toBe(false);
    });

    it('should handle retry pattern', async () => {
      const { result } = renderHook(() => useAsyncOperation<string>());

      let attempts = 0;

      // First attempt fails
      await act(async () => {
        await result.current.execute(async () => {
          attempts++;
          throw new Error('Attempt failed');
        });
      });

      expect(attempts).toBe(1);
      expect(result.current.error).toBe('Attempt failed');

      // Retry
      let retryResult: string | null = null;

      await act(async () => {
        retryResult = await result.current.execute(async () => {
          attempts++;
          return 'success';
        });
      });

      expect(attempts).toBe(2);
      expect(retryResult).toBe('success');
      expect(result.current.error).toBeNull();
    });
  });
});
