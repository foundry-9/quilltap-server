import { checkRegexSafety, compileSafeRegex } from '@/lib/utils/safe-regex';
import { sanitizeClassName } from '@/lib/utils/css-class';
import {
  DEFAULT_RENDERING_PATTERNS,
  compileRenderingPatterns,
} from '@/lib/chat/roleplay-rendering';
import { StrictRenderingPatternSchema, RenderingPatternSchema, DialogueDetectionSchema } from '@/lib/schemas/template.types';
import { generateTemplateRenderingPatterns } from '@/lib/chat/annotations';

describe('checkRegexSafety', () => {
  it.each(['(a+)+', '(.*)*', '(\\w+\\s?)*', '(a|b+)+c', '(x{2,})+'])('refuses %s', (p) => {
    expect(checkRegexSafety(p).ok).toBe(false);
  });
  it.each(['\\(\\([^)]+\\)\\)', '(?<!\\*)\\*[^*]+\\*(?!\\*)', '(abc)+', '[a+]+', '(\\+)+', '^// .+$'])('accepts %s', (p) => {
    expect(checkRegexSafety(p).ok).toBe(true);
  });
  it('refuses over-long patterns', () => {
    expect(checkRegexSafety('a'.repeat(501)).ok).toBe(false);
  });
  it('compileSafeRegex reports syntax errors', () => {
    expect(compileSafeRegex('(').ok).toBe(false);
    expect(compileSafeRegex('a+').ok).toBe(true);
  });
});

describe('template class names and patterns', () => {
  it('sanitises class names', () => {
    expect(sanitizeClassName('qt-a" onmouseover="x')).toBe('qt-a onmouseoverx');
  });
  it('reads legacy bad class names without throwing', () => {
    const r = RenderingPatternSchema.parse({ pattern: 'a', className: 'x"><script>' });
    expect(r.className).toBe('xscript');
    expect(DialogueDetectionSchema.parse({ openingChars: ['"'], closingChars: ['"'], className: 'a<b' }).className).toBe('ab');
  });
  it('rejects bad class names and patterns on write', () => {
    expect(StrictRenderingPatternSchema.safeParse({ pattern: 'a', className: 'x"y' }).success).toBe(false);
    expect(StrictRenderingPatternSchema.safeParse({ pattern: '(a+)+', className: 'ok' }).success).toBe(false);
    expect(StrictRenderingPatternSchema.safeParse({ pattern: 'a', className: 'ok-1 two_' }).success).toBe(true);
  });
  it('built-in and generated patterns pass strict validation and compile', () => {
    const generated = generateTemplateRenderingPatterns({
      delimiters: [], narrationDelimiters: '*', unmarkedStyle: null, markdownAsterisks: true,
    } as never);
    for (const p of [...DEFAULT_RENDERING_PATTERNS, ...generated]) {
      expect(StrictRenderingPatternSchema.safeParse(p).success).toBe(true);
    }
    expect(compileRenderingPatterns(DEFAULT_RENDERING_PATTERNS)).toHaveLength(
      DEFAULT_RENDERING_PATTERNS.filter((p) => p.scope !== 'literal' && p.scope !== 'strip').length,
    );
  });
  it('compile skips unsafe patterns instead of throwing', () => {
    const rules = compileRenderingPatterns([
      { pattern: '(a+)+', className: 'x' },
      { pattern: 'b', className: 'y"z' },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].className).toBe('yz');
  });
});
