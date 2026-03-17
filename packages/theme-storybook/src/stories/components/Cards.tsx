/**
 * Cards Story Component
 *
 * Displays all card variants for theme development.
 */

import React from 'react';

export const Cards: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Cards</h2>

      {/* Basic Card */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Basic Card
        </h3>
        <div className="qt-card" style={{ maxWidth: '24rem' }}>
          <div className="qt-card-header">
            <h4 className="qt-card-title">Card Title</h4>
            <p className="qt-card-description">Card description goes here.</p>
          </div>
          <div className="qt-card-body">
            <p>This is the card body content. It can contain any content you want.</p>
          </div>
          <div className="qt-card-footer">
            <button className="qt-button qt-button-ghost">Cancel</button>
            <button className="qt-button qt-button-primary">Save</button>
          </div>
        </div>
      </section>

      {/* Interactive Card */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Interactive Card
        </h3>
        <div className="qt-card qt-card-interactive" style={{ maxWidth: '24rem', cursor: 'pointer' }}>
          <div className="qt-card-header">
            <h4 className="qt-card-title">Clickable Card</h4>
            <p className="qt-card-description">Hover over me to see the effect.</p>
          </div>
          <div className="qt-card-body">
            <p>This card has hover states and can be clicked.</p>
          </div>
        </div>
      </section>

      {/* Entity Cards */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Entity Cards
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Used for characters, chats, and other list items.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))', gap: '1rem' }}>
          {['Alice', 'Bob', 'Carol'].map((name) => (
            <div key={name} className="qt-entity-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem' }}>
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">{name[0]}</div>
                </div>
                <div>
                  <h4 style={{ fontWeight: 600 }}>{name} Character</h4>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>A friendly character</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Card Grid */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Card Grid
        </h3>
        <div className="qt-card-grid-3">
          <div className="qt-card" style={{ padding: '1rem' }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Card 1</h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>Grid card content</p>
          </div>
          <div className="qt-card" style={{ padding: '1rem' }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Card 2</h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>Grid card content</p>
          </div>
          <div className="qt-card" style={{ padding: '1rem' }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Card 3</h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>Grid card content</p>
          </div>
        </div>
      </section>

      {/* Panels */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Panels
        </h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="qt-panel" style={{ padding: '1.5rem', maxWidth: '20rem' }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Basic Panel</h4>
            <p style={{ color: 'var(--color-muted-foreground)' }}>
              Panels are similar to cards but often used for larger content areas.
            </p>
          </div>
          <div className="qt-panel qt-panel-elevated" style={{ padding: '1.5rem', maxWidth: '20rem' }}>
            <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Elevated Panel</h4>
            <p style={{ color: 'var(--color-muted-foreground)' }}>
              This panel has additional shadow for emphasis.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
