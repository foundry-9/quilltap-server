/**
 * Unit tests for useExportData hook
 * Tests export data management, entity selection, and export workflow
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useExportData } from '@/components/tools/import-export/hooks/useExportData';

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;


// Mock URL for blob creation
const mockCreateObjectURL = jest.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = jest.fn();
global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

describe('useExportData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // Initial State Tests
  // ============================================================================
  describe('Initial State', () => {
    it('should initialize with default state when dialog is closed', () => {
      const { result } = renderHook(() => useExportData({ isOpen: false }));

      expect(result.current.state.step).toBe('type');
      expect(result.current.state.entityType).toBeNull();
      expect(result.current.state.scope).toBe('all');
      expect(result.current.state.selectedIds).toEqual([]);
      expect(result.current.state.includeMemories).toBe(false);
      expect(result.current.state.exporting).toBe(false);
      expect(result.current.state.error).toBeNull();
    });

    it('should reset state when dialog closes', () => {
      const { result, rerender } = renderHook(
        ({ isOpen }) => useExportData({ isOpen }),
        { initialProps: { isOpen: true } }
      );

      // Set some state
      act(() => {
        result.current.actions.setEntityType('characters');
      });

      expect(result.current.state.entityType).toBe('characters');

      // Close the dialog
      rerender({ isOpen: false });

      expect(result.current.state.entityType).toBeNull();
      expect(result.current.state.step).toBe('type');
    });
  });

  // ============================================================================
  // Entity Type Selection Tests
  // ============================================================================
  describe('setEntityType', () => {
    it('should set entity type and reset selection', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.setEntityType('characters');
      });

      expect(result.current.state.entityType).toBe('characters');
      expect(result.current.state.scope).toBe('all');
      expect(result.current.state.selectedIds).toEqual([]);
      expect(result.current.state.error).toBeNull();
    });

    it('should handle different entity types', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      const entityTypes = [
        'characters',
        'personas',
        'chats',
        'tags',
        'connection-profiles',
        'image-profiles',
        'roleplay-templates',
      ] as const;

      for (const type of entityTypes) {
        act(() => {
          result.current.actions.setEntityType(type);
        });
        expect(result.current.state.entityType).toBe(type);
      }
    });
  });

  // ============================================================================
  // Scope Selection Tests
  // ============================================================================
  describe('setScope', () => {
    it('should set scope to selected', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.setScope('selected');
      });

      expect(result.current.state.scope).toBe('selected');
    });

    it('should clear selectedIds when switching to all scope', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      // First select some entities
      act(() => {
        result.current.actions.setScope('selected');
        result.current.actions.toggleEntitySelection('char-1');
        result.current.actions.toggleEntitySelection('char-2');
      });

      expect(result.current.state.selectedIds).toHaveLength(2);

      // Switch to all
      act(() => {
        result.current.actions.setScope('all');
      });

      expect(result.current.state.scope).toBe('all');
      expect(result.current.state.selectedIds).toEqual([]);
    });

    it('should preserve selectedIds when switching to selected scope', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.setScope('selected');
        result.current.actions.toggleEntitySelection('char-1');
      });

      expect(result.current.state.selectedIds).toContain('char-1');

      // Toggle scope and back
      act(() => {
        result.current.actions.setScope('selected');
      });

      expect(result.current.state.selectedIds).toContain('char-1');
    });
  });

  // ============================================================================
  // Entity Selection Tests
  // ============================================================================
  describe('toggleEntitySelection', () => {
    it('should add entity to selection', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.toggleEntitySelection('char-1');
      });

      expect(result.current.state.selectedIds).toContain('char-1');
    });

    it('should remove entity from selection', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.toggleEntitySelection('char-1');
      });

      expect(result.current.state.selectedIds).toContain('char-1');

      act(() => {
        result.current.actions.toggleEntitySelection('char-1');
      });

      expect(result.current.state.selectedIds).not.toContain('char-1');
    });

    it('should handle multiple selections', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.toggleEntitySelection('char-1');
        result.current.actions.toggleEntitySelection('char-2');
        result.current.actions.toggleEntitySelection('char-3');
      });

      expect(result.current.state.selectedIds).toHaveLength(3);
      expect(result.current.state.selectedIds).toContain('char-1');
      expect(result.current.state.selectedIds).toContain('char-2');
      expect(result.current.state.selectedIds).toContain('char-3');
    });
  });

  // ============================================================================
  // Include Memories Tests
  // ============================================================================
  describe('setIncludeMemories', () => {
    it('should set include memories flag', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      expect(result.current.state.includeMemories).toBe(false);

      act(() => {
        result.current.actions.setIncludeMemories(true);
      });

      expect(result.current.state.includeMemories).toBe(true);

      act(() => {
        result.current.actions.setIncludeMemories(false);
      });

      expect(result.current.state.includeMemories).toBe(false);
    });
  });

  // ============================================================================
  // Navigation Tests
  // ============================================================================
  describe('handleNext', () => {
    it('should not proceed from type step without entity type', async () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleNext();
      });

      // Should stay on type step when no entity type is selected
      expect(result.current.state.step).toBe('type');
    });
  });

  describe('handleBack', () => {
    it('should clear error when going back', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      act(() => {
        result.current.actions.setEntityType('characters');
      });

      // handleBack should always clear error
      act(() => {
        result.current.actions.handleBack();
      });

      expect(result.current.state.error).toBeNull();
    });
  });

  // ============================================================================
  // Export Tests
  // ============================================================================
  describe('handleExport', () => {
    it('should not export without entity type', async () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleExport();
      });

      // Export endpoint should not be called when no entity type is set
      const exportCalls = mockFetch.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/tools/quilltap-export')
      );
      expect(exportCalls).toHaveLength(0);
    });
  });

  // ============================================================================
  // Reset Tests
  // ============================================================================
  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const { result } = renderHook(() => useExportData({ isOpen: true }));

      // Set various state values
      act(() => {
        result.current.actions.setEntityType('characters');
        result.current.actions.setScope('selected');
        result.current.actions.toggleEntitySelection('char-1');
        result.current.actions.setIncludeMemories(true);
      });

      expect(result.current.state.entityType).toBe('characters');

      act(() => {
        result.current.actions.reset();
      });

      expect(result.current.state.step).toBe('type');
      expect(result.current.state.entityType).toBeNull();
      expect(result.current.state.scope).toBe('all');
      expect(result.current.state.selectedIds).toEqual([]);
      expect(result.current.state.includeMemories).toBe(false);
    });
  });

});
