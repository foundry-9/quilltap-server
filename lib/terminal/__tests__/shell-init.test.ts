/**
 * Unit tests for the terminal shell bootstrap builders.
 *
 * The pure builders are the tested surface; `prepareShellInit` is exercised against a
 * throwaway temp dir to confirm argv/env wiring and artifact cleanup.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildBashInitScript,
  buildZshInitFiles,
  prepareShellInit,
  shellSingleQuote,
} from '../shell-init';

const CLI = '/repo/packages/quilltap/bin/quilltap.js';
const VER = '4.6.0-dev.108';
const DATA = '/Users/x/iCloud/Quilltap/Friday';

describe('shellSingleQuote', () => {
  it('leaves ordinary strings untouched', () => {
    expect(shellSingleQuote('/usr/local/quilltap.js')).toBe('/usr/local/quilltap.js');
    expect(shellSingleQuote('4.6.0-dev.108')).toBe('4.6.0-dev.108');
  });

  it("escapes single quotes as '\\''", () => {
    expect(shellSingleQuote("/a/o'brien/x")).toBe("/a/o'\\''brien/x");
  });
});

describe('buildBashInitScript', () => {
  const script = buildBashInitScript({ serverVersion: VER, cliScriptPath: CLI, dataDir: DATA });

  it("sources the user's ~/.bashrc first", () => {
    expect(script).toContain('[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"');
  });

  it('pins QUILLTAP_DATA_DIR after sourcing user config (so the user rc cannot clobber it)', () => {
    const sourceIdx = script.indexOf('source "$HOME/.bashrc"');
    const exportLine = `export QUILLTAP_DATA_DIR='${DATA}'`;
    const exportIdx = script.indexOf(exportLine);
    expect(exportIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(sourceIdx);
  });

  it('embeds the server version and CLI path for the runtime alias guard', () => {
    expect(script).toContain(`__qt_server_ver='${VER}'`);
    expect(script).toContain(`__qt_script='${CLI}'`);
    expect(script).toContain('command quilltap -v 2>/dev/null');
    expect(script).toContain(`alias quilltap='node "$__qt_script"'`);
  });

  it('offers both completion sources (repo CLI and on-PATH fallback)', () => {
    expect(script).toContain('node "$__qt_script" completion bash');
    expect(script).toContain('command quilltap completion bash');
  });

  it('sets a colored working-directory prompt before $', () => {
    // Runtime line: PS1='\[\e[1;34m\]\w\[\e[0m\] \$ '
    expect(script).toContain("PS1='\\[\\e[1;34m\\]\\w\\[\\e[0m\\] \\$ '");
  });

  it('embeds an empty path (no repo CLI) without breaking the guard', () => {
    const noCli = buildBashInitScript({ serverVersion: VER, cliScriptPath: '', dataDir: DATA });
    expect(noCli).toContain(`__qt_script=''`);
    // The alias line is static shell text; the runtime `[ -n "$__qt_script" ]` guard suppresses it.
    expect(noCli).toContain(`alias quilltap='node "$__qt_script"'`);
  });

  it('escapes a single quote in the CLI path', () => {
    const quirky = buildBashInitScript({ serverVersion: VER, cliScriptPath: "/o'brien/quilltap.js", dataDir: DATA });
    expect(quirky).toContain(`__qt_script='/o'\\''brien/quilltap.js'`);
  });
});

describe('buildZshInitFiles', () => {
  const { zshenv, zshrc } = buildZshInitFiles({ serverVersion: VER, cliScriptPath: CLI, dataDir: DATA });

  it('.zshenv sources the original .zshenv', () => {
    expect(zshenv).toContain('"${QT_ORIG_ZDOTDIR:-$HOME}/.zshenv"');
  });

  it('.zshrc restores ZDOTDIR then sources the original .zshrc', () => {
    expect(zshrc).toContain('export ZDOTDIR="${QT_ORIG_ZDOTDIR:-$HOME}"');
    expect(zshrc).toContain('source "$ZDOTDIR/.zshrc"');
  });

  it('.zshrc pins QUILLTAP_DATA_DIR after sourcing user config', () => {
    const sourceIdx = zshrc.indexOf('source "$ZDOTDIR/.zshrc"');
    const exportIdx = zshrc.indexOf(`export QUILLTAP_DATA_DIR='${DATA}'`);
    expect(exportIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(sourceIdx);
  });

  it('.zshrc emits the conditional quilltap alias', () => {
    expect(zshrc).toContain(`__qt_server_ver='${VER}'`);
    expect(zshrc).toContain(`alias quilltap='node "$__qt_script"'`);
  });

  it('.zshrc carries no bash-only prompt or completions (alias-only scope)', () => {
    expect(zshrc).not.toContain('PS1=');
    expect(zshrc).not.toContain('completion bash');
  });
});

describe('prepareShellInit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'qt-shellinit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('bash → --rcfile pointing at a written file, removed by cleanup', () => {
    const r = prepareShellInit({ shell: '/bin/bash', sessionId: 'sess-1', dir, dataDir: DATA });
    expect(r.args[0]).toBe('--rcfile');
    const rcPath = r.args[1];
    expect(rcPath.endsWith('init-sess-1.bashrc')).toBe(true);
    expect(existsSync(rcPath)).toBe(true);
    expect(readFileSync(rcPath, 'utf-8')).toContain('PS1=');
    expect(r.envOverrides).toEqual({});

    r.cleanup?.();
    expect(existsSync(rcPath)).toBe(false);
  });

  it('matches the shell family case-insensitively', () => {
    const r = prepareShellInit({ shell: '/usr/local/bin/BASH', sessionId: 'sess-up', dir, dataDir: DATA });
    expect(r.args[0]).toBe('--rcfile');
  });

  it('zsh → ZDOTDIR env override with .zshenv/.zshrc, removed by cleanup', () => {
    const r = prepareShellInit({ shell: '/bin/zsh', sessionId: 'sess-2', dir, dataDir: DATA });
    expect(r.args).toEqual([]);
    const zdotdir = r.envOverrides.ZDOTDIR;
    expect(zdotdir).toBeTruthy();
    expect('QT_ORIG_ZDOTDIR' in r.envOverrides).toBe(true);
    expect(existsSync(path.join(zdotdir, '.zshenv'))).toBe(true);
    expect(existsSync(path.join(zdotdir, '.zshrc'))).toBe(true);

    r.cleanup?.();
    expect(existsSync(zdotdir)).toBe(false);
  });

  it('other shells → env var only, no args/cleanup/artifacts', () => {
    const r = prepareShellInit({ shell: '/usr/bin/fish', sessionId: 'sess-3', dir, dataDir: DATA });
    expect(r.args).toEqual([]);
    expect(r.envOverrides).toEqual({});
    expect(r.cleanup).toBeUndefined();
  });
});
