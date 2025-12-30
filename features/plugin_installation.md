# Feature Request: npm-based Plugin Installation

## Overview

Enable users to discover, install, and manage Quilltap plugins from the npm registry. Plugins following the `qtap-plugin-*` naming convention can be searched, installed into the appropriate scope (site-wide or per-user), and loaded alongside bundled plugins.

## Goals

- Allow site admins to install shared plugins from npm
- Allow individual users to install personal plugins
- Maintain the existing bundled plugin system
- Validate plugins against the manifest schema before activation
- Provide a frontend UI for browsing and installing plugins

## Directory Structure

```text
plugins/
├── dist/                              # Bundled plugins (shipped with Quilltap)
│   ├── qtap-plugin-openai/
│   ├── qtap-plugin-anthropic/
│   └── ...
├── site/                              # Site-admin installed plugins (shared across all users)
│   ├── qtap-plugin-some-provider/
│   │   ├── node_modules/
│   │   ├── package.json
│   │   └── ... (installed via npm)
│   └── registry.json                  # Tracks installed site plugins
└── users/                             # Per-user installed plugins
    └── [user-uuid]/
        ├── qtap-plugin-custom/
        │   ├── node_modules/
        │   ├── package.json
        │   └── ...
        └── registry.json              # Tracks this user's installed plugins
```

## Implementation Components

### 1. npm Registry Search API

**File:** `app/api/plugins/search/route.ts`

```typescript
import { getServerSession } from '@/lib/auth/session';

const NPM_REGISTRY = 'https://registry.npmjs.org/-/v1/search';

interface NpmPlugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  keywords?: string[];
  updated: string;
  score: number;
}

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';
  
  // Search npm for packages matching our prefix
  const searchUrl = new URL(NPM_REGISTRY);
  searchUrl.searchParams.set('text', `qtap-plugin-${query}`);
  searchUrl.searchParams.set('size', '50');

  const response = await fetch(searchUrl.toString());
  if (!response.ok) {
    return Response.json({ error: 'npm search failed' }, { status: 502 });
  }

  const data = await response.json();
  
  // Filter to only qtap-plugin-* packages
  const plugins: NpmPlugin[] = data.objects
    .filter((obj: any) => obj.package.name.startsWith('qtap-plugin-'))
    .map((obj: any) => ({
      name: obj.package.name,
      version: obj.package.version,
      description: obj.package.description,
      author: obj.package.author?.name || obj.package.publisher?.username,
      keywords: obj.package.keywords || [],
      updated: obj.package.date,
      score: obj.score?.final || 0,
    }));

  return Response.json({ plugins });
}
```

### 2. Plugin Installation Service

**File:** `lib/plugins/installer.ts`

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import { validatePluginManifest } from './manifest-validator';

const execAsync = promisify(exec);

interface InstallResult {
  success: boolean;
  error?: string;
  manifest?: any;
}

interface PluginRegistryEntry {
  name: string;
  version: string;
  installedAt: string;
  source: 'npm' | 'local';
}

interface PluginRegistry {
  plugins: PluginRegistryEntry[];
}

export async function installPluginFromNpm(
  packageName: string,
  scope: 'site' | 'user',
  userId?: string
): Promise<InstallResult> {
  // Validate naming convention
  if (!packageName.startsWith('qtap-plugin-')) {
    return { success: false, error: 'Package name must start with "qtap-plugin-"' };
  }

  // Sanitize package name to prevent path traversal
  if (!/^qtap-plugin-[a-z0-9-]+$/.test(packageName)) {
    return { success: false, error: 'Invalid package name format' };
  }

  // Determine installation directory
  let pluginBaseDir: string;
  if (scope === 'site') {
    pluginBaseDir = path.join(process.cwd(), 'plugins', 'site');
  } else {
    if (!userId) {
      return { success: false, error: 'User ID required for user-scoped plugins' };
    }
    pluginBaseDir = path.join(process.cwd(), 'plugins', 'users', userId);
  }

  const pluginDir = path.join(pluginBaseDir, packageName);

  logger.info('Installing plugin from npm', {
    context: 'PluginInstaller.installPluginFromNpm',
    packageName,
    scope,
    pluginDir,
  });

  try {
    // Create directory structure
    await fs.mkdir(pluginDir, { recursive: true });

    // Initialize package.json wrapper
    const wrapperPkg = {
      name: `${packageName}-wrapper`,
      private: true,
      dependencies: {},
    };
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify(wrapperPkg, null, 2)
    );

    // Install the plugin from npm
    const { stderr } = await execAsync(
      `npm install ${packageName} --save --legacy-peer-deps`,
      { 
        cwd: pluginDir,
        timeout: 60000, // 60 second timeout
      }
    );

    if (stderr && stderr.includes('ERR!')) {
      logger.error('npm install failed', { context: 'PluginInstaller', stderr });
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { success: false, error: `npm install failed: ${stderr}` };
    }

    // Locate the installed package
    const installedPath = path.join(pluginDir, 'node_modules', packageName);
    
    // Validate manifest exists and is valid
    const manifestPath = path.join(installedPath, 'manifest.json');
    const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
    
    if (!manifestExists) {
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { success: false, error: 'Plugin does not contain a manifest.json' };
    }

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);

    // Validate manifest against schema
    const validation = validatePluginManifest(manifest);
    if (!validation.valid) {
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { 
        success: false, 
        error: `Invalid manifest: ${validation.errors?.join(', ')}` 
      };
    }

    // Check Quilltap version compatibility
    const quilltapPkg = await fs.readFile(
      path.join(process.cwd(), 'package.json'), 
      'utf-8'
    );
    const quilltapVersion = JSON.parse(quilltapPkg).version;
    
    if (!isCompatibleVersion(quilltapVersion, manifest.compatibility?.quilltapVersion)) {
      await fs.rm(pluginDir, { recursive: true, force: true });
      return { 
        success: false, 
        error: `Plugin requires Quilltap ${manifest.compatibility?.quilltapVersion}, but you have ${quilttapVersion}` 
      };
    }

    // Update registry
    await updateRegistry(pluginBaseDir, {
      name: packageName,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      source: 'npm',
    });

    logger.info('Plugin installed successfully', {
      context: 'PluginInstaller',
      packageName,
      version: manifest.version,
    });

    return { success: true, manifest };

  } catch (error) {
    logger.error('Plugin installation failed', {
      context: 'PluginInstaller',
      packageName,
    }, error instanceof Error ? error : undefined);

    // Cleanup on failure
    await fs.rm(pluginDir, { recursive: true, force: true }).catch(() => {});
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function uninstallPlugin(
  packageName: string,
  scope: 'site' | 'user',
  userId?: string
): Promise<{ success: boolean; error?: string }> {
  // Validate naming convention
  if (!packageName.startsWith('qtap-plugin-')) {
    return { success: false, error: 'Invalid package name' };
  }

  // Determine installation directory
  let pluginBaseDir: string;
  if (scope === 'site') {
    pluginBaseDir = path.join(process.cwd(), 'plugins', 'site');
  } else {
    if (!userId) {
      return { success: false, error: 'User ID required for user-scoped plugins' };
    }
    pluginBaseDir = path.join(process.cwd(), 'plugins', 'users', userId);
  }

  const pluginDir = path.join(pluginBaseDir, packageName);

  logger.info('Uninstalling plugin', {
    context: 'PluginInstaller.uninstallPlugin',
    packageName,
    scope,
  });

  try {
    // Remove the plugin directory
    await fs.rm(pluginDir, { recursive: true, force: true });

    // Update registry
    await removeFromRegistry(pluginBaseDir, packageName);

    logger.info('Plugin uninstalled successfully', {
      context: 'PluginInstaller',
      packageName,
    });

    return { success: true };
  } catch (error) {
    logger.error('Plugin uninstall failed', {
      context: 'PluginInstaller',
      packageName,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getInstalledPlugins(
  scope: 'all' | 'bundled' | 'site' | 'user',
  userId?: string
): Promise<Array<{ name: string; version: string; source: string; manifest: any }>> {
  const plugins: Array<{ name: string; version: string; source: string; manifest: any }> = [];

  // Bundled plugins
  if (scope === 'all' || scope === 'bundled') {
    const bundledDir = path.join(process.cwd(), 'plugins', 'dist');
    const bundled = await scanPluginDirectory(bundledDir, 'bundled');
    plugins.push(...bundled);
  }

  // Site plugins
  if (scope === 'all' || scope === 'site') {
    const siteDir = path.join(process.cwd(), 'plugins', 'site');
    const site = await scanPluginDirectory(siteDir, 'site');
    plugins.push(...site);
  }

  // User plugins
  if ((scope === 'all' || scope === 'user') && userId) {
    const userDir = path.join(process.cwd(), 'plugins', 'users', userId);
    const user = await scanPluginDirectory(userDir, 'user');
    plugins.push(...user);
  }

  return plugins;
}

async function scanPluginDirectory(
  baseDir: string,
  source: 'bundled' | 'site' | 'user'
): Promise<Array<{ name: string; version: string; source: string; manifest: any }>> {
  const plugins: Array<{ name: string; version: string; source: string; manifest: any }> = [];

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('qtap-plugin-')) continue;

      let pluginPath = path.join(baseDir, entry.name);

      // For npm-installed plugins, the actual plugin is in node_modules
      if (source !== 'bundled') {
        const npmPath = path.join(pluginPath, 'node_modules', entry.name);
        const npmExists = await fs.access(npmPath).then(() => true).catch(() => false);
        if (npmExists) {
          pluginPath = npmPath;
        }
      }

      const manifestPath = path.join(pluginPath, 'manifest.json');
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        plugins.push({
          name: manifest.name,
          version: manifest.version,
          source,
          manifest,
        });
      } catch {
        logger.warn('Failed to load plugin manifest', {
          context: 'PluginInstaller.scanPluginDirectory',
          plugin: entry.name,
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return plugins;
}

async function updateRegistry(
  baseDir: string,
  plugin: PluginRegistryEntry
): Promise<void> {
  const registryPath = path.join(baseDir, 'registry.json');

  let registry: PluginRegistry = { plugins: [] };
  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    registry = JSON.parse(content);
  } catch {
    // Registry doesn't exist yet
  }

  // Remove existing entry for this plugin if any
  registry.plugins = registry.plugins.filter(p => p.name !== plugin.name);
  registry.plugins.push(plugin);

  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
}

async function removeFromRegistry(
  baseDir: string,
  packageName: string
): Promise<void> {
  const registryPath = path.join(baseDir, 'registry.json');

  let registry: PluginRegistry = { plugins: [] };
  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    registry = JSON.parse(content);
  } catch {
    return; // Registry doesn't exist
  }

  registry.plugins = registry.plugins.filter(p => p.name !== packageName);
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
}

function isCompatibleVersion(current: string, required?: string): boolean {
  if (!required) return true;
  
  // Parse semver requirement like ">=1.7.0"
  const match = required.match(/^>=?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return true;

  const [, reqMajor, reqMinor, reqPatch] = match.map(Number);
  
  // Parse current version
  const currentMatch = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!currentMatch) return true;

  const [, curMajor, curMinor, curPatch] = currentMatch.map(Number);

  // Compare versions
  if (curMajor > reqMajor) return true;
  if (curMajor < reqMajor) return false;
  if (curMinor > reqMinor) return true;
  if (curMinor < reqMinor) return false;
  return curPatch >= reqPatch;
}
```

### 3. Plugin Loader Modifications

**File:** `lib/plugins/loader.ts` (modifications to existing file)

Add support for scanning site and user plugin directories alongside bundled plugins:

```typescript
// Add to existing loader.ts

export async function discoverAllPlugins(userId?: string): Promise<PluginInfo[]> {
  const plugins: PluginInfo[] = [];

  // 1. Load bundled plugins (highest priority, always loaded)
  const bundledDir = path.join(process.cwd(), 'plugins', 'dist');
  plugins.push(...await scanPluginDirectoryForLoader(bundledDir, 'bundled'));

  // 2. Load site-installed plugins
  const siteDir = path.join(process.cwd(), 'plugins', 'site');
  plugins.push(...await scanPluginDirectoryForLoader(siteDir, 'site'));

  // 3. Load user-installed plugins (if userId provided)
  if (userId) {
    const userDir = path.join(process.cwd(), 'plugins', 'users', userId);
    plugins.push(...await scanPluginDirectoryForLoader(userDir, 'user'));
  }

  return plugins;
}

async function scanPluginDirectoryForLoader(
  baseDir: string,
  source: 'bundled' | 'site' | 'user'
): Promise<PluginInfo[]> {
  const plugins: PluginInfo[] = [];

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('qtap-plugin-')) continue;
      if (entry.name === 'registry.json') continue;

      let pluginPath = path.join(baseDir, entry.name);

      // For npm-installed plugins, the actual plugin is in node_modules
      if (source !== 'bundled') {
        const npmPath = path.join(pluginPath, 'node_modules', entry.name);
        const npmExists = await fs.access(npmPath).then(() => true).catch(() => false);
        if (npmExists) {
          pluginPath = npmPath;
        }
      }

      const manifestPath = path.join(pluginPath, 'manifest.json');
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        
        plugins.push({
          name: manifest.name,
          path: pluginPath,
          manifest,
          source,
        });
      } catch (error) {
        logger.warn('Failed to load plugin manifest', {
          context: 'PluginLoader.scanPluginDirectoryForLoader',
          plugin: entry.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch {
    // Directory doesn't exist, that's fine
  }

  return plugins;
}

interface PluginInfo {
  name: string;
  path: string;
  manifest: any;
  source: 'bundled' | 'site' | 'user';
}
```

### 4. API Routes

**File:** `app/api/plugins/install/route.ts`

```typescript
import { getServerSession } from '@/lib/auth/session';
import { installPluginFromNpm } from '@/lib/plugins/installer';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { packageName, scope = 'user' } = await req.json();

  if (!packageName || typeof packageName !== 'string') {
    return Response.json({ error: 'Package name required' }, { status: 400 });
  }

  // Only admins can install site-wide plugins
  // TODO: Add isAdmin check to user model
  if (scope === 'site') {
    // For now, allow any authenticated user; add admin check later
    // if (!session.user.isAdmin) {
    //   return Response.json({ error: 'Admin required for site plugins' }, { status: 403 });
    // }
  }

  const result = await installPluginFromNpm(
    packageName,
    scope,
    scope === 'user' ? session.user.id : undefined
  );

  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({
    success: true,
    plugin: result.manifest,
    message: 'Plugin installed successfully. Restart Quilltap to activate.',
  });
}
```

**File:** `app/api/plugins/uninstall/route.ts`

```typescript
import { getServerSession } from '@/lib/auth/session';
import { uninstallPlugin } from '@/lib/plugins/installer';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { packageName, scope = 'user' } = await req.json();

  if (!packageName || typeof packageName !== 'string') {
    return Response.json({ error: 'Package name required' }, { status: 400 });
  }

  // Only admins can uninstall site-wide plugins
  if (scope === 'site') {
    // TODO: Add admin check
  }

  // Prevent uninstalling bundled plugins
  if (scope === 'bundled') {
    return Response.json({ error: 'Cannot uninstall bundled plugins' }, { status: 400 });
  }

  const result = await uninstallPlugin(
    packageName,
    scope,
    scope === 'user' ? session.user.id : undefined
  );

  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({
    success: true,
    message: 'Plugin uninstalled successfully. Restart Quilltap to complete removal.',
  });
}
```

**File:** `app/api/plugins/installed/route.ts`

```typescript
import { getServerSession } from '@/lib/auth/session';
import { getInstalledPlugins } from '@/lib/plugins/installer';

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const scope = (searchParams.get('scope') || 'all') as 'all' | 'bundled' | 'site' | 'user';

  const plugins = await getInstalledPlugins(scope, session.user.id);

  return Response.json({ plugins });
}
```

### 5. Frontend Components

**File:** `components/settings/PluginManager.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface InstalledPlugin {
  name: string;
  version: string;
  source: 'bundled' | 'site' | 'user';
  manifest: {
    title: string;
    description: string;
    author?: { name: string };
    category?: string;
  };
}

interface NpmPlugin {
  name: string;
  version: string;
  description: string;
  author: string;
  updated: string;
  score: number;
}

export function PluginManager() {
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NpmPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    loadInstalledPlugins();
  }, []);

  const loadInstalledPlugins = async () => {
    try {
      const res = await fetch('/api/plugins/installed');
      const data = await res.json();
      setInstalled(data.plugins || []);
    } catch (error) {
      console.error('Failed to load installed plugins:', error);
    }
  };

  const searchPlugins = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/plugins/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.plugins || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const installPlugin = async (packageName: string) => {
    setActionInProgress(packageName);
    try {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, scope: 'user' }),
      });

      const data = await res.json();
      if (data.success) {
        alert(`${packageName} installed successfully!\n\nRestart Quilltap to activate the plugin.`);
        await loadInstalledPlugins();
      } else {
        alert(`Installation failed: ${data.error}`);
      }
    } catch (error) {
      alert('Installation failed. Check console for details.');
      console.error('Install error:', error);
    } finally {
      setActionInProgress(null);
    }
  };

  const uninstallPlugin = async (packageName: string, source: string) => {
    if (source === 'bundled') {
      alert('Cannot uninstall bundled plugins.');
      return;
    }

    if (!confirm(`Uninstall ${packageName}? You will need to restart Quilttap after uninstalling.`)) {
      return;
    }

    setActionInProgress(packageName);
    try {
      const res = await fetch('/api/plugins/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, scope: source }),
      });

      const data = await res.json();
      if (data.success) {
        alert(`${packageName} uninstalled.\n\nRestart Quilltap to complete removal.`);
        await loadInstalledPlugins();
      } else {
        alert(`Uninstall failed: ${data.error}`);
      }
    } catch (error) {
      alert('Uninstall failed. Check console for details.');
      console.error('Uninstall error:', error);
    } finally {
      setActionInProgress(null);
    }
  };

  const isInstalled = (packageName: string) => {
    return installed.some(p => p.name === packageName);
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b qt-border">
        <button
          onClick={() => setActiveTab('installed')}
          className={`px-4 py-2 -mb-px ${
            activeTab === 'installed'
              ? 'border-b-2 border-blue-500 qt-text-primary font-medium'
              : 'qt-text-secondary hover:qt-text-primary'
          }`}
        >
          Installed ({installed.length})
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`px-4 py-2 -mb-px ${
            activeTab === 'browse'
              ? 'border-b-2 border-blue-500 qt-text-primary font-medium'
              : 'qt-text-secondary hover:qt-text-primary'
          }`}
        >
          Browse npm
        </button>
      </div>

      {/* Installed Plugins Tab */}
      {activeTab === 'installed' && (
        <div className="space-y-3">
          {installed.length === 0 ? (
            <p className="qt-text-secondary text-center py-8">
              No plugins installed. Browse npm to find plugins.
            </p>
          ) : (
            installed.map((plugin) => (
              <div
                key={plugin.name}
                className="p-4 border rounded-lg qt-bg-secondary qt-border"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium qt-text-primary">
                        {plugin.manifest.title || plugin.name}
                      </h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        plugin.source === 'bundled' 
                          ? 'bg-green-100 text-green-800' 
                          : plugin.source === 'site'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {plugin.source}
                      </span>
                    </div>
                    <p className="text-sm qt-text-secondary mt-1">
                      {plugin.manifest.description}
                    </p>
                    <p className="text-xs qt-text-muted mt-2">
                      v{plugin.version}
                      {plugin.manifest.author?.name && ` • by ${plugin.manifest.author.name}`}
                    </p>
                  </div>
                  {plugin.source !== 'bundled' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => uninstallPlugin(plugin.name, plugin.source)}
                      disabled={actionInProgress === plugin.name}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      {actionInProgress === plugin.name ? 'Removing...' : 'Uninstall'}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Browse npm Tab */}
      {activeTab === 'browse' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPlugins()}
              placeholder="Search for plugins (e.g., 'llm', 'theme')..."
              className="flex-1 px-3 py-2 border rounded-md qt-bg-primary qt-text-primary qt-border"
            />
            <Button onClick={searchPlugins} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </Button>
          </div>

          <p className="text-sm qt-text-muted">
            Searches npm registry for packages starting with "qtap-plugin-"
          </p>

          <div className="space-y-3">
            {searchResults.length === 0 && !loading && searchQuery && (
              <p className="qt-text-secondary text-center py-8">
                No plugins found. Try a different search term.
              </p>
            )}

            {searchResults.map((plugin) => (
              <div
                key={plugin.name}
                className="p-4 border rounded-lg qt-bg-secondary qt-border"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-medium qt-text-primary">{plugin.name}</h3>
                    <p className="text-sm qt-text-secondary mt-1">
                      {plugin.description || 'No description available'}
                    </p>
                    <p className="text-xs qt-text-muted mt-2">
                      v{plugin.version}
                      {plugin.author && ` • by ${plugin.author}`}
                      {plugin.updated && ` • updated ${new Date(plugin.updated).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => installPlugin(plugin.name)}
                    disabled={actionInProgress === plugin.name || isInstalled(plugin.name)}
                  >
                    {isInstalled(plugin.name)
                      ? 'Installed'
                      : actionInProgress === plugin.name
                      ? 'Installing...'
                      : 'Install'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 6. Settings Page Integration

Add to the Settings page (wherever plugins settings should appear):

```tsx
// In app/(authenticated)/settings/page.tsx or appropriate settings component

import { PluginManager } from '@/components/settings/PluginManager';

// Add a new tab or section for plugins:
<TabsContent value="plugins">
  <div className="space-y-4">
    <div>
      <h2 className="text-xl font-semibold qt-text-primary">Plugins</h2>
      <p className="text-sm qt-text-secondary">
        Manage installed plugins and browse for new ones from npm.
      </p>
    </div>
    <PluginManager />
  </div>
</TabsContent>
```

## Docker Configuration

Add volume mounts for plugin persistence in docker-compose files:

**docker-compose.dev-mongo.yml:**

```yaml
services:
  app:
    volumes:
      # ... existing volumes ...
      - ./plugins/site:/app/plugins/site
      - plugin-user-data:/app/plugins/users

volumes:
  plugin-user-data:
```

**docker-compose.prod.yml:**

```yaml
services:
  app:
    volumes:
      # ... existing volumes ...
      - ./data/plugins/site:/app/plugins/site
      - ./data/plugins/users:/app/plugins/users
```

## Security Considerations

1. **Package name validation**: Only allow `qtap-plugin-[a-z0-9-]+` pattern
2. **Manifest validation**: Validate against existing JSON schema before loading
3. **Version compatibility**: Check `quilttapVersion` in manifest.compatibility
4. **Scope separation**: User plugins cannot affect other users
5. **Admin controls**: Only admins should install site-wide plugins (TODO: implement isAdmin)
6. **Network permissions**: Consider validating manifest.permissions.network domains

## Future Enhancements

1. **Hot reload**: Add `/api/plugins/reload` to reload plugins without full restart
2. **Plugin updates**: Check npm for newer versions and allow in-place updates
3. **Plugin ratings**: Cache npm download stats / quality scores
4. **Verified plugins**: Maintain a list of "verified" plugins that have been reviewed
5. **Dependency resolution**: Handle plugins that depend on other plugins
6. **Rollback**: Keep previous version when updating, allow rollback on failure

## Testing Checklist

- [ ] Search returns only `qtap-plugin-*` packages from npm
- [ ] Install creates correct directory structure
- [ ] Install validates manifest against schema
- [ ] Install checks version compatibility
- [ ] Install updates registry.json
- [ ] Uninstall removes directory and registry entry
- [ ] Cannot uninstall bundled plugins
- [ ] Plugin loader discovers plugins in all three locations
- [ ] User plugins are isolated per user
- [ ] UI shows installed plugins with correct source badges
- [ ] UI allows searching and installing from npm
- [ ] Restart activates newly installed plugins
