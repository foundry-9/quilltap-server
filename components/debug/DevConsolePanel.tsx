"use client";

import { useDevConsoleOptional, DevConsoleTab } from '@/components/providers/dev-console-provider';
import ServerLogsTab from './ServerLogsTab';
import BrowserConsoleTab from './BrowserConsoleTab';
import ChatDebugTab from './ChatDebugTab';

interface TabConfig {
  id: DevConsoleTab;
  label: string;
  icon: React.ReactNode;
  available: boolean;
}

interface DevConsolePanelProps {
  layout: 'side' | 'bottom';
}

/**
 * DevConsolePanel - The actual panel content for DevConsole
 * Used by DevConsoleLayout to render the panel in different positions
 */
export default function DevConsolePanel({ layout }: DevConsolePanelProps) {
  const devConsole = useDevConsoleOptional();

  if (!devConsole) {
    return null;
  }

  const { activeTab, setActiveTab, closePanel, chatDebugAvailable, serverLogs, consoleLogs } = devConsole;

  const tabs: TabConfig[] = [
    {
      id: 'server',
      label: 'Server Logs',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
      ),
      available: true,
    },
    {
      id: 'console',
      label: 'Console',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      available: true,
    },
    {
      id: 'chat-debug',
      label: 'Chat Debug',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      available: chatDebugAvailable,
    },
  ];

  // If current tab is unavailable, switch to a valid one
  if (activeTab === 'chat-debug' && !chatDebugAvailable) {
    setActiveTab('server');
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'server':
        return <ServerLogsTab />;
      case 'console':
        return <BrowserConsoleTab />;
      case 'chat-debug':
        return chatDebugAvailable ? <ChatDebugTab /> : null;
      default:
        return <ServerLogsTab />;
    }
  };

  // Count badges for tabs
  const serverErrorCount = serverLogs.filter(l => l.level === 'error').length;
  const consoleErrorCount = consoleLogs.filter(l => l.level === 'error').length;

  const isSideLayout = layout === 'side';

  // Render tabs - horizontal for both layouts now (side layout has more space)
  const renderTabs = () => (
    <div className="flex flex-row items-stretch gap-1">
      {tabs.filter(t => t.available).map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === tab.id
              ? 'bg-background text-foreground border-t border-l border-r border-border -mb-px rounded-t'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent rounded-t'
          }`}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {/* Error count badges */}
          {tab.id === 'server' && serverErrorCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
              {serverErrorCount}
            </span>
          )}
          {tab.id === 'console' && consoleErrorCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
              {consoleErrorCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  // Side panel layout (integrated into page layout)
  if (isSideLayout) {
    return (
      <div className="h-full flex flex-col bg-background">
        {/* Tab bar - horizontal at top */}
        <div className="flex items-center border-b border-border bg-muted px-2">
          {renderTabs()}

          {/* Controls */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">
              Ctrl+Shift+D
            </span>
            <button
              onClick={closePanel}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              title="Close DevConsole"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {renderTabContent()}
        </div>
      </div>
    );
  }

  // Bottom panel layout (fixed overlay)
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border shadow-lg flex flex-col"
      style={{ height: '40vh', minHeight: '200px', maxHeight: '60vh' }}
    >
      {/* Tab bar - horizontal at top */}
      <div className="flex items-center border-b border-border bg-muted px-2">
        {renderTabs()}

        {/* Controls */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">
            Ctrl+Shift+D
          </span>
          <button
            onClick={closePanel}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="Close DevConsole"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {renderTabContent()}
      </div>
    </div>
  );
}
