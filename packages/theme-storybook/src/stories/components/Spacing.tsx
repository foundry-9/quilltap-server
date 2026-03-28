/**
 * Spacing Story Component
 *
 * Displays spacing and border radius tokens for theme development.
 */

import React from 'react';

export const Spacing: React.FC = () => {
  const radiusTokens = [
    { name: 'None', variable: '0', value: '0' },
    { name: 'Small', variable: '--radius-sm', value: 'var(--radius-sm)' },
    { name: 'Medium', variable: '--radius-md', value: 'var(--radius-md)' },
    { name: 'Large', variable: '--radius-lg', value: 'var(--radius-lg)' },
    { name: 'Extra Large', variable: '--radius-xl', value: 'var(--radius-xl)' },
    { name: 'Full', variable: '9999px', value: '9999px' },
  ];

  const componentRadii = [
    { name: 'Button', variable: '--qt-button-radius' },
    { name: 'Card', variable: '--qt-card-radius' },
    { name: 'Input', variable: '--qt-input-radius' },
    { name: 'Dialog', variable: '--qt-dialog-radius' },
    { name: 'Badge', variable: '--qt-badge-radius' },
    { name: 'Avatar', variable: '--qt-avatar-radius' },
    { name: 'Chat Message', variable: '--qt-chat-message-radius' },
  ];

  const shadowTokens = [
    { name: 'Card Shadow', variable: '--qt-card-shadow' },
    { name: 'Card Hover Shadow', variable: '--qt-card-shadow-hover' },
    { name: 'Panel Shadow', variable: '--qt-panel-shadow' },
    { name: 'Dialog Shadow', variable: '--qt-dialog-shadow' },
    { name: 'Popover Shadow', variable: '--qt-popover-shadow' },
    { name: 'Button Primary Shadow', variable: '--qt-button-primary-shadow' },
    { name: 'Chat Message Shadow', variable: '--qt-chat-message-shadow' },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Spacing & Borders</h2>

      {/* Border Radius Scale */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Border Radius Scale
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(6rem, 1fr))', gap: '1.5rem' }}>
          {radiusTokens.map(({ name, variable, value }) => (
            <div key={variable} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '5rem',
                  height: '5rem',
                  backgroundColor: 'var(--color-primary)',
                  borderRadius: value,
                  margin: '0 auto 0.5rem',
                }}
              />
              <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{name}</div>
              <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>{variable}</code>
            </div>
          ))}
        </div>
      </section>

      {/* Component Border Radii */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Component Border Radii
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '1.5rem' }}>
          {componentRadii.map(({ name, variable }) => (
            <div key={variable} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '6rem',
                  height: '4rem',
                  backgroundColor: 'var(--color-muted)',
                  border: '1px solid var(--color-border)',
                  borderRadius: `var(${variable})`,
                  margin: '0 auto 0.5rem',
                }}
              />
              <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{name}</div>
              <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>{variable}</code>
            </div>
          ))}
        </div>
      </section>

      {/* Shadows */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Shadows
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: '1.5rem' }}>
          {shadowTokens.map(({ name, variable }) => (
            <div key={variable} style={{ padding: '1rem' }}>
              <div
                style={{
                  width: '100%',
                  height: '6rem',
                  backgroundColor: 'var(--color-background)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: `var(${variable})`,
                  marginBottom: '0.5rem',
                }}
              />
              <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{name}</div>
              <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>{variable}</code>
            </div>
          ))}
        </div>
      </section>

      {/* Padding Tokens */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Padding Tokens
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-background)',
                padding: 'var(--qt-button-padding-y) var(--qt-button-padding-x)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Button padding
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>
              --qt-button-padding-x, --qt-button-padding-y
            </code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-muted)',
                padding: 'var(--qt-card-padding)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Card padding
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--qt-card-padding</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-muted)',
                padding: 'var(--qt-input-padding-y) var(--qt-input-padding-x)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Input padding
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>
              --qt-input-padding-x, --qt-input-padding-y
            </code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-muted)',
                padding: 'var(--qt-chat-message-padding)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              Chat message padding
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--qt-chat-message-padding</code>
          </div>
        </div>
      </section>

      {/* Layout Dimensions */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Layout Dimensions
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 'var(--qt-navbar-height)',
                width: '200px',
                border: '1px solid var(--color-border)',
              }}
            >
              Navbar height
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--qt-navbar-height</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 'var(--qt-sidebar-width)',
                height: '100px',
                border: '1px solid var(--color-border)',
              }}
            >
              Sidebar width
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--qt-sidebar-width</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 'var(--qt-chat-sidebar-width)',
                height: '100px',
                border: '1px solid var(--color-border)',
              }}
            >
              Chat sidebar width
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>--qt-chat-sidebar-width</code>
          </div>
        </div>
      </section>
    </div>
  );
};
