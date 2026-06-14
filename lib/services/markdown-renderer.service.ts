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
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';
import {
  type CompiledRule,
  DEFAULT_RENDERING_PATTERNS,
  DEFAULT_DIALOGUE_DETECTION,
  compileRenderingPatterns,
  tokenizeInline,
  lineMatchFor,
  isDialogueParagraph,
  segmentsToHtml,
  escapeMarkdownInBrackets,
} from '@/lib/chat/roleplay-rendering';
import { logger } from '@/lib/logger';

// Re-export the shared escape helper so existing importers keep working.
export { escapeMarkdownInBrackets };

// ============================================================================
// TYPES
// ============================================================================

export interface MarkdownRenderOptions {
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[];
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Process roleplay syntax in HTML content and wrap inline matches with styled
 * spans. Applied AFTER markdown conversion to handle the text nodes.
 *
 * Splits HTML by tags and only applies patterns to text content (avoiding
 * corruption of HTML attributes that contain quotes), and skips content inside
 * <code>/<pre> blocks. The actual match-walk is the shared `tokenizeInline`
 * core, so client and server can't diverge.
 */
export function applyRoleplayPatterns(html: string, compiledRules: CompiledRule[]): string {
  // Split by HTML tags to avoid matching inside them
  // This regex captures HTML tags as separate array elements
  const tagRegex = /(<[^>]*>)/g;
  const parts = html.split(tagRegex);

  // Track whether we're inside a code block
  let inCodeBlock = 0;

  // Process only non-tag parts (text content between tags)
  const processedParts = parts.map((part, index) => {
    // Parts at odd indices are HTML tags (captured groups from split)
    if (index % 2 === 1) {
      // Track code block depth - check for opening/closing tags
      const lowerPart = part.toLowerCase();
      if (lowerPart.startsWith('<code') || lowerPart.startsWith('<pre')) {
        inCodeBlock++;
      } else if (lowerPart === '</code>' || lowerPart === '</pre>') {
        inCodeBlock = Math.max(0, inCodeBlock - 1);
      }
      return part; // Return HTML tags unchanged
    }

    // Skip pattern application inside code blocks
    if (inCodeBlock > 0) {
      return part;
    }

    // Tokenize the text run with the shared core and emit HTML spans.
    return segmentsToHtml(tokenizeInline(part, compiledRules));
  });

  return processedParts.join('');
}

/**
 * Apply dialogue detection to paragraphs in HTML.
 * Adds dialogue class to <p> tags whose content starts and ends with quotes.
 */
export function applyDialogueDetection(html: string, detection: DialogueDetection): string {
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

/**
 * Apply whole-line (line-scoped) classes to block elements in HTML.
 *
 * Mirrors `applyDialogueDetection`, but for line-scoped rendering rules
 * (`linePrefix`/`tagPrefix`): if a block element's plain text is a single line
 * matching a line rule, the rule's class lands on the block element itself
 * rather than an inline span. No-op when there are no line-scoped rules.
 */
export function applyLineScopedClasses(html: string, compiledRules: CompiledRule[]): string {
  const lineRules = compiledRules.filter((r) => r.scope === 'line');
  if (lineRules.length === 0) return html;

  return html.replace(
    /<(p|li|blockquote|h[1-6])([^>]*)>([\s\S]*?)<\/\1>/g,
    (match, tag, attrs, content) => {
      // Strip HTML tags to get plain text for the line-match check
      const plainText = content.replace(/<[^>]+>/g, '');
      const lm = lineMatchFor(plainText, lineRules);
      if (!lm) return match;

      // When the rule hides its delimiter, drop the leading marker/tag from the
      // block's content. The prefix is literal text before any inline tag, so a
      // leading slice is safe and preserves inline formatting in the body.
      let body = content as string;
      if (lm.hideDelimiters && lm.prefix && body.startsWith(lm.prefix)) {
        body = body.slice(lm.prefix.length);
      }

      if (attrs.includes('class="')) {
        const newAttrs = attrs.replace(/class="([^"]*)"/, `class="$1 ${lm.className}"`);
        return `<${tag}${newAttrs}>${body}</${tag}>`;
      }
      return `<${tag}${attrs} class="${lm.className}">${body}</${tag}>`;
    },
  );
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
    // remark-breaks renders single newlines as hard <br> breaks, matching the
    // client-side MessageContent.tsx pipeline. In chat an author who hits Enter
    // means a line break, so soft breaks are preserved rather than collapsed to
    // a space (CommonMark's default). Must stay in sync with the client list.
    .use(remarkBreaks)
    .use(remarkRehype)
    .use(rehypeHighlight, {
      // Don't auto-detect language for unlabeled code blocks - causes incorrect
      // highlighting (e.g., detecting VB.NET for plain text prompts).
      // Code blocks with explicit language tags will still be highlighted.
      ignoreMissing: true,
      detect: false,
    })
    .use(rehypeStringify);
}

// Cached processor instance — reset to null when the pipeline changes
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
    const compiledRules = compileRenderingPatterns(patterns);

    // Step 2: Trim leading/trailing whitespace — a leading tab triggers markdown's
    // indented code block rule, rendering the whole message as preformatted text
    const trimmedContent = content.trim();

    // Step 3: Escape markdown inside roleplay brackets
    const escapedContent = escapeMarkdownInBrackets(trimmedContent, patterns);

    // Step 4: Convert markdown to HTML
    const processor = getProcessor();
    const file = await processor.process(escapedContent);
    let html = String(file);

    // Step 5: Apply inline roleplay patterns
    html = applyRoleplayPatterns(html, compiledRules);

    // Step 6: Apply whole-line (line-scoped) classes to block elements
    html = applyLineScopedClasses(html, compiledRules);

    // Step 7: Apply dialogue detection
    const dialogueConfig = dialogueDetection || DEFAULT_DIALOGUE_DETECTION;
    html = applyDialogueDetection(html, dialogueConfig);

    // Step 8: Wrap in container div with appropriate classes
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
