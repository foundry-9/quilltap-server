'use client';

import { useState, useCallback } from 'react';
import { getErrorMessage } from '@/lib/error-utils';
import { clientLogger } from '@/lib/client-logger';

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
    clientLogger.debug('Clearing error state');
    setErrorState(null);
  }, []);

  const setError = useCallback((msg: string) => {
    clientLogger.debug('Setting error state', { message: msg });
    setErrorState(msg);
  }, []);

  const execute = useCallback(
    async (operation: () => Promise<T>): Promise<T | null> => {
      try {
        // Clear any previous error when starting a new operation
        clientLogger.debug('Starting async operation');
        setErrorState(null);
        setLoading(true);

        const result = await operation();
        clientLogger.debug('Async operation completed successfully');
        setLoading(false);
        return result;
      } catch (err) {
        const errorMessage = getErrorMessage(err, 'Operation failed');
        clientLogger.error('Async operation failed', {
          error: errorMessage,
          errorType: err instanceof Error ? 'Error' : typeof err,
        });
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
