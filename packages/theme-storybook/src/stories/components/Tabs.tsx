/**
 * Tabs Story Component
 *
 * Displays tab variants and navigation patterns for theme development.
 */

import React, { useState } from 'react';

export const Tabs: React.FC = () => {
  const [activeTab, setActiveTab] = useState('tab1');

  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Tabs & Navigation</h2>

      {/* Basic Tabs */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Basic Tabs
        </h3>
        <div className="qt-tab-group">
          <button
            className={`qt-tab ${activeTab === 'tab1' ? 'qt-tab-active' : ''}`}
            onClick={() => setActiveTab('tab1')}
          >
            Account
          </button>
          <button
            className={`qt-tab ${activeTab === 'tab2' ? 'qt-tab-active' : ''}`}
            onClick={() => setActiveTab('tab2')}
          >
            Settings
          </button>
          <button
            className={`qt-tab ${activeTab === 'tab3' ? 'qt-tab-active' : ''}`}
            onClick={() => setActiveTab('tab3')}
          >
            Notifications
          </button>
        </div>
        <div>
          {activeTab === 'tab1' && (
            <div className="qt-tab-content">
              <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Account Settings</h4>
              <p style={{ color: 'var(--color-muted-foreground)' }}>
                Manage your account settings and preferences.
              </p>
            </div>
          )}
          {activeTab === 'tab2' && (
            <div className="qt-tab-content">
              <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>General Settings</h4>
              <p style={{ color: 'var(--color-muted-foreground)' }}>
                Configure general application settings.
              </p>
            </div>
          )}
          {activeTab === 'tab3' && (
            <div className="qt-tab-content">
              <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Notification Preferences</h4>
              <p style={{ color: 'var(--color-muted-foreground)' }}>
                Choose how you want to receive notifications.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Tabs with Icons */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Tabs with Icons
        </h3>
        <div className="qt-tab-group">
          <button className="qt-tab qt-tab-active" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Home
          </button>
          <button className="qt-tab" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Profile
          </button>
          <button className="qt-tab" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </section>

      {/* Navigation Bar */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Navigation Bar
        </h3>
        <div className="qt-navbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>Quilltap</div>
            <nav style={{ display: 'flex', gap: '0.25rem' }}>
              <a href="#" className="qt-navbar-link qt-navbar-link-active">Dashboard</a>
              <a href="#" className="qt-navbar-link">Characters</a>
              <a href="#" className="qt-navbar-link">Chats</a>
              <a href="#" className="qt-navbar-link">Settings</a>
            </nav>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="qt-button-icon" aria-label="Notifications">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">U</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
