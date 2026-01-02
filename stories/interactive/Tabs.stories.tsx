import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';

/**
 * Tab component stories showing the qt-tab-* classes.
 */

const TabsShowcase: React.FC = () => {
  const [activeTab, setActiveTab] = useState('tab1');

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Basic Tabs</h3>
        <div className="qt-tab-group">
          <button
            className={`qt-tab ${activeTab === 'tab1' ? 'qt-tab-active' : ''}`}
            onClick={() => setActiveTab('tab1')}
          >
            General
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
            Advanced
          </button>
        </div>
        <div className="qt-card mt-0 rounded-t-none border-t-0 p-4">
          {activeTab === 'tab1' && <p>General settings content goes here.</p>}
          {activeTab === 'tab2' && <p>Settings content goes here.</p>}
          {activeTab === 'tab3' && <p>Advanced options content goes here.</p>}
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Tab States</h3>
        <div className="flex gap-4">
          <button className="qt-tab">Inactive Tab</button>
          <button className="qt-tab qt-tab-active">Active Tab</button>
          <button className="qt-tab" disabled>Disabled Tab</button>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Tabs with Icons</h3>
        <div className="qt-tab-group">
          <button className="qt-tab qt-tab-active flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Home
          </button>
          <button className="qt-tab flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Users
          </button>
          <button className="qt-tab flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Vertical Tabs (Custom Layout)</h3>
        <div className="flex gap-4">
          <div className="flex flex-col gap-1">
            <button className="qt-tab qt-tab-active text-left">Profile</button>
            <button className="qt-tab text-left">Security</button>
            <button className="qt-tab text-left">Notifications</button>
            <button className="qt-tab text-left">Integrations</button>
          </div>
          <div className="qt-card flex-1 p-4">
            <p>Profile settings would appear here.</p>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof TabsShowcase> = {
  title: 'Interactive/Tabs',
  component: TabsShowcase,
};

export default meta;
type Story = StoryObj<typeof TabsShowcase>;

export const AllTabs: Story = {};
