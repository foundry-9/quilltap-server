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

// The pure roleplay-rendering core is import-safe in Jest (no ESM-only deps).
// The local HTML wrappers below delegate to it so this test exercises the REAL
// match-walk / escaping, not a drifting reimplementation.
import {
  type CompiledRule,
  escapeMarkdownInBrackets as coreEscapeMarkdownInBrackets,
  tokenizeInline,
  segmentsToHtml,
  lineClassFor,
  isDialogueParagraph as coreIsDialogueParagraph,
} from '@/lib/chat/roleplay-rendering';

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
 * Types needed for testing helper functions
 */
interface RenderingPattern {
  pattern: string;
  className: string;
  flags?: string;
}

interface CompiledPattern {
  regex: RegExp;
  className: string;
}

interface DialogueDetection {
  openingChars: string[];
  closingChars: string[];
  className: string;
}

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

/** Escaping is the shared core function (no reimplementation). */
const escapeMarkdownInBrackets = coreEscapeMarkdownInBrackets;

/** Adapt a test CompiledPattern to the core CompiledRule shape. */
function toRule(p: CompiledPattern, scope: 'inline' | 'line' = 'inline'): CompiledRule {
  return { regex: new RegExp(p.regex.source, p.regex.flags.replace('g', '')), className: p.className, scope };
}

/**
 * HTML wrapper mirroring markdown-renderer.service.applyRoleplayPatterns, but the
 * inner match-walk delegates to the REAL shared tokenizeInline + segmentsToHtml.
 */
function applyRoleplayPatterns(html: string, compiledPatterns: CompiledPattern[]): string {
  const rules = compiledPatterns.map((p) => toRule(p));
  const tagRegex = /(<[^>]*>)/g;
  const parts = html.split(tagRegex);

  let inCodeBlock = 0;

  const processedParts = parts.map((part, index) => {
    if (index % 2 === 1) {
      const lowerPart = part.toLowerCase();
      if (lowerPart.startsWith('<code') || lowerPart.startsWith('<pre')) {
        inCodeBlock++;
      } else if (lowerPart === '</code>' || lowerPart === '</pre>') {
        inCodeBlock = Math.max(0, inCodeBlock - 1);
      }
      return part;
    }

    if (inCodeBlock > 0) {
      return part;
    }

    return segmentsToHtml(tokenizeInline(part, rules));
  });

  return processedParts.join('');
}

/** Dialogue predicate is the shared core function. */
const isDialogueParagraph = coreIsDialogueParagraph;

/**
 * HTML wrapper mirroring markdown-renderer.service.applyDialogueDetection.
 */
function applyDialogueDetection(html: string, detection: DialogueDetection): string {
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (match, attrs, content) => {
    const plainText = content.replace(/<[^>]+>/g, '');

    if (isDialogueParagraph(plainText, detection)) {
      if (attrs.includes('class="')) {
        const newAttrs = attrs.replace(/class="([^"]*)"/, `class="$1 ${detection.className}"`);
        return `<p${newAttrs}>${content}</p>`;
      } else {
        return `<p${attrs} class="${detection.className}">${content}</p>`;
      }
    }

    return match;
  });
}

/**
 * HTML wrapper mirroring markdown-renderer.service.applyLineScopedClasses: a
 * line-scoped rule's class lands on the whole block element, not an inline span.
 */
function applyLineScopedClasses(html: string, rules: CompiledRule[]): string {
  const lineRules = rules.filter((r) => r.scope === 'line');
  if (lineRules.length === 0) return html;
  return html.replace(/<(p|li|blockquote|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/g, (match, tag, attrs, content) => {
    const plainText = content.replace(/<[^>]+>/g, '');
    const cls = lineClassFor(plainText, lineRules);
    if (!cls) return match;
    if (attrs.includes('class="')) {
      const newAttrs = attrs.replace(/class="([^"]*)"/, `class="$1 ${cls}"`);
      return `<${tag}${newAttrs}>${content}</${tag}>`;
    }
    return `<${tag}${attrs} class="${cls}">${content}</${tag}>`;
  });
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

  describe('escapeMarkdownInBrackets', () => {
    const BRACKET_NARRATION: RenderingPattern = { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' };
    const BRACE_MONOLOGUE: RenderingPattern = { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' };
    const ASTERISK_NARRATION: RenderingPattern = { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' };

    it('should return content unchanged when no matching patterns', () => {
      const content = 'This is plain text with no special formatting';
      const result = escapeMarkdownInBrackets(content, []);
      expect(result).toBe(content);
    });

    it('should escape markdown chars inside [...] when bracket narration pattern present', () => {
      const content = '[narration with *emphasis* and _underline_]';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION]);
      expect(result).toContain('\\*');
      expect(result).toContain('\\_');
    });

    it('should preserve [...] links: [text](url) not escaped', () => {
      const content = '[link text](https://example.com)';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION]);
      expect(result).toBe(content);
    });

    it('should escape inside {...} when brace monologue pattern present', () => {
      const content = '{thoughts with *emphasis* here}';
      const result = escapeMarkdownInBrackets(content, [BRACE_MONOLOGUE]);
      expect(result).toContain('\\*');
    });

    it('should not escape {{template}} variables (double braces)', () => {
      const content = '{{character_name}} speaks';
      const result = escapeMarkdownInBrackets(content, [BRACE_MONOLOGUE]);
      expect(result).toBe(content);
    });

    it('should escape _~` inside *...* when asterisk narration pattern present', () => {
      const content = '*narration with _underline_ and `code`*';
      const result = escapeMarkdownInBrackets(content, [ASTERISK_NARRATION]);
      expect(result).toContain('\\_');
      expect(result).toContain('\\`');
    });

    it('should not escape * inside *...* (would break the delimiter)', () => {
      const content = '*narration with asterisks*';
      const result = escapeMarkdownInBrackets(content, [ASTERISK_NARRATION]);
      // The outer asterisks should be preserved
      expect(result).toMatch(/^\*.*\*$/);
    });

    it('should preserve code blocks unchanged (```code```)', () => {
      const content = '[bracket] and ```code with [brackets] and {braces}``` end';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION, BRACE_MONOLOGUE]);
      // Code block content should be preserved exactly
      expect(result).toContain('code with [brackets] and {braces}');
    });

    it('should handle content with multiple brackets', () => {
      const content = '[first *bracket*] and [second _bracket_]';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION]);
      const escapedCount = (result.match(/\\\*/g) || []).length;
      expect(escapedCount).toBeGreaterThan(0);
    });

    it('should handle mixed patterns in same content', () => {
      const content = '[action *with* emphasis] and {thought _with_ style}';
      const result = escapeMarkdownInBrackets(content, [BRACKET_NARRATION, BRACE_MONOLOGUE]);
      expect(result).toContain('\\*');
      expect(result).toContain('\\_');
    });
  });

  describe('applyRoleplayPatterns', () => {
    const createCompiledPattern = (pattern: string, className: string): CompiledPattern => ({
      regex: new RegExp(pattern, 'g'),
      className,
    });

    it('should wrap matched text in span with className', () => {
      const html = '<p>This is *narration* text</p>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-chat-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toContain('<span class="qt-chat-narration">*narration*</span>');
    });

    it('should not modify HTML tags (attributes preserved)', () => {
      const html = '<p class="message" id="msg-1">Text</p>';
      const patterns = [createCompiledPattern('Text', 'qt-highlight')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toContain('class="message"');
      expect(result).toContain('id="msg-1"');
    });

    it('should skip content inside <code> blocks', () => {
      const html = '<p>Normal *text* and <code>*code*</code> end</p>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      // Only the first match should be wrapped, not the one in code
      const spans = (result.match(/<span class="qt-narration">/g) || []).length;
      expect(spans).toBe(1);
    });

    it('should skip content inside <pre> blocks', () => {
      const html = '<pre>*code block* text</pre>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).not.toContain('<span class="qt-narration">');
    });

    it('should handle nested code blocks (depth tracking)', () => {
      const html = '<div><code>first *code*</code> <code>second *code*</code></div>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      // Neither code block content should be wrapped
      expect((result.match(/<span class="qt-narration">/g) || []).length).toBe(0);
    });

    it('should apply multiple patterns in order', () => {
      const html = '<p>"dialogue" and *narration*</p>';
      const patterns = [
        createCompiledPattern('"[^"]*"', 'qt-dialogue'),
        createCompiledPattern('\\*[^*]+\\*', 'qt-narration'),
      ];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toContain('<span class="qt-dialogue">"dialogue"</span>');
      expect(result).toContain('<span class="qt-narration">*narration*</span>');
    });

    it('should handle content with no matches', () => {
      const html = '<p>Plain text with no patterns</p>';
      const patterns = [createCompiledPattern('\\*[^*]+\\*', 'qt-narration')];
      const result = applyRoleplayPatterns(html, patterns);
      expect(result).toBe(html);
    });
  });

  describe('applyDialogueDetection', () => {
    const DEFAULT_DETECTION: DialogueDetection = {
      openingChars: ['"', '\u201c'],
      closingChars: ['"', '\u201d'],
      className: 'qt-chat-dialogue',
    };

    it('should add dialogue class to paragraphs that start/end with quotes', () => {
      const html = '<p>"This is dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should handle curly quotes (smart quotes)', () => {
      const html = '<p>\u201cThis is dialogue.\u201d</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should not modify non-dialogue paragraphs', () => {
      const html = '<p>This is not dialogue.</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toBe(html);
    });

    it('should merge with existing class attribute', () => {
      const html = '<p class="message-content">"Dialogue here."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="message-content qt-chat-dialogue"');
    });

    it('should add new class attribute when none exists', () => {
      const html = '<p>"Dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should ignore very short text (< 2 chars)', () => {
      const html = '<p>"a</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toBe(html);
    });

    it('should handle paragraphs with nested HTML tags', () => {
      const html = '<p>"The <em>famous</em> quote."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('class="qt-chat-dialogue"');
      expect(result).toContain('<em>famous</em>');
    });

    it('should handle multiple paragraphs in content', () => {
      const html = '<p>"First dialogue."</p><p>Not dialogue.</p><p>"Second dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      const dialogueMatches = (result.match(/class="qt-chat-dialogue"/g) || []).length;
      expect(dialogueMatches).toBe(2);
    });

    it('should preserve paragraph attributes other than class', () => {
      const html = '<p id="p1" data-id="msg-1">"Dialogue."</p>';
      const result = applyDialogueDetection(html, DEFAULT_DETECTION);
      expect(result).toContain('id="p1"');
      expect(result).toContain('data-id="msg-1"');
      expect(result).toContain('class="qt-chat-dialogue"');
    });

    it('should not add dialogue class if only start OR end quote present', () => {
      const html1 = '<p>"Only start quote</p>';
      const result1 = applyDialogueDetection(html1, DEFAULT_DETECTION);
      expect(result1).not.toContain('class="qt-chat-dialogue"');

      const html2 = '<p>Only end quote"</p>';
      const result2 = applyDialogueDetection(html2, DEFAULT_DETECTION);
      expect(result2).not.toContain('class="qt-chat-dialogue"');
    });
  });

  describe('applyLineScopedClasses', () => {
    const lineRules: CompiledRule[] = [
      { regex: /^\/\/ .+$/, className: 'qt-chat-ooc', scope: 'line' },
      { regex: /^\[(?:[^\p{Ll}]+)\].*$/u, className: 'qt-chat-tag', scope: 'line' },
    ];

    it('adds the line class to a paragraph whose whole text is a line prefix', () => {
      const result = applyLineScopedClasses('<p>// an aside</p>', lineRules);
      expect(result).toContain('class="qt-chat-ooc"');
    });

    it('adds the line class to a tag-prefixed paragraph (uppercase token)', () => {
      const result = applyLineScopedClasses('<p>[CAPTAIN] All hands!</p>', lineRules);
      expect(result).toContain('class="qt-chat-tag"');
    });

    it('does not match a lowercase tag token', () => {
      const result = applyLineScopedClasses('<p>[captain] hi</p>', lineRules);
      expect(result).not.toContain('class="qt-chat-tag"');
    });

    it('applies the class to other block elements (h2, li, blockquote)', () => {
      expect(applyLineScopedClasses('<h2>// note</h2>', lineRules)).toContain('class="qt-chat-ooc"');
      expect(applyLineScopedClasses('<li>// note</li>', lineRules)).toContain('class="qt-chat-ooc"');
      expect(applyLineScopedClasses('<blockquote>// note</blockquote>', lineRules)).toContain('class="qt-chat-ooc"');
    });

    it('leaves a non-matching paragraph untouched', () => {
      const html = '<p>just ordinary prose</p>';
      expect(applyLineScopedClasses(html, lineRules)).toBe(html);
    });

    it('is a no-op when there are no line-scoped rules', () => {
      const html = '<p>// looks like ooc</p>';
      const inlineOnly: CompiledRule[] = [{ regex: /\*[^*]+\*/, className: 'qt-chat-narration', scope: 'inline' }];
      expect(applyLineScopedClasses(html, inlineOnly)).toBe(html);
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
