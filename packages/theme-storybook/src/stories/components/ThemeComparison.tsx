/**
 * ThemeComparison Story Component
 *
 * Shows side-by-side comparison of default theme vs custom theme.
 * Essential for theme developers to see their changes in context.
 */

import React from 'react';

interface ThemePanelProps {
  title: string;
  description: string;
}

const ThemePanel: React.FC<ThemePanelProps> = ({ title, description }) => {
  return (
    <div style={{ flex: 1, minWidth: '20rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h4 style={{ fontWeight: 600 }}>{title}</h4>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>{description}</p>
      </div>

      {/* Sample Card */}
      <div className="qt-card" style={{ marginBottom: '1rem' }}>
        <div className="qt-card-header">
          <h5 className="qt-card-title">Sample Card</h5>
          <p className="qt-card-description">This is how cards look in this theme.</p>
        </div>
        <div className="qt-card-body">
          <p style={{ marginBottom: '1rem' }}>Cards are used throughout the application for grouping content.</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="qt-badge qt-badge-primary">Primary</span>
            <span className="qt-badge qt-badge-secondary">Secondary</span>
            <span className="qt-badge qt-badge-success">Success</span>
          </div>
        </div>
        <div className="qt-card-footer">
          <button className="qt-button qt-button-ghost">Cancel</button>
          <button className="qt-button qt-button-primary">Save</button>
        </div>
      </div>

      {/* Sample Form */}
      <div className="qt-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Text Input
          </label>
          <input className="qt-input" type="text" placeholder="Enter text..." />
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Select
          </label>
          <select className="qt-input qt-select">
            <option>Option 1</option>
            <option>Option 2</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="qt-button qt-button-secondary qt-button-sm">Secondary</button>
          <button className="qt-button qt-button-primary qt-button-sm">Primary</button>
        </div>
      </div>

      {/* Sample Chat */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="qt-avatar qt-avatar-sm">
            <div className="qt-avatar-fallback">AI</div>
          </div>
          <div className="qt-chat-message qt-chat-message-assistant" style={{ maxWidth: '100%' }}>
            <p style={{ fontSize: '0.875rem' }}>Hello! This is a chat message.</p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="qt-chat-message qt-chat-message-user" style={{ maxWidth: '100%' }}>
            <p style={{ fontSize: '0.875rem' }}>Great, thanks!</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ThemeComparison: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Theme Comparison</h2>
      <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1.5rem' }}>
        Compare your custom theme against the default Quilltap theme. Use the theme toggle above to switch between themes.
      </p>

      {/* Single Panel View */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Current Theme Preview
        </h3>
        <ThemePanel
          title="Active Theme"
          description="This panel shows how components look with the currently active theme."
        />
      </section>

      {/* Color Reference */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Key Theme Colors
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.75rem' }}>
          {[
            { name: 'Background', var: '--color-background' },
            { name: 'Foreground', var: '--color-foreground' },
            { name: 'Card', var: '--color-card' },
            { name: 'Primary', var: '--color-primary' },
            { name: 'Secondary', var: '--color-secondary' },
            { name: 'Muted', var: '--color-muted' },
            { name: 'Accent', var: '--color-accent' },
            { name: 'Border', var: '--color-border' },
          ].map(({ name, var: cssVar }) => (
            <div key={cssVar} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '100%',
                  height: '3rem',
                  backgroundColor: `var(${cssVar})`,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }}
              />
              <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>{name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Semantic Colors */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Semantic Colors
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.75rem' }}>
          {[
            { name: 'Destructive', var: '--color-destructive' },
            { name: 'Success', var: '--color-success' },
            { name: 'Warning', var: '--color-warning' },
          ].map(({ name, var: cssVar }) => (
            <div key={cssVar} style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '100%',
                  height: '3rem',
                  backgroundColor: `var(${cssVar})`,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }}
              />
              <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', fontWeight: 500 }}>{name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Component Showcase */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Component Showcase
        </h3>

        {/* Buttons Row */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-muted-foreground)' }}>Buttons</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="qt-button qt-button-primary">Primary</button>
            <button className="qt-button qt-button-secondary">Secondary</button>
            <button className="qt-button qt-button-ghost">Ghost</button>
            <button className="qt-button qt-button-destructive">Destructive</button>
            <button className="qt-button qt-button-primary" disabled>Disabled</button>
          </div>
        </div>

        {/* Badges Row */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-muted-foreground)' }}>Badges</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="qt-badge qt-badge-default">Default</span>
            <span className="qt-badge qt-badge-primary">Primary</span>
            <span className="qt-badge qt-badge-secondary">Secondary</span>
            <span className="qt-badge qt-badge-success">Success</span>
            <span className="qt-badge qt-badge-warning">Warning</span>
            <span className="qt-badge qt-badge-destructive">Destructive</span>
          </div>
        </div>

        {/* Interactive Card */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-muted-foreground)' }}>Interactive Card</h4>
          <div className="qt-card qt-card-interactive" style={{ maxWidth: '20rem', cursor: 'pointer' }}>
            <div className="qt-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">A</div>
                </div>
                <div>
                  <h5 className="qt-card-title">Character Name</h5>
                  <p className="qt-card-description">Click to interact</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Form Elements */}
        <div>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-muted-foreground)' }}>Form Elements</h4>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', maxWidth: '32rem' }}>
            <input className="qt-input" type="text" placeholder="Text input" style={{ flex: '1 1 10rem' }} />
            <select className="qt-input qt-select" style={{ flex: '1 1 10rem' }}>
              <option>Select option</option>
              <option>Option 1</option>
              <option>Option 2</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
};
