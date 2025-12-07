"use client";

export { default as DevConsoleLayout } from './DevConsoleLayout';
export { default as DevConsolePanel } from './DevConsolePanel';

/**
 * DevConsole - Re-exports for backward compatibility
 *
 * The DevConsole functionality is now split into:
 * - DevConsoleLayout: Wraps main content for two-column layout on wide screens
 * - DevConsolePanel: The actual panel content (tabs, logs, etc.)
 *
 * Use DevConsoleLayout in your root layout to wrap the main content area.
 */
import DevConsoleLayout from './DevConsoleLayout';
export default DevConsoleLayout;
