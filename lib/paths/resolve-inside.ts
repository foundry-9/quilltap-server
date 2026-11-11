/**
 * Path containment — the one place a caller-supplied relative path is turned
 * into an absolute path under a base directory.
 *
 * Rules, applied in order:
 *   1. `rel` must be a string with no NUL byte.
 *   2. `rel` must be relative (an absolute `rel` is refused, never re-rooted).
 *   3. `path.resolve(base, rel)` must equal `base` or sit under it, compared
 *      with a trailing separator so `/a/theme-other` is not inside `/a/theme`.
 *   4. With `realpath: true`, the same comparison is made again after symlinks
 *      are resolved on both sides. A leaf that does not exist yet is resolved
 *      through its deepest existing ancestor, and a dangling symlink is
 *      followed to its target, so a link inside `base` that points elsewhere is
 *      refused whether or not the final file exists.
 *   5. With `mustExist: true`, a path that does not exist throws an `ENOENT`
 *      error (not a containment error), after the containment checks pass.
 *
 * The returned path is the lexical one (`path.resolve(base, rel)`); the
 * `...Detailed` variants also return the symlink-resolved forms for callers
 * that operate on the real path.
 *
 * Synchronous variants exist for call sites that cannot become async.
 *
 * @module paths/resolve-inside
 */

import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { logger as rootLogger } from '../logger';

/**
 * Debug logging only. Looked up per call and guarded, because this module is
 * imported by many others whose tests replace the logger with partial mocks.
 */
function logDebug(message: string, context: Record<string, unknown>): void {
  rootLogger?.debug?.(message, { module: 'paths:resolve-inside', ...context });
}

/** Upper bound on symlink hops followed while resolving one path. */
const MAX_SYMLINK_HOPS = 40;

export type PathOutsideBaseReason = 'invalid' | 'nul-byte' | 'absolute' | 'outside-base';

/** Thrown when a relative path cannot be placed inside its base directory. */
export class PathOutsideBaseError extends Error {
  readonly code = 'PATH_OUTSIDE_BASE' as const;

  constructor(
    readonly reason: PathOutsideBaseReason,
    readonly base: string,
    readonly rel: string
  ) {
    super(describe(reason, rel));
    this.name = 'PathOutsideBaseError';
  }
}

function describe(reason: PathOutsideBaseReason, rel: string): string {
  switch (reason) {
    case 'invalid':
      return 'Path must be a string';
    case 'nul-byte':
      return 'Path contains a NUL byte';
    case 'absolute':
      return `Path must be relative, not absolute: ${rel}`;
    case 'outside-base':
      return `Path resolves outside its base directory: ${rel}`;
  }
}

export function isPathOutsideBaseError(err: unknown): err is PathOutsideBaseError {
  return err instanceof PathOutsideBaseError;
}

export interface ResolveInsideOptions {
  /** Resolve symlinks on both sides before comparing (default false). */
  realpath?: boolean;
  /** Throw an `ENOENT` error when the resolved path does not exist (default false). */
  mustExist?: boolean;
  /** Whether `rel` may resolve to `base` itself (default true). */
  allowBase?: boolean;
}

export interface ResolvedInside {
  /** `path.resolve(base, rel)` — the lexical absolute path. */
  absolutePath: string;
  /** The symlink-resolved path (equals `absolutePath` without `realpath`). */
  realPath: string;
  /** The symlink-resolved base (equals `path.resolve(base)` without `realpath`). */
  realBase: string;
}

/**
 * Separator-aware containment test on two paths, both made absolute with
 * `path.resolve`. No filesystem access; symlinks are not considered.
 */
export function isInside(base: string, candidate: string, allowBase = true): boolean {
  const b = path.resolve(base);
  const c = path.resolve(candidate);
  if (c === b) return allowBase;
  const rel = path.relative(b, c);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

function lexicalCheck(base: string, rel: unknown, allowBase: boolean): { absBase: string; absolutePath: string } {
  if (typeof rel !== 'string') {
    throw new PathOutsideBaseError('invalid', base, String(rel));
  }
  if (rel.includes('\0') || base.includes('\0')) {
    throw new PathOutsideBaseError('nul-byte', base, rel);
  }
  if (path.isAbsolute(rel)) {
    throw new PathOutsideBaseError('absolute', base, rel);
  }
  const absBase = path.resolve(base);
  const absolutePath = path.resolve(absBase, rel);
  if (!isInside(absBase, absolutePath, allowBase)) {
    throw new PathOutsideBaseError('outside-base', base, rel);
  }
  return { absBase, absolutePath };
}

function enoent(p: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, '${p}'`);
  err.code = 'ENOENT';
  err.path = p;
  return err;
}

/**
 * Resolve every symlink in `p` that exists on disk. Missing components are
 * re-attached to the real path of their deepest existing ancestor; a dangling
 * symlink is followed to its (possibly missing) target.
 */
export async function realpathDeepest(p: string, hops = 0): Promise<string> {
  const abs = path.resolve(p);
  try {
    return await fsp.realpath(abs);
  } catch {
    // Fall through: the path (or a link along it) does not resolve.
  }
  const st = await fsp.lstat(abs).catch(() => null);
  if (st?.isSymbolicLink()) {
    if (hops >= MAX_SYMLINK_HOPS) {
      throw Object.assign(new Error(`ELOOP: too many symbolic links, '${abs}'`), { code: 'ELOOP' });
    }
    const target = await fsp.readlink(abs);
    const realParent = await realpathDeepest(path.dirname(abs), hops + 1);
    return realpathDeepest(path.resolve(realParent, target), hops + 1);
  }
  const parent = path.dirname(abs);
  if (parent === abs) return abs;
  return path.join(await realpathDeepest(parent, hops), path.basename(abs));
}

/** Synchronous {@link realpathDeepest}. */
export function realpathDeepestSync(p: string, hops = 0): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    // Fall through: the path (or a link along it) does not resolve.
  }
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(abs);
  } catch {
    st = null;
  }
  if (st?.isSymbolicLink()) {
    if (hops >= MAX_SYMLINK_HOPS) {
      throw Object.assign(new Error(`ELOOP: too many symbolic links, '${abs}'`), { code: 'ELOOP' });
    }
    const target = fs.readlinkSync(abs);
    const realParent = realpathDeepestSync(path.dirname(abs), hops + 1);
    return realpathDeepestSync(path.resolve(realParent, target), hops + 1);
  }
  const parent = path.dirname(abs);
  if (parent === abs) return abs;
  return path.join(realpathDeepestSync(parent, hops), path.basename(abs));
}

function refuseReal(base: string, rel: string, realBase: string, realPath: string): never {
  logDebug('Refusing path whose real location leaves its base', { base, rel, realBase, realPath });
  throw new PathOutsideBaseError('outside-base', base, rel);
}

/** Resolve `rel` under `base`, returning lexical and real forms. */
export async function resolveInsideDetailed(
  base: string,
  rel: string,
  options: ResolveInsideOptions = {}
): Promise<ResolvedInside> {
  const allowBase = options.allowBase ?? true;
  let lexical: ReturnType<typeof lexicalCheck>;
  try {
    lexical = lexicalCheck(base, rel, allowBase);
  } catch (err) {
    logDebug('Refusing path outside base', { base, rel, reason: (err as PathOutsideBaseError).reason });
    throw err;
  }
  const { absBase, absolutePath } = lexical;

  let realBase = absBase;
  let realPath = absolutePath;
  if (options.realpath) {
    [realBase, realPath] = await Promise.all([realpathDeepest(absBase), realpathDeepest(absolutePath)]);
    if (!isInside(realBase, realPath, allowBase)) refuseReal(base, rel, realBase, realPath);
  }

  if (options.mustExist) {
    const exists = await fsp.stat(absolutePath).then(() => true, () => false);
    if (!exists) throw enoent(absolutePath);
  }

  return { absolutePath, realPath, realBase };
}

/** Synchronous {@link resolveInsideDetailed}. */
export function resolveInsideDetailedSync(
  base: string,
  rel: string,
  options: ResolveInsideOptions = {}
): ResolvedInside {
  const allowBase = options.allowBase ?? true;
  let lexical: ReturnType<typeof lexicalCheck>;
  try {
    lexical = lexicalCheck(base, rel, allowBase);
  } catch (err) {
    logDebug('Refusing path outside base', { base, rel, reason: (err as PathOutsideBaseError).reason });
    throw err;
  }
  const { absBase, absolutePath } = lexical;

  let realBase = absBase;
  let realPath = absolutePath;
  if (options.realpath) {
    realBase = realpathDeepestSync(absBase);
    realPath = realpathDeepestSync(absolutePath);
    if (!isInside(realBase, realPath, allowBase)) refuseReal(base, rel, realBase, realPath);
  }

  if (options.mustExist && !fs.existsSync(absolutePath)) {
    throw enoent(absolutePath);
  }

  return { absolutePath, realPath, realBase };
}

/**
 * Resolve `rel` under `base` and return the absolute (lexical) path, or throw
 * {@link PathOutsideBaseError}. See the module comment for the rules.
 */
export async function resolveInside(
  base: string,
  rel: string,
  options: ResolveInsideOptions = {}
): Promise<string> {
  return (await resolveInsideDetailed(base, rel, options)).absolutePath;
}

/** Synchronous {@link resolveInside}. */
export function resolveInsideSync(base: string, rel: string, options: ResolveInsideOptions = {}): string {
  return resolveInsideDetailedSync(base, rel, options).absolutePath;
}
