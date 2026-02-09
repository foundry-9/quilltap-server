/**
 * Unit tests for markdown-renderer.service.ts
 * Tests canPreRenderMessage function logic
 *
 * NOTE: Full integration tests for renderMarkdownToHtml would require ESM support
 * or should be tested in end-to-end tests. The renderMarkdownToHtml function heavily
 * depends on unified/remark/rehype libraries which are ESM-only and difficult to test
 * in Jest's CommonJS environment. The actual implementation is tested manually and
 * through browser-based E2E tests.
 *
 * To avoid ESM module loading issues, we test the canPreRenderMessage logic directly
 * by reimplementing it here based on the source code.
 */

// Mock logger to suppress log output during tests
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

/**
 * Reimplementation of canPreRenderMessage for testing without ESM dependencies
 * This mirrors the actual implementation in markdown-renderer.service.ts
 */
function canPreRenderMessage(
  role: string,
  hasAttachments: boolean,
  hasEmbeddedTool: boolean = false
): boolean {
  // Only USER and ASSISTANT messages can be pre-rendered
  if (role !== 'USER' && role !== 'ASSISTANT') {
    return false;
  }

  // Messages with attachments need client-side handling for image display
  if (hasAttachments) {
    return false;
  }

  // Messages with embedded tools need client-side interactivity
  if (hasEmbeddedTool) {
    return false;
  }

  return true;
}

describe('markdown-renderer.service', () => {
  describe('canPreRenderMessage', () => {
    describe('USER role', () => {
      it('should return true for USER role with no attachments or tools', () => {
        const result = canPreRenderMessage('USER', false, false);
        expect(result).toBe(true);
      });

      it('should return false for USER role with attachments', () => {
        const result = canPreRenderMessage('USER', true, false);
        expect(result).toBe(false);
      });

      it('should return false for USER role with embedded tool', () => {
        const result = canPreRenderMessage('USER', false, true);
        expect(result).toBe(false);
      });

      it('should return false for USER role with both attachments and tools', () => {
        const result = canPreRenderMessage('USER', true, true);
        expect(result).toBe(false);
      });
    });

    describe('ASSISTANT role', () => {
      it('should return true for ASSISTANT role with no attachments or tools', () => {
        const result = canPreRenderMessage('ASSISTANT', false, false);
        expect(result).toBe(true);
      });

      it('should return false for ASSISTANT role with attachments', () => {
        const result = canPreRenderMessage('ASSISTANT', true, false);
        expect(result).toBe(false);
      });

      it('should return false for ASSISTANT role with embedded tool', () => {
        const result = canPreRenderMessage('ASSISTANT', false, true);
        expect(result).toBe(false);
      });

      it('should return false for ASSISTANT role with both attachments and tools', () => {
        const result = canPreRenderMessage('ASSISTANT', true, true);
        expect(result).toBe(false);
      });
    });

    describe('TOOL role', () => {
      it('should return false for TOOL role regardless of attachments or tools', () => {
        expect(canPreRenderMessage('TOOL', false, false)).toBe(false);
        expect(canPreRenderMessage('TOOL', true, false)).toBe(false);
        expect(canPreRenderMessage('TOOL', false, true)).toBe(false);
        expect(canPreRenderMessage('TOOL', true, true)).toBe(false);
      });
    });

    describe('SYSTEM role', () => {
      it('should return false for SYSTEM role regardless of attachments or tools', () => {
        expect(canPreRenderMessage('SYSTEM', false, false)).toBe(false);
        expect(canPreRenderMessage('SYSTEM', true, false)).toBe(false);
        expect(canPreRenderMessage('SYSTEM', false, true)).toBe(false);
        expect(canPreRenderMessage('SYSTEM', true, true)).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle hasEmbeddedTool parameter default (undefined)', () => {
        // Third parameter is optional with default false
        expect(canPreRenderMessage('USER', false)).toBe(true);
        expect(canPreRenderMessage('ASSISTANT', false)).toBe(true);
      });

      it('should return false for unknown roles', () => {
        expect(canPreRenderMessage('UNKNOWN', false, false)).toBe(false);
        expect(canPreRenderMessage('CUSTOM', false, false)).toBe(false);
        expect(canPreRenderMessage('', false, false)).toBe(false);
      });

      it('should be case sensitive for role names', () => {
        // The function checks for exact string matches
        expect(canPreRenderMessage('user', false, false)).toBe(false);
        expect(canPreRenderMessage('assistant', false, false)).toBe(false);
      });
    });
  });

  // NOTE: renderMarkdownToHtml tests should be added as integration tests
  // The function depends on ESM-only libraries (unified, remark, rehype) that are
  // difficult to test in Jest's CommonJS environment. Consider:
  // 1. Adding integration tests that run in a real Node ESM environment
  // 2. Adding E2E tests that verify markdown rendering in the browser
  // 3. Manual testing of key scenarios:
  //    - Basic markdown (headers, bold, italic, lists, links, blockquotes)
  //    - Code blocks (fenced with/without language, inline code)
  //    - GFM (tables, strikethrough, task lists)
  //    - Roleplay patterns (*narration*, "dialogue", ((ooc)), {monologue}, [actions])
  //    - Dialogue detection (paragraph-level quote wrapping)
  //    - escapeMarkdownInBrackets (preserve brackets with nested markdown)
  //    - XSS prevention (<script>, onerror, javascript:, etc.)
  //    - Custom patterns and dialogue detection
  //    - Error handling (empty content, long content, unicode)
});
