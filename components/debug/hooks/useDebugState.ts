'use client';

import { useState, useCallback } from 'react';
import { FilterDirection, FilterStatus } from '../types';

/**
 * Hook for managing debug panel filter state
 * Handles direction, status, and provider filtering
 */
export function useDebugState() {
  const [selectedDirection, setSelectedDirection] = useState<FilterDirection>('all');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('all');
  const [selectedProvider, setSelectedProvider] = useState<string | 'all'>('all');

  const handleDirectionChange = useCallback((direction: FilterDirection) => {
    setSelectedDirection(direction);
  }, []);

  const handleStatusChange = useCallback((status: FilterStatus) => {
    setSelectedStatus(status);
  }, []);

  const handleProviderChange = useCallback((provider: string | 'all') => {
    setSelectedProvider(provider);
  }, []);

  const resetFilters = useCallback(() => {
    setSelectedDirection('all');
    setSelectedStatus('all');
    setSelectedProvider('all');
  }, []);

  return {
    selectedDirection,
    selectedStatus,
    selectedProvider,
    handleDirectionChange,
    handleStatusChange,
    handleProviderChange,
    resetFilters,
  };
}
