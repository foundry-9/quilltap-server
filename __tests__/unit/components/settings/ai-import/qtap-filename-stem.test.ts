/**
 * @jest-environment node
 */
import { qtapFilenameStem } from '@/components/settings/ai-import/hooks/useAIImport';

describe('qtapFilenameStem', () => {
  it('keeps an ordinary name as is', () => {
    expect(qtapFilenameStem('Lady Ashworth-Vane')).toBe('Lady Ashworth-Vane');
  });

  it('drops path separators and reserved characters', () => {
    expect(qtapFilenameStem('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('collapses whitespace and strips leading dots', () => {
    expect(qtapFilenameStem('  ..The   Hidden\tOne  ')).toBe('The Hidden One');
  });

  it('falls back to "character" when nothing is left', () => {
    expect(qtapFilenameStem(null)).toBe('character');
    expect(qtapFilenameStem('')).toBe('character');
    expect(qtapFilenameStem('///')).toBe('character');
  });
});
