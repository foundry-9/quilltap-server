/**
 * Typography Story Component
 *
 * Displays typography tokens and styles for theme development.
 */

import React from 'react';

export const Typography: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Typography</h2>

      {/* Headings */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Headings (qt-heading-*)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <h1 className="qt-heading-1">Heading 1 - The quick brown fox</h1>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-heading-1</code>
          </div>
          <div>
            <h2 className="qt-heading-2">Heading 2 - The quick brown fox</h2>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-heading-2</code>
          </div>
          <div>
            <h3 className="qt-heading-3">Heading 3 - The quick brown fox</h3>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-heading-3</code>
          </div>
          <div>
            <h4 className="qt-heading-4">Heading 4 - The quick brown fox</h4>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-heading-4</code>
          </div>
        </div>
      </section>

      {/* Body Text */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Body Text
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '40rem' }}>
          <div>
            <p className="qt-text-lead">
              Lead text - Used for introductory paragraphs that need more emphasis.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-lead</code>
          </div>
          <div>
            <p className="qt-text-large">
              Large text - Slightly larger than body text for emphasis.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-large</code>
          </div>
          <div>
            <p>
              Default body text - The standard text size for most content.
              The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.
            </p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>default / no class</code>
          </div>
          <div>
            <p className="qt-text-small">
              Small text - For less important or supplementary information.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-small</code>
          </div>
          <div>
            <p className="qt-text-xs">
              Extra small text - For fine print, captions, or metadata.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-xs</code>
          </div>
        </div>
      </section>

      {/* Text Colors */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Text Colors
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div>
            <p>Default text color</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>default</code>
          </div>
          <div>
            <p className="qt-text-muted">Muted text - For secondary content</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-muted</code>
          </div>
          <div>
            <p className="qt-text-primary">Primary text - For emphasis and links</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-primary</code>
          </div>
          <div>
            <p className="qt-text-success">Success text - For positive messages</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-success</code>
          </div>
          <div>
            <p className="qt-text-warning">Warning text - For caution messages</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-warning</code>
          </div>
          <div>
            <p className="qt-text-destructive">Destructive text - For error messages</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-destructive</code>
          </div>
          <div>
            <p className="qt-text-info">Info text - For informational messages</p>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-text-info</code>
          </div>
        </div>
      </section>

      {/* Labels & UI Text */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Labels & UI Text
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <span className="qt-label">Form Label</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginLeft: '1rem' }}>.qt-label</code>
          </div>
          <div>
            <span className="qt-hint">Hint text for form fields</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginLeft: '1rem' }}>.qt-hint</code>
          </div>
          <div>
            <span className="qt-text-label">UI Label Text</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginLeft: '1rem' }}>.qt-text-label</code>
          </div>
          <div>
            <span className="qt-text-section">Section Header</span>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginLeft: '1rem' }}>.qt-text-section</code>
          </div>
        </div>
      </section>

      {/* Code & Monospace */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Code & Monospace
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <code className="qt-code-inline">inline code example</code>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginLeft: '1rem' }}>.qt-code-inline</span>
          </div>
          <div>
            <pre className="qt-code-block">
{`function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));`}
            </pre>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-code-block</code>
          </div>
        </div>
      </section>

      {/* Prose */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Prose (Long-form Content)
        </h3>
        <div className="qt-prose" style={{ maxWidth: '40rem' }}>
          <h3>Article Title</h3>
          <p>
            This is an example of the <code>.qt-prose</code> class applied to a container.
            It provides sensible defaults for long-form content like articles, documentation,
            and chat messages.
          </p>
          <p>
            The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.
            How vexingly quick daft zebras jump! The five boxing wizards jump quickly.
          </p>
          <h4>Subsection</h4>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
            exercitation ullamco laboris.
          </p>
        </div>
        <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>.qt-prose</code>
      </section>

      {/* Font Families */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Font Families
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--font-sans</code>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '1.125rem', marginTop: '0.25rem' }}>
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
          <div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--font-serif</code>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', marginTop: '0.25rem' }}>
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
          <div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--font-mono</code>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '1.125rem', marginTop: '0.25rem' }}>
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
