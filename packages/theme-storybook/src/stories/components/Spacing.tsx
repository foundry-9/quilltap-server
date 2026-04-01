/**
 * Spacing Story Component
 *
 * Displays spacing and border radius tokens for theme development.
 */

import React from 'react';

export const Spacing: React.FC = () => {
  const radii = [
    { name: 'Small', variable: '--radius-sm', value: 'var(--radius-sm)' },
    { name: 'Medium', variable: '--radius-md', value: 'var(--radius-md)' },
    { name: 'Large', variable: '--radius-lg', value: 'var(--radius-lg)' },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Spacing & Borders</h2>

      {/* Border Radius */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Border Radius
        </h3>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          {radii.map(({ name, variable, value }) => (
            <div key={variable} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '6rem',
                  height: '6rem',
                  backgroundColor: 'var(--color-primary)',
                  borderRadius: value,
                }}
              />
              <div style={{ marginTop: '0.5rem', fontWeight: 500 }}>{name}</div>
              <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>{variable}</code>
            </div>
          ))}
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '6rem',
                height: '6rem',
                backgroundColor: 'var(--color-primary)',
                borderRadius: '9999px',
              }}
            />
            <div style={{ marginTop: '0.5rem', fontWeight: 500 }}>Full / Pill</div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>9999px</code>
          </div>
        </div>
      </section>

      {/* Spacing Scale */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Spacing Scale
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[4, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((px) => (
            <div key={px} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div
                style={{
                  width: `${px}px`,
                  height: '1.5rem',
                  backgroundColor: 'var(--color-primary)',
                  borderRadius: '2px',
                }}
              />
              <span style={{ fontSize: '0.875rem', fontWeight: 500, minWidth: '3rem' }}>{px}px</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>
                {(px / 16).toFixed(px % 16 === 0 ? 0 : 2)}rem
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Shadows */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Shadows
        </h3>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '8rem',
                height: '5rem',
                backgroundColor: 'var(--color-card)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
              }}
            />
            <div style={{ marginTop: '0.5rem', fontWeight: 500 }}>Small</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '8rem',
                height: '5rem',
                backgroundColor: 'var(--color-card)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
              }}
            />
            <div style={{ marginTop: '0.5rem', fontWeight: 500 }}>Medium</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '8rem',
                height: '5rem',
                backgroundColor: 'var(--color-card)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
              }}
            />
            <div style={{ marginTop: '0.5rem', fontWeight: 500 }}>Large</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '8rem',
                height: '5rem',
                backgroundColor: 'var(--color-card)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
              }}
            />
            <div style={{ marginTop: '0.5rem', fontWeight: 500 }}>XL</div>
          </div>
        </div>
      </section>
    </div>
  );
};
