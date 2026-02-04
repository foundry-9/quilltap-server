/**
 * Server-side Markdown Renderer Service
 *
 * Pre-renders markdown content to HTML on the server for simple messages.
 * Mirrors the client-side MessageContent.tsx logic to ensure visual consistency.
 *
 * Features:
 * - Markdown to HTML conversion with GFM support
 * - Syntax highlighting for code blocks
 * - Roleplay pattern processing (dialogue, narration, OOC, inner monologue)
 * - Paragraph-level dialogue detection
 *
 * @module services/markdown-renderer.service
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';
import { logger } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface MarkdownRenderOptions {
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[];
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null;
}

// Internal compiled pattern type
interface CompiledPattern {
  regex: RegExp;
  className: string;
}

// ============================================================================
// DEFAULT PATTERNS (mirrors MessageContent.tsx)
// ============================================================================

/**
 * Default rendering patterns used when template doesn't specify any.
 * Includes common patterns from both Standard and Quilltap-style formatting.
 */
const DEFAULT_RENDERING_PATTERNS: RenderingPattern[] = [
  // OOC: ((comments)) - double parentheses
  { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
  // OOC: // comment - line prefix style
  { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' },
  // Dialogue: "speech" - straight and curly quotes
  { pattern: '[""][^""]+[""]', className: 'qt-chat-dialogue' },
  // Narration: *actions* - single asterisks (not bold **)
  { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
  // Narration: [actions] - square brackets (not links)
  { pattern: '\\[[^\\]]+\\](?!\\()', className: 'qt-chat-narration' },
  // Internal monologue: {thoughts} - excludes {{template}} variables
  { pattern: '(?<!\\{)\\{[^{}]+\\}(?!\\})', className: 'qt-chat-inner-monologue' },
];

/**
 * Default dialogue detection for paragraph-level styling.
 * Handles straight and curly quotes.
 */
const DEFAULT_DIALOGUE_DETECTION: DialogueDetection = {
  openingChars: ['"', '"'],
  closingChars: ['"', '"'],
  className: 'qt-chat-dialogue',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compile string patterns to RegExp objects
 */
function compilePatterns(patterns: RenderingPattern[]): CompiledPattern[] {
  return patterns.map(p => ({
    regex: new RegExp(p.pattern, p.flags || 'g'),
    className: p.className,
  }));
}

/**
 * Escape markdown syntax characters inside roleplay brackets to prevent
 * markdown from breaking up the segments before we can style them.
 * This handles cases like [narration with *emphasis* inside]
 *
 * IMPORTANT: This function preserves fenced code blocks (``` ... ```) unchanged
 * to prevent corrupting code content with escape sequences.
 */
function escapeMarkdownInBrackets(content: string, patterns: RenderingPattern[]): string {
  // Characters that trigger markdown parsing
  const markdownChars = /([*_~`])/g;

  // Check if patterns include bracket-style narration [...]
  const hasBracketNarration = patterns.some(p => p.pattern.includes('\\['));
  // Check if patterns include brace-style monologue {...}
  const hasBraceMonologue = patterns.some(p => p.pattern.includes('\\{'));
  // Check if patterns include single-asterisk narration *...*
  const hasAsteriskNarration = patterns.some(p =>
    p.pattern.includes('\\*') && p.className === 'qt-chat-narration'
  );

  // If no relevant patterns, return content unchanged
  if (!hasBracketNarration && !hasBraceMonologue && !hasAsteriskNarration) {
    return content;
  }

  // Split content by fenced code blocks to preserve them unchanged
  // Match ``` optionally followed by language, then content, then closing ```
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const parts = content.split(codeBlockRegex);

  // Process only non-code-block parts
  const processedParts = parts.map((part, index) => {
    // Odd indices are code blocks (captured groups from split)
    if (index % 2 === 1) {
      return part; // Return code blocks unchanged
    }

    let result = part;

    // Escape inside [...] if bracket narration is in patterns
    if (hasBracketNarration) {
      result = result.replace(/\[([^\]]+)\](?!\()/g, (match, inner) => {
        // Escape markdown characters with backslash
        const escaped = inner.replace(markdownChars, '\\$1');
        return `[${escaped}]`;
      });
    }

    // Escape inside {...} if brace monologue is in patterns
    // Excludes {{template}} variables using lookbehind/lookahead
    if (hasBraceMonologue) {
      result = result.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (match, inner) => {
        const escaped = inner.replace(markdownChars, '\\$1');
        return `{${escaped}}`;
      });
    }

    // Escape inside *...* if single asterisks are used for narration
    // Be careful not to double-escape or break bold **...**
    if (hasAsteriskNarration) {
      // Match single asterisk pairs that aren't bold
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (match, inner) => {
        // Only escape if there are nested markdown chars (unlikely but safe)
        const escaped = inner.replace(/([_~`])/g, '\\$1');
        return `*${escaped}*`;
      });
    }

    return result;
  });

  return processedParts.join('');
}

/**
 * Process roleplay syntax in HTML content and wrap matches with styled spans.
 * This is applied AFTER markdown conversion to handle the text nodes.
 *
 * IMPORTANT: This function splits HTML by tags and only applies patterns to
 * text content, avoiding corruption of HTML attributes that contain quotes.
 */
function applyRoleplayPatterns(html: string, compiledPatterns: CompiledPattern[]): string {
  // Split by HTML tags to avoid matching inside them
  // This regex captures HTML tags as separate array elements
  const tagRegex = /(<[^>]*>)/g;
  const parts = html.split(tagRegex);

  // Process only non-tag parts (text content between tags)
  const processedParts = parts.map((part, index) => {
    // Parts at odd indices are HTML tags (captured groups from split)
    if (index % 2 === 1) {
      return part; // Return HTML tags unchanged
    }

    // Apply patterns only to text content
    let result = part;
    for (const pattern of compiledPatterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : pattern.regex.flags + 'g');
      result = result.replace(regex, (match) => {
        return `<span class="${pattern.className}">${match}</span>`;
      });
    }
    return result;
  });

  return processedParts.join('');
}

/**
 * Check if text content represents dialogue based on configured detection
 * Uses the openingChars and closingChars from DialogueDetection config
 */
function isDialogueParagraph(text: string, detection: DialogueDetection): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;

  const firstChar = trimmed[0];
  const lastChar = trimmed[trimmed.length - 1];

  return detection.openingChars.includes(firstChar) && detection.closingChars.includes(lastChar);
}

/**
 * Apply dialogue detection to paragraphs in HTML.
 * Adds dialogue class to <p> tags whose content starts and ends with quotes.
 */
function applyDialogueDetection(html: string, detection: DialogueDetection): string {
  // Match paragraph tags and their content
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (match, attrs, content) => {
    // Strip HTML tags to get plain text for detection
    const plainText = content.replace(/<[^>]+>/g, '');

    if (isDialogueParagraph(plainText, detection)) {
      // Add dialogue class to existing class attribute or create new one
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

// ============================================================================
// MARKDOWN PROCESSOR
// ============================================================================

/**
 * Create a unified markdown processor for server-side rendering.
 * This is cached to avoid recreating the processor for each message.
 */
function createMarkdownProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeHighlight, {
      // Don't auto-detect language for unlabeled code blocks - causes incorrect
      // highlighting (e.g., detecting VB.NET for plain text prompts).
      // Code blocks with explicit language tags will still be highlighted.
      ignoreMissing: true,
      detect: false,
    })
    .use(rehypeStringify, { allowDangerousHtml: true });
}

// Cached processor instance
let cachedProcessor: ReturnType<typeof createMarkdownProcessor> | null = null;

function getProcessor() {
  if (!cachedProcessor) {
    cachedProcessor = createMarkdownProcessor();
  }
  return cachedProcessor;
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

/**
 * Render markdown content to HTML with roleplay pattern support.
 * This mirrors the client-side MessageContent.tsx behavior.
 *
 * @param content - Raw markdown content
 * @param options - Rendering options including patterns and dialogue detection
 * @returns HTML string ready for dangerouslySetInnerHTML
 */
export async function renderMarkdownToHtml(
  content: string,
  options: MarkdownRenderOptions = {}
): Promise<string> {
  const {
    renderingPatterns = DEFAULT_RENDERING_PATTERNS,
    dialogueDetection = DEFAULT_DIALOGUE_DETECTION,
  } = options;

  try {
    // Step 1: Compile patterns
    const patterns = renderingPatterns.length > 0 ? renderingPatterns : DEFAULT_RENDERING_PATTERNS;
    const compiledPatterns = compilePatterns(patterns);

    // Step 2: Escape markdown inside roleplay brackets
    const escapedContent = escapeMarkdownInBrackets(content, patterns);

    // Step 3: Convert markdown to HTML
    const processor = getProcessor();
    const file = await processor.process(escapedContent);
    let html = String(file);

    // Step 4: Apply roleplay patterns
    html = applyRoleplayPatterns(html, compiledPatterns);

    // Step 5: Apply dialogue detection
    const dialogueConfig = dialogueDetection || DEFAULT_DIALOGUE_DETECTION;
    html = applyDialogueDetection(html, dialogueConfig);

    // Step 6: Wrap in container div with appropriate classes
    // Note: We don't add the outer container class here - the client handles that
    return html;
  } catch (error) {
    logger.error('[MarkdownRenderer] Failed to render markdown', { contentLength: content.length }, error instanceof Error ? error : undefined);
    // Fall back to returning escaped content as plain text
    return `<p>${escapeHtml(content)}</p>`;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if a message is suitable for server-side pre-rendering.
 * Simple messages without tools or attachments can be pre-rendered.
 *
 * @param role - Message role (USER, ASSISTANT, TOOL)
 * @param hasAttachments - Whether the message has file attachments
 * @param hasEmbeddedTool - Whether the message has embedded tool calls
 * @returns true if the message can be pre-rendered
 */
export function canPreRenderMessage(
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
