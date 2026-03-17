/**
 * Loading Story Component
 *
 * Displays loading state variants including spinners, skeletons, and progress indicators.
 */

import React from 'react';

export const Loading: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Loading States</h2>

      {/* Spinners */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Spinners
        </h3>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="qt-spinner qt-spinner-sm" style={{ margin: '0 auto' }} />
            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Small</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="qt-spinner" style={{ margin: '0 auto' }} />
            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Default</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="qt-spinner qt-spinner-lg" style={{ margin: '0 auto' }} />
            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Large</p>
          </div>
        </div>
      </section>

      {/* Skeleton Text */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Skeleton Text
        </h3>
        <div style={{ maxWidth: '28rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '100%' }} />
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '80%' }} />
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
        </div>
      </section>

      {/* Skeleton Card */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Skeleton Card
        </h3>
        <div className="qt-card" style={{ maxWidth: '24rem', padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-start' }}>
            <div className="qt-skeleton qt-skeleton-circle" style={{ width: '40px', height: '40px', flexShrink: 0 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
              <div className="qt-skeleton qt-skeleton-text" style={{ width: '40%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="qt-skeleton qt-skeleton-text" />
            <div className="qt-skeleton qt-skeleton-text" />
            <div className="qt-skeleton qt-skeleton-text" style={{ width: '75%' }} />
          </div>
        </div>
      </section>

      {/* Skeleton Message */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Skeleton Message
        </h3>
        <div style={{ maxWidth: '42rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="qt-skeleton qt-skeleton-circle" style={{ width: '32px', height: '32px', flexShrink: 0 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div className="qt-skeleton qt-skeleton-text" style={{ width: '120px' }} />
              <div className="qt-card" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div className="qt-skeleton qt-skeleton-text" />
                  <div className="qt-skeleton qt-skeleton-text" />
                  <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Skeleton List */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Skeleton List
        </h3>
        <div style={{ maxWidth: '24rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="qt-card" style={{ padding: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div className="qt-skeleton qt-skeleton-circle" style={{ width: '32px', height: '32px', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="qt-skeleton qt-skeleton-text" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Loading Button */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Loading Button
        </h3>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="qt-button qt-button-primary" disabled style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="qt-spinner qt-spinner-sm" />
            Loading...
          </button>
          <button className="qt-button qt-button-secondary" disabled style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="qt-spinner qt-spinner-sm" />
            Saving...
          </button>
        </div>
      </section>
    </div>
  );
};
