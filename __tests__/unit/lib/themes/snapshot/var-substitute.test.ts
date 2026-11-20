import {
  InvalidValue,
  findVarCall,
  normaliseValue,
  substituteVars,
} from '@/lib/themes/snapshot/var-substitute';

describe('normaliseValue', () => {
  it('drops comments, collapses whitespace and trims', () => {
    expect(normaliseValue('  1px /* c */\n  solid\t red ')).toBe('1px solid red');
    expect(normaliseValue('a/* x\ny */b')).toBe('ab');
  });
});

describe('findVarCall', () => {
  it('finds a simple var and its span', () => {
    const v = 'a var(--x) b';
    const call = findVarCall(v, 0);
    expect(call).toEqual({ start: 2, end: 10, name: '--x', fallback: null });
    expect(v.slice(call!.start, call!.end)).toBe('var(--x)');
  });

  it('returns null when there is none, or from past the last one', () => {
    expect(findVarCall('1px solid', 0)).toBeNull();
    expect(findVarCall('var(--x)', 8)).toBeNull();
  });

  it('splits the fallback at the first top-level comma only', () => {
    expect(findVarCall('var(--x, 1px, 2px)', 0)).toMatchObject({ name: '--x', fallback: ' 1px, 2px' });
  });

  it('keeps nested parentheses and nested var in the fallback', () => {
    const call = findVarCall('var(--a, calc(1px + var(--b, 2px)))', 0);
    expect(call?.name).toBe('--a');
    expect(call?.fallback).toBe(' calc(1px + var(--b, 2px))');
    expect(call?.end).toBe('var(--a, calc(1px + var(--b, 2px)))'.length);
  });

  it('treats an empty fallback as empty string, not null', () => {
    expect(findVarCall('var(--x,)', 0)?.fallback).toBe('');
  });

  it('is case-insensitive for VAR(', () => {
    expect(findVarCall('VAR(--x)', 0)?.name).toBe('--x');
  });

  it('ignores var( inside quoted strings', () => {
    expect(findVarCall('"var(--x)"', 0)).toBeNull();
    expect(findVarCall("'a var(--x)' var(--y)", 0)?.name).toBe('--y');
  });

  it('ignores escaped quotes when tracking strings', () => {
    expect(findVarCall('"a\\" var(--x)" var(--y)', 0)?.name).toBe('--y');
  });

  it('ignores identifiers merely ending in var(', () => {
    expect(findVarCall('myvar(--x)', 0)).toBeNull();
    expect(findVarCall('a-var(--x)', 0)).toBeNull();
  });

  it('honours parens inside quoted fallbacks', () => {
    expect(findVarCall('var(--x, ")")', 0)?.fallback).toBe(' ")"');
  });

  it('throws InvalidValue on an unbalanced var(', () => {
    expect(() => findVarCall('var(--x', 0)).toThrow(InvalidValue);
    expect(() => findVarCall('var(--x, calc(1px)', 0)).toThrow(InvalidValue);
  });
});

describe('substituteVars', () => {
  const lookupOf = (m: Record<string, string>) => (n: string) => m[n];

  it('substitutes and normalises', () => {
    expect(substituteVars('1px solid var(--c)', lookupOf({ '--c': 'red' }))).toBe('1px solid red');
  });

  it('returns the input normalised when there are no vars', () => {
    expect(substituteVars('  1px   2px ', lookupOf({}))).toBe('1px 2px');
  });

  it('resolves chained references recursively', () => {
    expect(substituteVars('var(--a)', lookupOf({ '--a': 'var(--b)', '--b': 'blue' }))).toBe('blue');
  });

  it('substitutes multiple occurrences', () => {
    expect(substituteVars('var(--a) var(--b) var(--a)', lookupOf({ '--a': '1', '--b': '2' }))).toBe('1 2 1');
  });

  it('uses the fallback only when the lookup is undefined', () => {
    expect(substituteVars('var(--x, 3px)', lookupOf({}))).toBe('3px');
    expect(substituteVars('var(--x, 3px)', lookupOf({ '--x': '9px' }))).toBe('9px');
    expect(substituteVars('var(--x, 3px)', lookupOf({ '--x': '' }))).toBe('');
  });

  it('resolves vars within a fallback', () => {
    expect(substituteVars('var(--x, var(--y, 4px))', lookupOf({ '--y': '5px' }))).toBe('5px');
    expect(substituteVars('var(--x, var(--y, 4px))', lookupOf({}))).toBe('4px');
  });

  it('returns null with no value and no fallback', () => {
    expect(substituteVars('var(--missing)', lookupOf({}))).toBeNull();
    expect(substituteVars('1px var(--missing)', lookupOf({}))).toBeNull();
  });

  it('returns null when a looked-up value itself fails to resolve', () => {
    expect(substituteVars('var(--a)', lookupOf({ '--a': 'var(--gone)' }))).toBeNull();
  });

  it('returns null on a cycle rather than recursing forever', () => {
    expect(substituteVars('var(--a)', lookupOf({ '--a': 'var(--b)', '--b': 'var(--a)' }))).toBeNull();
  });

  it('returns null for an unbalanced var( instead of throwing', () => {
    expect(substituteVars('var(--x', lookupOf({ '--x': '1' }))).toBeNull();
  });

  it('rethrows non-InvalidValue errors from the lookup', () => {
    const lookup = () => {
      throw new TypeError('boom');
    };
    expect(() => substituteVars('var(--x)', lookup)).toThrow(TypeError);
  });

  it('leaves var() inside quoted strings alone', () => {
    expect(substituteVars('"var(--x)" var(--y)', lookupOf({ '--y': 'z' }))).toBe('"var(--x)" z');
  });
});
