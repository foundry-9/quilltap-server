/**
 * File Preview Story Component
 *
 * Displays file preview component styles for theme development.
 * Includes scroll containers, content panels, code blocks, loading states,
 * empty states, and wikilink styles.
 */

import React from 'react';

export const FilePreview: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>File Preview Components</h2>

      {/* Scroll Container */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Scroll Container
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          <code>.qt-file-preview-scroll</code> - Scrollable container for file content with configurable max height.
        </p>
        <div className="qt-file-preview-scroll" style={{ height: '150px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ padding: '1rem' }}>
            {Array.from({ length: 20 }, (_, i) => (
              <p key={i} style={{ margin: '0.5rem 0' }}>Line {i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
            ))}
          </div>
        </div>
      </section>

      {/* Content Panel */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Content Panel
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          <code>.qt-file-preview-panel</code> - Background panel for rendered markdown content.
        </p>
        <div className="qt-file-preview-panel">
          <h4 style={{ margin: '0 0 0.5rem 0' }}>Document Title</h4>
          <p style={{ margin: 0 }}>This is a content panel used for displaying rendered markdown files with a subtle background.</p>
        </div>
      </section>

      {/* Code Block */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Code Block
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          <code>.qt-file-preview-code</code> - Styled code block for plain text and source files with word wrap.
        </p>
        <pre className="qt-file-preview-code">
{`function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

// Call the function
const message = greet("World");
console.log(message);`}
        </pre>
      </section>

      {/* Loading State */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Loading State
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          <code>.qt-file-preview-loading</code> + <code>.qt-file-preview-loading-text</code> - Loading indicator.
        </p>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
          <div className="qt-file-preview-loading" style={{ minHeight: '150px' }}>
            <div className="qt-file-preview-loading-text">Loading file...</div>
          </div>
        </div>
      </section>

      {/* Empty State */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Empty / Error State
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          <code>.qt-file-preview-empty</code> + <code>.qt-file-preview-empty-icon</code> - Empty or error state display.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
            <div className="qt-file-preview-empty" style={{ minHeight: '150px' }}>
              <div className="qt-file-preview-empty-icon">📄</div>
              <p>No content available</p>
            </div>
          </div>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
            <div className="qt-file-preview-empty" style={{ minHeight: '150px' }}>
              <div className="qt-file-preview-empty-icon">⚠️</div>
              <p>Failed to load file</p>
            </div>
          </div>
        </div>
      </section>

      {/* Wikilinks */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Wikilinks
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          <code>.qt-wikilink</code> + <code>.qt-wikilink-broken</code> - Internal document links in markdown.
        </p>
        <div className="qt-file-preview-panel">
          <p style={{ margin: 0, lineHeight: 2 }}>
            This document references <button type="button" className="qt-wikilink">Character Profile</button> and
            links to <button type="button" className="qt-wikilink">World Building → Geography</button>.
            There&apos;s also a <button type="button" className="qt-wikilink-broken">Missing Document</button> that
            doesn&apos;t exist yet.
          </p>
        </div>
      </section>

      {/* CSS Variables Reference */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          CSS Variables
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.5rem' }}>
          {[
            { name: '--qt-file-preview-max-height', value: '70vh', desc: 'Max height of scroll container' },
            { name: '--qt-file-preview-min-height', value: '300px', desc: 'Min height of loading/empty states' },
            { name: '--qt-file-preview-panel-bg', value: 'muted/30%', desc: 'Content panel background' },
            { name: '--qt-code-bg', value: 'muted', desc: 'Code block background' },
            { name: '--qt-code-fg', value: 'foreground', desc: 'Code block text color' },
            { name: '--qt-code-font', value: 'monospace', desc: 'Code block font family' },
          ].map(({ name, value, desc }) => (
            <div key={name} style={{ padding: '0.75rem', background: 'var(--color-muted)', borderRadius: 'var(--radius-md)' }}>
              <code style={{ fontSize: '0.75rem', fontWeight: 600 }}>{name}</code>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginTop: '0.25rem' }}>
                Default: {value}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>
                {desc}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
