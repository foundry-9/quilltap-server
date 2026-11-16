/**
 * Theme engine — one problem found in a theme, with where it is.
 *
 * The engine's results keep their messages as plain strings (what
 * `quilltap themes validate` prints, and what every older caller reads), and
 * carry these beside them: the same message, plus the bundle file it is in
 * and, for custom CSS, the line. The editor marks lines from them (Spec G
 * decision 6); the message text is never changed to make room.
 *
 * @module themes/engine/issues
 */

export interface ThemeIssue {
  /** The message exactly as the string form gives it. */
  message: string;
  /** Bundle-relative path of the file the problem is in, when it is in one. */
  file?: string;
  /** 1-based line in that file, when the engine knows it. */
  line?: number;
}

/** A located issue (`file` and `line` dropped when unknown, so they never appear as `undefined`). */
export function themeIssue(message: string, file?: string, line?: number): ThemeIssue {
  const issue: ThemeIssue = { message };
  if (file) issue.file = file;
  if (typeof line === 'number' && Number.isFinite(line) && line > 0) issue.line = line;
  return issue;
}
