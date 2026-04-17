/**
 * Unit tests for folder routing in doc-edit handler
 *
 * Tests cover:
 * - doc_create_folder, doc_delete_folder, doc_move_folder are in DOC_EDIT_TOOL_NAMES
 * - Folder tools are recognized by isDocEditTool
 *
 * Note: Full integration tests of the handler's dispatch logic require extensive
 * mocking of the entire request context and response path. Instead, we focus on
 * verifying that the tools are properly registered and named, which is the
 * contract that other code depends on.
 */

import { describe, it, expect } from '@jest/globals';

// Mock dependencies to avoid import side effects during test load
jest.mock('@/lib/logger');
jest.mock('@/lib/doc-edit');
jest.mock('@/lib/mount-index/database-store');
jest.mock('@/lib/database/repositories');
jest.mock('fs/promises');

import {
  DOC_EDIT_TOOL_NAMES,
  isDocEditTool,
} from '@/lib/tools/handlers/doc-edit-handler';

describe('doc-edit handler tool registration', () => {
  // =========================================================================
  // Tool Name Constants
  // =========================================================================

  describe('DOC_EDIT_TOOL_NAMES', () => {
    it('includes doc_create_folder', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_create_folder')).toBe(true);
    });

    it('includes doc_delete_folder', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_delete_folder')).toBe(true);
    });

    it('includes doc_move_folder', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_move_folder')).toBe(true);
    });

    it('includes doc_list_files', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_list_files')).toBe(true);
    });

    it('includes doc_read_file', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_read_file')).toBe(true);
    });

    it('includes doc_write_file', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_write_file')).toBe(true);
    });

    it('includes doc_str_replace', () => {
      expect(DOC_EDIT_TOOL_NAMES.has('doc_str_replace')).toBe(true);
    });
  });

  // =========================================================================
  // Tool Recognition
  // =========================================================================

  describe('isDocEditTool', () => {
    it('recognizes doc_create_folder as a doc-edit tool', () => {
      expect(isDocEditTool('doc_create_folder')).toBe(true);
    });

    it('recognizes doc_delete_folder as a doc-edit tool', () => {
      expect(isDocEditTool('doc_delete_folder')).toBe(true);
    });

    it('recognizes doc_move_folder as a doc-edit tool', () => {
      expect(isDocEditTool('doc_move_folder')).toBe(true);
    });

    it('recognizes doc_list_files as a doc-edit tool', () => {
      expect(isDocEditTool('doc_list_files')).toBe(true);
    });

    it('rejects non-existent tools', () => {
      expect(isDocEditTool('invalid_tool')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isDocEditTool('')).toBe(false);
    });
  });
});
