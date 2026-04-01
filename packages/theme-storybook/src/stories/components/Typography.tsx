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

      {/* Headings */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Headings
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h1 style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1.2 }}>Heading 1 (2.25rem)</h1>
          <h2 style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1.2 }}>Heading 2 (1.875rem)</h2>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3 }}>Heading 3 (1.5rem)</h3>
          <h4 style={{ fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 }}>Heading 4 (1.25rem)</h4>
          <h5 style={{ fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>Heading 5 (1.125rem)</h5>
          <h6 style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Heading 6 (1rem)</h6>
        </div>
      </section>

      {/* Body Text */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Body Text
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '40rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>Large (1.125rem)</span>
            <p style={{ fontSize: '1.125rem', lineHeight: 1.6 }}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>Base (1rem)</span>
            <p style={{ fontSize: '1rem', lineHeight: 1.6 }}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>Small (0.875rem)</span>
            <p style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>Extra Small (0.75rem)</span>
            <p style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
        </div>
      </section>

      {/* Text Colors */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Text Colors
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={{ color: 'var(--color-foreground)' }}>Primary text (--color-foreground)</p>
          <p style={{ color: 'var(--color-muted-foreground)' }}>Secondary text (--color-muted-foreground)</p>
          <p style={{ color: 'var(--color-primary)' }}>Primary color text (--color-primary)</p>
          <p style={{ color: 'var(--color-destructive)' }}>Destructive text (--color-destructive)</p>
          <p style={{ color: 'var(--color-success)' }}>Success text (--color-success)</p>
          <p style={{ color: 'var(--color-warning)' }}>Warning text (--color-warning)</p>
        </div>
      </section>
    </div>
  );
};
