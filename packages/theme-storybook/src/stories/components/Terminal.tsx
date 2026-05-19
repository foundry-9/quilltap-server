/**
 * Terminal Story Component
 *
 * Previews the in-chat terminal embed, pop-out page, and Terminal Mode pane
 * surfaces. The terminal carries its own (dark) identity by default — themes
 * can override --qt-terminal-* and --qt-terminal-chrome-* tokens to retint
 * the whole stack (e.g. a parchment terminal, a CRT terminal, etc).
 */

import React from 'react';

const sampleOutput = `$ git status
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
$ npm run dev
> next dev
  ▲ Next.js 16.0.0
  - Local:        http://localhost:3000
  - ready started server on 0.0.0.0:3000`;

export const Terminal: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        Terminal Components
      </h2>
      <p style={{ marginBottom: '1.5rem', color: 'var(--color-muted-foreground)' }}>
        The terminal carries its own identity. By default it stays dark in both
        light and dark themes — but a theme can override{' '}
        <code>--qt-terminal-bg</code>, <code>--qt-terminal-fg</code>, and the
        <code>--qt-terminal-chrome-*</code> tokens to reskin every surface below.
      </p>

      {/* In-chat embed */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          In-chat embed
        </h3>
        <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
          <code>.qt-terminal-embed</code> wraps the embed card; the header and
          footer strips inherit the surrounding theme so they nest cleanly with
          chat bubbles.
        </p>
        <div className="qt-terminal-embed" style={{ maxWidth: '36rem' }}>
          <div className="qt-terminal-embed-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 500, margin: 0 }}>
                Terminal — zsh
              </h4>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="qt-button-icon" type="button">Pop out</button>
              <button className="qt-button-icon qt-text-destructive" type="button">Kill</button>
            </div>
          </div>
          <div className="qt-terminal-surface" style={{ padding: '0.75rem', fontFamily: 'var(--qt-font-mono, monospace)', color: 'var(--qt-terminal-fg)', fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>
            {sampleOutput}
          </div>
        </div>
      </section>

      {/* Footer state */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Embed footer (handed off to Terminal Mode pane)
        </h3>
        <div className="qt-terminal-embed" style={{ maxWidth: '36rem' }}>
          <div className="qt-terminal-embed-header">
            <h4 style={{ fontSize: '0.875rem', fontWeight: 500, margin: 0 }}>
              Terminal — zsh
            </h4>
          </div>
          <div className="qt-terminal-embed-footer">
            <span className="qt-text-secondary">Showing in Terminal Mode pane.</span>
            <button className="qt-button-secondary" type="button" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
              Go to pane →
            </button>
          </div>
        </div>
      </section>

      {/* Pop-out page */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Pop-out page chrome
        </h3>
        <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
          The full-screen pop-out page uses{' '}
          <code>.qt-terminal-popout-page</code> as the outer canvas and{' '}
          <code>.qt-terminal-popout-header</code> for the breadcrumb bar.
        </p>
        <div className="qt-terminal-popout-page" style={{ borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid var(--color-border)', height: '240px', display: 'flex', flexDirection: 'column' }}>
          <div className="qt-terminal-popout-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button className="qt-button-icon" type="button" style={{ color: 'inherit' }}>←</button>
              <a href="#" className="qt-terminal-popout-link" style={{ fontSize: '0.875rem' }}>Chat</a>
              <span className="qt-terminal-popout-separator">/</span>
              <h1 className="qt-terminal-popout-title" style={{ fontSize: '1rem', margin: 0 }}>
                Terminal — zsh
              </h1>
            </div>
            <button className="qt-button-destructive" type="button" style={{ fontSize: '0.875rem' }}>
              Kill Session
            </button>
          </div>
          <div style={{ flex: 1, padding: '0.75rem', fontFamily: 'var(--qt-font-mono, monospace)', color: 'var(--qt-terminal-fg)', fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>
            {sampleOutput}
          </div>
        </div>
      </section>

      {/* Closed badge */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Session-exited overlay
        </h3>
        <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>
          When the PTY exits but the terminal stays mounted, the{' '}
          <code>.qt-terminal-closed-badge</code> overlay marks it.
        </p>
        <div className="qt-terminal-surface" style={{ position: 'relative', height: '120px', borderRadius: '0.5rem' }}>
          <span className="qt-terminal-closed-badge">Closed</span>
        </div>
      </section>
    </div>
  );
};
