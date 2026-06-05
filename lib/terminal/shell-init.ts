/**
 * Terminal Shell Bootstrap
 *
 * Generates the per-session shell init that every Ariel terminal is spawned with:
 *   1. (handled in pty-manager) QUILLTAP_DATA_DIR pointing at the current instance.
 *   2. A `quilltap` alias to the repo's dev CLI when an on-PATH copy differs from the server.
 *   3. (bash) the quilltap CLI bash completions.
 *   4. (bash) a prompt that shows the working directory before `$ `.
 *
 * bash receives all of #2/#3/#4 via a generated `--rcfile`; zsh receives #2 (the alias)
 * via a per-session ZDOTDIR. Every other shell gets only #1 (the env var, set upstream).
 *
 * The pure builders (`buildBashInitScript`, `buildZshInitFiles`, `shellSingleQuote`) are
 * the unit-tested surface; `prepareShellInit` wires them to disk for the PTY manager.
 *
 * @module terminal/shell-init
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import path from 'path';
import packageJson from '@/package.json';
import { logger } from '@/lib/logger';

const shellInitLogger = logger.child({ module: 'terminal-shell-init' });

/** The running server's version, used to decide whether the on-PATH CLI is stale. */
export function getServerVersion(): string {
  return (packageJson as { version: string }).version;
}

/**
 * Resolve the repo's `quilltap` CLI entry point if it exists on disk.
 *
 * In dev `process.cwd()` is the repo root, so the script is present and version-matched to
 * the server. In standalone/production builds the path is absent → returns `''`, and no
 * alias is emitted (the bootstrap degrades to prompt + PATH completions only).
 */
export function resolveCliScriptPath(): string {
  const scriptPath = path.join(process.cwd(), 'packages', 'quilltap', 'bin', 'quilltap.js');
  return existsSync(scriptPath) ? scriptPath : '';
}

/**
 * Escape a string for safe embedding inside a single-quoted POSIX shell literal.
 * `'` becomes `'\''` (close quote, escaped quote, reopen quote).
 */
export function shellSingleQuote(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

/**
 * The conditional `quilltap` alias block shared by bash and zsh.
 *
 * The CLI path lives in `__qt_script` and the alias references it as `"$__qt_script"` so the
 * value is re-quoted at invocation time — robust against spaces/quotes in the path. `command
 * quilltap` deliberately bypasses the alias to probe the *installed* binary's version; an
 * empty result (no CLI on PATH) compares unequal and triggers the alias. `__qt_script` is left
 * defined on purpose so the alias can dereference it.
 */
function aliasBlock(serverVersion: string, cliScriptPath: string): string {
  return [
    `__qt_server_ver='${shellSingleQuote(serverVersion)}'`,
    `__qt_script='${shellSingleQuote(cliScriptPath)}'`,
    `if [ -n "$__qt_script" ] && [ -f "$__qt_script" ]; then`,
    `  if [ "$(command quilltap -v 2>/dev/null | tr -d '[:space:]')" != "$__qt_server_ver" ]; then`,
    `    alias quilltap='node "$__qt_script"'`,
    `    __qt_repo_cli=1`,
    `  fi`,
    `fi`,
  ].join('\n');
}

/**
 * Build the contents of the bash `--rcfile` for a terminal session.
 * Covers requirements #1 (data dir), #2 (alias), #3 (completions), and #4 (prompt).
 */
export function buildBashInitScript(opts: {
  serverVersion: string;
  cliScriptPath: string;
  dataDir: string;
}): string {
  return `# Quilltap terminal bootstrap (bash) — generated per session, do not edit
# Load the user's normal interactive config first so nothing is lost.
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

# (#1) Pin QUILLTAP_DATA_DIR to the instance this server runs, AFTER the user's config —
# which may export its own QUILLTAP_DATA_DIR (for general CLI use) that would otherwise win.
export QUILLTAP_DATA_DIR='${shellSingleQuote(opts.dataDir)}'

# (#2) Point \`quilltap\` at the version-matched dev CLI when an installed copy differs.
__qt_repo_cli=0
${aliasBlock(opts.serverVersion, opts.cliScriptPath)}

# (#3) Load bash completions from whichever CLI matches the server.
if [ "$__qt_repo_cli" = "1" ]; then
  source <(node "$__qt_script" completion bash 2>/dev/null) 2>/dev/null
elif command -v quilltap >/dev/null 2>&1; then
  source <(command quilltap completion bash 2>/dev/null) 2>/dev/null
fi

# (#4) Prompt: working directory (blue) before the usual \`$ \`.
PS1='\\[\\e[1;34m\\]\\w\\[\\e[0m\\] \\$ '

unset __qt_server_ver __qt_repo_cli
`;
}

/**
 * Build the `.zshenv` + `.zshrc` placed in a per-session ZDOTDIR for zsh.
 *
 * `.zshenv` is read first (ZDOTDIR still points here) and must NOT change ZDOTDIR, or zsh
 * would look for `.zshrc` in the wrong place — it only sources the user's original `.zshenv`.
 * `.zshrc` restores ZDOTDIR to the original, sources the user's real `.zshrc`, then adds the
 * `quilltap` alias (#2 only — prompt/completion are bash-only per the chosen scope).
 */
export function buildZshInitFiles(opts: {
  serverVersion: string;
  cliScriptPath: string;
  dataDir: string;
}): { zshenv: string; zshrc: string } {
  const zshenv = `# Quilltap terminal bootstrap (zsh .zshenv) — generated per session, do not edit
[ -f "\${QT_ORIG_ZDOTDIR:-$HOME}/.zshenv" ] && source "\${QT_ORIG_ZDOTDIR:-$HOME}/.zshenv"
`;

  const zshrc = `# Quilltap terminal bootstrap (zsh .zshrc) — generated per session, do not edit
# Restore ZDOTDIR before loading the user's config so subshells/user scripts behave normally.
export ZDOTDIR="\${QT_ORIG_ZDOTDIR:-$HOME}"
[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"

# (#1) Pin QUILLTAP_DATA_DIR to the instance this server runs, AFTER the user's config —
# which may export its own QUILLTAP_DATA_DIR (for general CLI use) that would otherwise win.
export QUILLTAP_DATA_DIR='${shellSingleQuote(opts.dataDir)}'

# (#2) Point \`quilltap\` at the version-matched dev CLI when an installed copy differs.
__qt_repo_cli=0
${aliasBlock(opts.serverVersion, opts.cliScriptPath)}

unset __qt_server_ver __qt_repo_cli
`;

  return { zshenv, zshrc };
}

/**
 * Identify the shell family from a shell path/binary.
 * Strips a trailing `.exe` and lowercases, e.g. `/bin/bash` → `bash`, `C:\\zsh.exe` → `zsh`.
 */
function shellBasename(shell: string): string {
  return path
    .basename(shell)
    .toLowerCase()
    .replace(/\.exe$/, '');
}

export interface PreparedShellInit {
  /** Extra argv to pass to the shell binary (e.g. `--rcfile <path>` for bash). */
  args: string[];
  /** Env overrides to merge for the spawned shell (e.g. ZDOTDIR for zsh). */
  envOverrides: Record<string, string>;
  /** Remove any on-disk init artifacts; call on session exit. */
  cleanup?: () => void;
}

/**
 * Prepare shell-specific bootstrap for a session: writes the init artifact(s) to `dir` and
 * returns the argv / env overrides the PTY manager should apply, plus a cleanup closure.
 *
 * Failures are logged and swallowed — a bootstrap problem must never block spawning a shell.
 */
export function prepareShellInit(opts: {
  shell: string;
  sessionId: string;
  dir: string;
  /** The instance data dir to pin (QUILLTAP_DATA_DIR), typically `getBaseDataDir()`. */
  dataDir: string;
}): PreparedShellInit {
  const base = shellBasename(opts.shell);
  const serverVersion = getServerVersion();
  const cliScriptPath = resolveCliScriptPath();
  const { dataDir } = opts;

  shellInitLogger.debug('[ShellInit] Preparing terminal bootstrap', {
    sessionId: opts.sessionId,
    shell: opts.shell,
    shellBase: base,
    repoCliFound: Boolean(cliScriptPath),
    serverVersion,
    dataDir,
  });

  try {
    mkdirSync(opts.dir, { recursive: true });
  } catch (err) {
    shellInitLogger.warn('[ShellInit] Failed to ensure init dir; skipping bootstrap', {
      dir: opts.dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return { args: [], envOverrides: {} };
  }

  if (base === 'bash') {
    const rcPath = path.join(opts.dir, `init-${opts.sessionId}.bashrc`);
    try {
      writeFileSync(rcPath, buildBashInitScript({ serverVersion, cliScriptPath, dataDir }), { mode: 0o600 });
      shellInitLogger.debug('[ShellInit] Wrote bash rcfile', { sessionId: opts.sessionId, rcPath });
      return {
        args: ['--rcfile', rcPath],
        envOverrides: {},
        cleanup: () => {
          try {
            unlinkSync(rcPath);
          } catch (err) {
            shellInitLogger.debug('[ShellInit] Failed to remove bash rcfile', {
              sessionId: opts.sessionId,
              rcPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    } catch (err) {
      shellInitLogger.warn('[ShellInit] Failed to write bash rcfile; spawning plain bash', {
        sessionId: opts.sessionId,
        rcPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return { args: [], envOverrides: {} };
    }
  }

  if (base === 'zsh') {
    const zdotdir = path.join(opts.dir, `zdotdir-${opts.sessionId}`);
    try {
      mkdirSync(zdotdir, { recursive: true });
      const { zshenv, zshrc } = buildZshInitFiles({ serverVersion, cliScriptPath, dataDir });
      writeFileSync(path.join(zdotdir, '.zshenv'), zshenv, { mode: 0o600 });
      writeFileSync(path.join(zdotdir, '.zshrc'), zshrc, { mode: 0o600 });
      shellInitLogger.debug('[ShellInit] Wrote zsh ZDOTDIR', { sessionId: opts.sessionId, zdotdir });
      return {
        args: [],
        envOverrides: {
          ZDOTDIR: zdotdir,
          QT_ORIG_ZDOTDIR: process.env.ZDOTDIR ?? '',
        },
        cleanup: () => {
          try {
            rmSync(zdotdir, { recursive: true, force: true });
          } catch (err) {
            shellInitLogger.debug('[ShellInit] Failed to remove zsh ZDOTDIR', {
              sessionId: opts.sessionId,
              zdotdir,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    } catch (err) {
      shellInitLogger.warn('[ShellInit] Failed to write zsh ZDOTDIR; spawning plain zsh', {
        sessionId: opts.sessionId,
        zdotdir,
        error: err instanceof Error ? err.message : String(err),
      });
      return { args: [], envOverrides: {} };
    }
  }

  // Other shells (sh, fish, powershell, cmd, …): only the universal env var applies.
  return { args: [], envOverrides: {} };
}
