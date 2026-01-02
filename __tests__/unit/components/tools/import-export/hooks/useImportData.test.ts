/**
 * Unit tests for useImportData hook
 * Tests import data management, file handling, and import workflow
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useImportData } from '@/components/tools/import-export/hooks/useImportData';

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

// Mock clientLogger
jest.mock('@/lib/client-logger', () => ({
  clientLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Helper to create mock File with working text() method
function createMockFile(content: string, name = 'export.qtap'): File {
  const file = new File([content], name, { type: 'application/json' });
  // Override text() to return the content directly since Jest's File implementation may differ
  file.text = () => Promise.resolve(content);
  return file;
}

// Valid export data for tests
const validExportData = {
  manifest: {
    format: 'quilltap-export',
    version: '1.0',
    exportType: 'characters',
    exportedAt: '2024-01-01T00:00:00.000Z',
    counts: { characters: 2 },
  },
  data: {
    characters: [
      { id: 'char-1', name: 'Character 1' },
      { id: 'char-2', name: 'Character 2' },
    ],
  },
};

describe('useImportData', () => {
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
      const { result } = renderHook(() => useImportData({ isOpen: false }));

      expect(result.current.state.step).toBe('file');
      expect(result.current.state.selectedFile).toBeNull();
      expect(result.current.state.exportData).toBeNull();
      expect(result.current.state.preview).toBeNull();
      expect(result.current.state.conflictStrategy).toBe('skip');
      expect(result.current.state.importMemories).toBe(false);
      expect(result.current.state.importing).toBe(false);
      expect(result.current.state.error).toBeNull();
    });

    it('should reset state when dialog closes', () => {
      const { result, rerender } = renderHook(
        ({ isOpen }) => useImportData({ isOpen }),
        { initialProps: { isOpen: true } }
      );

      // Simulate file selection
      const file = createMockFile(JSON.stringify(validExportData));
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      act(() => {
        result.current.actions.handleFileSelect(event);
      });

      // Close dialog
      rerender({ isOpen: false });

      expect(result.current.state.selectedFile).toBeNull();
      expect(result.current.state.step).toBe('file');
    });

    it('should provide fileInputRef', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      expect(result.current.fileInputRef).toBeDefined();
    });
  });

  // ============================================================================
  // File Selection Tests
  // ============================================================================
  describe('handleFileSelect', () => {
    it('should parse valid export file', async () => {
      const file = createMockFile(JSON.stringify(validExportData));
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileSelect(event);
      });

      expect(result.current.state.selectedFile).toBe(file);
      expect(result.current.state.exportData).toEqual(validExportData);
      expect(result.current.state.error).toBeNull();
    });

    it('should handle invalid JSON', async () => {
      const file = createMockFile('not valid json {{{');
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileSelect(event);
      });

      expect(result.current.state.error).toContain('Failed to parse file');
    });

    it('should reject invalid export format', async () => {
      const invalidExport = { manifest: { format: 'wrong' }, data: {} };
      const file = createMockFile(JSON.stringify(invalidExport));
      const event = {
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileSelect(event);
      });

      expect(result.current.state.error).toContain('Invalid export file format');
    });

    it('should handle no file selected', async () => {
      const event = {
        target: { files: [] },
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileSelect(event);
      });

      expect(result.current.state.selectedFile).toBeNull();
    });
  });

  // ============================================================================
  // File Drop Tests
  // ============================================================================
  describe('handleFileDrop', () => {
    it('should parse dropped file', async () => {
      const file = createMockFile(JSON.stringify(validExportData));
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { files: [file] },
      } as unknown as React.DragEvent<HTMLDivElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileDrop(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(result.current.state.selectedFile).toBe(file);
      expect(result.current.state.exportData).toEqual(validExportData);
    });

    it('should handle drop with no files', async () => {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { files: [] },
      } as unknown as React.DragEvent<HTMLDivElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileDrop(event);
      });

      expect(result.current.state.selectedFile).toBeNull();
    });

    it('should handle invalid dropped file', async () => {
      const file = createMockFile('invalid json');
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { files: [file] },
      } as unknown as React.DragEvent<HTMLDivElement>;

      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleFileDrop(event);
      });

      expect(result.current.state.error).toContain('Failed to parse file');
    });
  });

  // ============================================================================
  // Conflict Strategy Tests
  // ============================================================================
  describe('setConflictStrategy', () => {
    it('should set conflict strategy to skip', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.setConflictStrategy('skip');
      });

      expect(result.current.state.conflictStrategy).toBe('skip');
    });

    it('should set conflict strategy to overwrite', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.setConflictStrategy('overwrite');
      });

      expect(result.current.state.conflictStrategy).toBe('overwrite');
    });

    it('should set conflict strategy to duplicate', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.setConflictStrategy('duplicate');
      });

      expect(result.current.state.conflictStrategy).toBe('duplicate');
    });
  });

  // ============================================================================
  // Import Memories Tests
  // ============================================================================
  describe('setImportMemories', () => {
    it('should toggle import memories flag', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      expect(result.current.state.importMemories).toBe(false);

      act(() => {
        result.current.actions.setImportMemories(true);
      });

      expect(result.current.state.importMemories).toBe(true);

      act(() => {
        result.current.actions.setImportMemories(false);
      });

      expect(result.current.state.importMemories).toBe(false);
    });
  });

  // ============================================================================
  // Entity Selection Tests
  // ============================================================================
  describe('toggleEntitySelection', () => {
    it('should add entity to selection', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.toggleEntitySelection('characters', 'char-1');
      });

      expect(result.current.state.selectedEntityIds.characters).toContain('char-1');
    });

    it('should remove entity from selection', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.toggleEntitySelection('characters', 'char-1');
      });

      expect(result.current.state.selectedEntityIds.characters).toContain('char-1');

      act(() => {
        result.current.actions.toggleEntitySelection('characters', 'char-1');
      });

      expect(result.current.state.selectedEntityIds.characters).not.toContain('char-1');
    });

    it('should handle multiple entity types independently', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.toggleEntitySelection('characters', 'char-1');
        result.current.actions.toggleEntitySelection('personas', 'persona-1');
      });

      expect(result.current.state.selectedEntityIds.characters).toContain('char-1');
      expect(result.current.state.selectedEntityIds.personas).toContain('persona-1');
    });
  });

  // ============================================================================
  // Navigation Tests
  // ============================================================================
  describe('handleNext', () => {
    it('should not proceed from file step without file', async () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleNext();
      });

      // Should stay on file step when no file is selected
      expect(result.current.state.step).toBe('file');
    });
  });

  describe('handleBack', () => {
    it('should clear error when going back', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      // handleBack should clear any error
      act(() => {
        result.current.actions.handleBack();
      });

      expect(result.current.state.error).toBeNull();
    });
  });

  // ============================================================================
  // Import Tests
  // ============================================================================
  describe('handleImport', () => {
    it('should not import without export data', async () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      await act(async () => {
        await result.current.actions.handleImport();
      });

      // Verify no import-related fetch was made when there's no export data
      // (logging calls to /api/logs are expected)
      const importCalls = mockFetch.mock.calls.filter(
        call => call[0].includes('/api/tools/quilltap-import')
      );
      expect(importCalls).toHaveLength(0);
      expect(result.current.state.importing).toBe(false);
    });
  });

  // ============================================================================
  // Reset Tests
  // ============================================================================
  describe('reset', () => {
    it('should reset conflict strategy and import memories to defaults', () => {
      const { result } = renderHook(() => useImportData({ isOpen: true }));

      act(() => {
        result.current.actions.setConflictStrategy('duplicate');
        result.current.actions.setImportMemories(true);
      });

      expect(result.current.state.conflictStrategy).toBe('duplicate');
      expect(result.current.state.importMemories).toBe(true);

      act(() => {
        result.current.actions.reset();
      });

      expect(result.current.state.step).toBe('file');
      expect(result.current.state.conflictStrategy).toBe('skip');
      expect(result.current.state.importMemories).toBe(false);
    });
  });
});
