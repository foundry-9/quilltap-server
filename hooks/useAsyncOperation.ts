'use client';

import { useState, useCallback } from 'react';
import { getErrorMessage } from '@/lib/error-utils';

/**
 * Result type returned by the execute function
 */
export interface UseAsyncOperationResult<T> {
  loading: boolean;
  error: string | null;
  execute: (operation: () => Promise<T>) => Promise<T | null>;
  clearError: () => void;
  setError: (msg: string) => void;
}

/**
 * Hook to manage async operations with loading and error states
 *
 * @template T - The type of data returned by the async operation
 * @returns Object containing loading state, error state, execute function, and error handling methods
 *
 * @example
 * const { loading, error, execute, clearError } = useAsyncOperation<UserData>();
 * const handleSubmit = async () => {
 *   const result = await execute(async () => {
 *     return fetchUserData(userId);
 *   });
 *   if (result) {
 *     setUser(result);
 *   }
 * };
 */
export function useAsyncOperation<T>(): UseAsyncOperationResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const setError = useCallback((msg: string) => {
    setErrorState(msg);
  }, []);

  const execute = useCallback(
    async (operation: () => Promise<T>): Promise<T | null> => {
      try {
        // Clear any previous error when starting a new operation
        setErrorState(null);
        setLoading(true);

        const result = await operation();
        setLoading(false);
        return result;
      } catch (err) {
        const errorMessage = getErrorMessage(err, 'Operation failed');

        console.error('Async operation failed', { message: errorMessage });

        setErrorState(errorMessage);
        setLoading(false);
        return null;
      }
    },
    []
  );

  return {
    loading,
    error,
    execute,
    clearError,
    setError,
  };
}
