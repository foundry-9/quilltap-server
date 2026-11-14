/**
 * Bounded compilation of user- or model-supplied regular expressions.
 *
 * JavaScript's regex engine backtracks, so a pattern with a quantified group
 * that itself contains a quantifier (`(a+)+`, `(.*)*`, `(\w+\s?)*`) can take
 * exponential time on a near-miss input and stall the single-threaded server.
 * This helper applies a length cap and refuses those nested-quantifier shapes
 * before the pattern is compiled. It is a conservative static screen, not a
 * proof of safety.
 *
 * @module utils/safe-regex
 */

/** Longest pattern accepted, in characters. */
export const MAX_REGEX_PATTERN_LENGTH = 500;

export type SafeRegexCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether `body` (the inside of a group) contains an unbounded quantifier
 * (`*`, `+`, or `{n,}` / `{n,m}` with a range) outside character classes and
 * not escaped.
 */
function hasQuantifier(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
    } else if (c === '*' || c === '+') {
      return true;
    } else if (c === '{' && /^\{\d+,\d*\}/.test(body.slice(i))) {
      return true;
    }
  }
  return false;
}

/** Whether the character at `i` begins a quantifier that can repeat unboundedly. */
function quantifierAt(pattern: string, i: number): boolean {
  const c = pattern[i];
  if (c === '*' || c === '+') return true;
  if (c === '{') return /^\{\d+,\d*\}/.test(pattern.slice(i));
  return false;
}

/**
 * Static screen of a pattern: length cap, then refusal of a quantified group
 * whose body already contains a quantifier.
 */
export function checkRegexSafety(pattern: string): SafeRegexCheck {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return { ok: false, reason: `pattern is longer than ${MAX_REGEX_PATTERN_LENGTH} characters` };
  }

  const stack: number[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
    } else if (c === '(') {
      stack.push(i);
    } else if (c === ')') {
      const start = stack.pop();
      if (start !== undefined && quantifierAt(pattern, i + 1)) {
        const body = pattern.slice(start + 1, i);
        if (hasQuantifier(body)) {
          return { ok: false, reason: 'pattern contains a repeated group that itself repeats' };
        }
      }
    }
  }
  return { ok: true };
}

/**
 * Compile `pattern` after the safety screen. Returns the RegExp or the reason
 * it was refused (screen failure or a syntax error).
 */
export function compileSafeRegex(
  pattern: string,
  flags = '',
): { ok: true; regexp: RegExp } | { ok: false; reason: string } {
  const check = checkRegexSafety(pattern);
  if (!check.ok) return check;
  try {
    return { ok: true, regexp: new RegExp(pattern, flags) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.replace(/^Invalid regular expression:\s*/, '') };
  }
}
