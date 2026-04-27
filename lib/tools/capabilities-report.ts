/**
 * Capabilities Report Service
 *
 * Generates comprehensive system reports about Quilltap's configuration,
 * capabilities, and statistics.
 */

import crypto from 'crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { getAllPlugins } from '@/lib/plugins/registry';
import {
  providerRegistry,
  getAllProviders,
  getProvidersByCapability,
  getConfigRequirements,
} from '@/lib/plugins/provider-registry';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { isDockerEnvironment, isElectronShell, isLimaEnvironment, getDataDir, getElectronShellVersion, getShellCapabilities, getSQLiteDatabasePath, getLLMLogsDatabasePath, getBackupsDir } from '@/lib/paths';
import { getHasUserPassphrase } from '@/lib/startup/dbkey';
import { getAllThemes, getThemeStats } from '@/lib/themes/theme-registry';
import { parseBackupFilename, parseLLMLogsBackupFilename } from '@/lib/database/backends/sqlite/physical-backup';

import type { LLMProviderPlugin } from '@/lib/plugins/interfaces/provider-plugin';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';
import type { ChatMetadata } from '@/lib/schemas/chat.types';
import { getErrorMessage } from '@/lib/errors';

// Read version from package.json
import packageJson from '@/package.json';

const moduleLogger = logger.child({ module: 'capabilities-report' });

// ============================================================================
// TYPES
// ============================================================================

export interface PluginInfo {
  name: string;
  title: string;
  version: string;
  capabilities: string[];
  enabled: boolean;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  configured: boolean;
  capabilities: {
    chat: boolean;
    imageGeneration: boolean;
    embeddings: boolean;
    webSearch: boolean;
  };
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
}

export interface ModelInfo {
  provider: string;
  models: string[];
  error?: string;
}

export interface DatabaseStats {
  characters: number;
  chats: number;
  memories: number;
  tags: number;
}

export interface EnhancedDatabaseStats {
  characters: number;
  favoriteCharacters: number;
  chats: number;
  memories: number;
  tags: number;
  projects: number;
  connectionProfiles: { total: number; webSearchEnabled: number; toolUseEnabled: number; dangerousCompatible: number };
  imageProfiles: number;
  embeddingProfiles: number;
  promptTemplates: { total: number; builtIn: number; custom: number };
  roleplayTemplates: { total: number; builtIn: number; custom: number };
}

export interface FolderStats {
  path: string;
  fileCount: number;
  totalSize: number;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  folders: FolderStats[];
}

export interface CheapLLMInfo {
  provider?: string;
  model?: string;
  profileName?: string;
}

export interface EmbeddingInfo {
  provider?: string;
  model?: string;
  profileName?: string;
}

export interface ImagePromptLLMInfo {
  provider?: string;
  model?: string;
  profileName?: string;
}

export interface ImageProviderInfo {
  provider: string;
  displayName: string;
  models: string[];
}

export interface EmbeddingProviderInfo {
  provider: string;
  displayName: string;
  models: string[];
}

export interface RuntimeEnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  osType: string;
  osRelease: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  runtimeType: 'docker' | 'lima' | 'electron' | 'node';
  electronShellVersion: string | null;
  shellCapabilities: string[];
  uptimeSeconds: number;
  dataDirectory: string;
  timezone: string;
}

export interface DatabaseSecurityInfo {
  passphraseProtected: boolean;
  mainDbSizeBytes: number;
  llmLogsDbSizeBytes: number;
  highestAppVersion: string | null;
}

export interface BackupInfo {
  count: number;
  newestDate: string | null;
  oldestDate: string | null;
  totalSizeBytes: number;
}

export interface BackupStatusInfo {
  mainDb: BackupInfo;
  llmLogs: BackupInfo;
}

export interface MCPServersInfo {
  configured: number;
  enabled: number;
  serverNames: string[];
  autoReconnect: boolean;
  maxReconnectAttempts: number;
}

export interface ThemeListItem {
  name: string;
  version: string;
  source: string;
}

export interface ThemeReportInfo {
  activeThemeId: string | null;
  colorMode: string;
  stats: { total: number; withDarkMode: number; withCssOverrides: number; errors: number };
  themes: ThemeListItem[];
}

export interface FeatureConfigInfo {
  dangerousContent: { mode: string; threshold: number; scanTextChat: boolean; scanImagePrompts: boolean; scanImageGeneration: boolean };
  contextCompression: { enabled: boolean; windowSize: number; compressionTargetTokens: number };
  agentMode: { maxTurns: number; defaultEnabled: boolean };
  storyBackgrounds: { enabled: boolean; hasDefaultImageProfile: boolean };
  timestamps: { mode: string; format: string };
  autoLock: { enabled: boolean; idleMinutes: number };
  memoryCascade: { onMessageDelete: string; onSwipeRegenerate: string };
  autoDetectRng: boolean;
  avatarDisplay: { mode: string; style: string };
}

export interface ChatStatsInfo {
  totalEstimatedCostUSD: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalMessages: number;
  agentModeChats: number;
  dangerousChats: number;
}

export interface LLMLogStatsInfo {
  totalEntries: number;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  loggingEnabled: boolean;
  verboseMode: boolean;
  retentionDays: number;
}

export interface CapabilitiesReportData {
  version: string;
  nodeEnv: string;
  generatedAt: string;
  runtimeEnvironment: RuntimeEnvironmentInfo;
  databaseSecurity: DatabaseSecurityInfo;
  backupStatus: BackupStatusInfo;
  plugins: {
    enabled: PluginInfo[];
    disabled: PluginInfo[];
  };
  apiKeyTypes: string[];
  providers: ProviderInfo[];
  modelsByProvider: ModelInfo[];
  cheapLLM: CheapLLMInfo;
  imagePromptLLM: ImagePromptLLMInfo;
  embeddingProvider: EmbeddingInfo;
  imageProviders: ImageProviderInfo[];
  embeddingProviders: EmbeddingProviderInfo[];
  mcpServers: MCPServersInfo;
  themeInfo: ThemeReportInfo;
  featureConfig: FeatureConfigInfo;
  databaseStats: EnhancedDatabaseStats;
  chatStats: ChatStatsInfo;
  llmLogStats: LLMLogStatsInfo;
  storageStats: StorageStats;
}

// ============================================================================
// DATA COLLECTION FUNCTIONS
// ============================================================================

/**
 * Get Quilltap version from package.json
 */
function getVersion(): string {
  moduleLogger.info('Collecting Quilltap version');
  const version = packageJson.version;
  moduleLogger.info('Collected Quilltap version', { version });
  return version;
}

/**
 * Read the version from a plugin's package.json file
 * Falls back to manifest version if package.json is not available
 */
async function getPluginVersion(plugin: LoadedPlugin): Promise<string> {
  try {
    const packageJsonPath = path.join(plugin.pluginPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkgJson = JSON.parse(content);
    return pkgJson.version || plugin.manifest.version;
  } catch {
    // Fall back to manifest version if package.json can't be read
    return plugin.manifest.version;
  }
}

/**
 * Collect plugin information
 */
async function collectPluginInfo(): Promise<{ enabled: PluginInfo[]; disabled: PluginInfo[] }> {
  moduleLogger.info('Collecting plugin information');

  const allPlugins = getAllPlugins();
  const enabled: PluginInfo[] = [];
  const disabled: PluginInfo[] = [];

  for (const plugin of allPlugins) {
    // Read version from package.json (more up-to-date than manifest)
    const version = await getPluginVersion(plugin);

    const info: PluginInfo = {
      name: plugin.manifest.name,
      title: plugin.manifest.title,
      version,
      capabilities: plugin.capabilities,
      enabled: plugin.enabled,
    };

    if (plugin.enabled) {
      enabled.push(info);
    } else {
      disabled.push(info);
    }
  }

  // Sort plugins alphabetically by title
  enabled.sort((a, b) => a.title.localeCompare(b.title));
  disabled.sort((a, b) => a.title.localeCompare(b.title));

  moduleLogger.info('Collected plugin information', {
    enabledCount: enabled.length,
    disabledCount: disabled.length,
    rawResult: { enabled, disabled },
  });

  return { enabled, disabled };
}

/**
 * Get all possible API key types from providers
 */
function collectApiKeyTypes(): string[] {
  moduleLogger.info('Collecting API key types');

  const providers = getAllProviders();
  const apiKeyTypes: string[] = [];

  for (const provider of providers) {
    const config = getConfigRequirements(provider.metadata.providerName);
    if (config?.requiresApiKey) {
      const label = config.apiKeyLabel || `${provider.metadata.displayName} API Key`;
      apiKeyTypes.push(label);
    }
  }

  // Sort API key types alphabetically
  apiKeyTypes.sort((a, b) => a.localeCompare(b));

  moduleLogger.info('Collected API key types', {
    count: apiKeyTypes.length,
    rawResult: apiKeyTypes,
  });

  return apiKeyTypes;
}

/**
 * Collect provider information with configuration status
 */
async function collectProviderInfo(userId: string): Promise<ProviderInfo[]> {
  moduleLogger.info('Collecting provider information', { userId });

  const providers = getAllProviders();
  const repos = getUserRepositories(userId);

  // Get all API keys for the user
  const apiKeys = await repos.connections.getAllApiKeys();
  const configuredProviders = new Set(apiKeys.map(k => k.provider));

  // Also check connection profiles for configured providers
  const connectionProfiles = await repos.connections.findAll();
  for (const profile of connectionProfiles) {
    configuredProviders.add(profile.provider);
  }

  const providerInfos: ProviderInfo[] = [];

  for (const provider of providers) {
    const config = getConfigRequirements(provider.metadata.providerName);
    const info: ProviderInfo = {
      name: provider.metadata.providerName,
      displayName: provider.metadata.displayName,
      configured: configuredProviders.has(provider.metadata.providerName),
      capabilities: {
        chat: provider.capabilities.chat,
        imageGeneration: provider.capabilities.imageGeneration,
        embeddings: provider.capabilities.embeddings,
        webSearch: provider.capabilities.webSearch,
      },
      requiresApiKey: config?.requiresApiKey ?? true,
      requiresBaseUrl: config?.requiresBaseUrl ?? false,
    };
    providerInfos.push(info);
  }

  // Sort providers alphabetically by displayName
  providerInfos.sort((a, b) => a.displayName.localeCompare(b.displayName));

  moduleLogger.info('Collected provider information', {
    count: providerInfos.length,
    configuredCount: providerInfos.filter(p => p.configured).length,
    rawResult: providerInfos,
  });

  return providerInfos;
}

/**
 * Fetch available models from each configured provider
 * Uses cached models from the database when available, falls back to API calls
 */
async function collectModels(userId: string): Promise<ModelInfo[]> {
  moduleLogger.info('Collecting models from providers', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();
  const apiKeys = await repos.connections.getAllApiKeys();
  const connectionProfiles = await repos.connections.findAll();
  const modelsByProvider: ModelInfo[] = [];

  // Group API keys by provider
  const keysByProvider = new Map<string, typeof apiKeys[0]>();
  for (const key of apiKeys) {
    if (key.isActive && !keysByProvider.has(key.provider)) {
      keysByProvider.set(key.provider, key);
    }
  }

  // Get base URLs from connection profiles
  const baseUrlByProvider = new Map<string, string>();
  for (const profile of connectionProfiles) {
    if (profile.baseUrl && !baseUrlByProvider.has(profile.provider)) {
      baseUrlByProvider.set(profile.provider, profile.baseUrl);
    }
  }

  for (const [providerName, apiKeyRecord] of keysByProvider) {
    try {
      const provider = providerRegistry.getProvider(providerName);
      if (!provider) {
        moduleLogger.warn('Provider not found in registry', { providerName });
        continue;
      }

      // First try to get cached models from the database
      const cachedModels = await globalRepos.providerModels.findByProvider(providerName, 'chat');

      if (cachedModels.length > 0) {
        moduleLogger.info('Using cached models from database', {
          providerName,
          modelCount: cachedModels.length,
        });
        const models = cachedModels.map(m => m.modelId).sort((a, b) => a.localeCompare(b)).slice(0, 50);
        modelsByProvider.push({
          provider: providerName,
          models,
        });
        continue;
      }

      // No cached models - fetch from provider via registry wrapper (applies URL rewriting)
      const decryptedKey = apiKeyRecord.key_value;

      const baseUrl = baseUrlByProvider.get(providerName);

      // Fetch models using registry wrapper which applies localhost URL rewriting
      // The wrapper returns [] if the provider doesn't implement getAvailableModels
      moduleLogger.info('Fetching models from provider (no cache available)', { providerName });
      const models = await providerRegistry.getAvailableModels(providerName, decryptedKey, baseUrl);

      if (models.length > 0) {
        // Sort models alphabetically and limit to 50
        const sortedModels = [...models].sort((a, b) => a.localeCompare(b)).slice(0, 50);
        modelsByProvider.push({
          provider: providerName,
          models: sortedModels,
        });
        moduleLogger.info('Fetched models from provider', {
          providerName,
          modelCount: models.length,
        });
      } else if (provider.getModelInfo) {
        // Fall back to static model info if getAvailableModels not supported or returned empty
        const modelInfo = provider.getModelInfo();
        const staticModels = modelInfo.map(m => m.id || m.name).sort((a, b) => a.localeCompare(b));
        modelsByProvider.push({
          provider: providerName,
          models: staticModels,
        });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      moduleLogger.warn('Failed to fetch models from provider', {
        providerName,
        error: errorMessage,
      });
      modelsByProvider.push({
        provider: providerName,
        models: [],
        error: errorMessage,
      });
    }
  }

  // Sort providers alphabetically by provider name
  modelsByProvider.sort((a, b) => a.provider.localeCompare(b.provider));

  moduleLogger.info('Collected models from providers', {
    providerCount: modelsByProvider.length,
    rawResult: modelsByProvider,
  });

  return modelsByProvider;
}

/**
 * Get cheap LLM configuration
 */
async function collectCheapLLMInfo(userId: string): Promise<CheapLLMInfo> {
  moduleLogger.info('Collecting cheap LLM configuration', { userId });

  const repos = getUserRepositories(userId);
  const profiles = await repos.connections.findAll();

  // Find profile marked as cheap
  const cheapProfile = profiles.find(p => p.isCheap);

  const info: CheapLLMInfo = {};
  if (cheapProfile) {
    info.provider = cheapProfile.provider;
    info.model = cheapProfile.modelName;
    info.profileName = cheapProfile.name;
  }

  moduleLogger.info('Collected cheap LLM configuration', { rawResult: info });
  return info;
}

/**
 * Get image prompt LLM configuration (separate override for image prompt expansion)
 */
async function collectImagePromptLLMInfo(userId: string): Promise<ImagePromptLLMInfo> {
  moduleLogger.info('Collecting image prompt LLM configuration', { userId });

  const globalRepos = getRepositories();
  const repos = getUserRepositories(userId);

  // Get the chat settings to check for imagePromptProfileId
  const chatSettings = await globalRepos.chatSettings.findByUserId(userId);

  const info: ImagePromptLLMInfo = {};

  if (chatSettings?.cheapLLMSettings?.imagePromptProfileId) {
    // Look up the connection profile for this ID
    const profile = await repos.connections.findById(chatSettings.cheapLLMSettings.imagePromptProfileId);
    if (profile) {
      info.provider = profile.provider;
      info.model = profile.modelName;
      info.profileName = profile.name;
    }
  }

  moduleLogger.info('Collected image prompt LLM configuration', { rawResult: info });
  return info;
}

/**
 * Get embedding provider configuration
 */
async function collectEmbeddingInfo(userId: string): Promise<EmbeddingInfo> {
  moduleLogger.info('Collecting embedding provider configuration', { userId });

  const repos = getUserRepositories(userId);
  const defaultProfile = await repos.embeddingProfiles.findDefault();

  const info: EmbeddingInfo = {};
  if (defaultProfile) {
    info.provider = defaultProfile.provider;
    info.model = defaultProfile.modelName;
    info.profileName = defaultProfile.name;
  }

  moduleLogger.info('Collected embedding provider configuration', { rawResult: info });
  return info;
}

/**
 * Get image providers and their models
 * Uses cached models from the database when available
 */
async function collectImageProviders(): Promise<ImageProviderInfo[]> {
  moduleLogger.info('Collecting image providers');

  const globalRepos = getRepositories();
  const imageProviders = getProvidersByCapability('imageGeneration');
  const result: ImageProviderInfo[] = [];

  for (const provider of imageProviders) {
    let models: string[] = [];

    // First try to get cached image models from the database
    const cachedModels = await globalRepos.providerModels.findByProvider(
      provider.metadata.providerName,
      'image'
    );

    if (cachedModels.length > 0) {
      models = cachedModels.map(m => m.modelId);
    } else {
      // Fall back to static image generation models
      if (provider.getImageGenerationModels) {
        const imageModels = provider.getImageGenerationModels();
        models = imageModels.map(m => m.id || m.name);
      }
    }

    // Sort models alphabetically
    models.sort((a, b) => a.localeCompare(b));

    result.push({
      provider: provider.metadata.providerName,
      displayName: provider.metadata.displayName,
      models,
    });
  }

  // Sort providers alphabetically by displayName
  result.sort((a, b) => a.displayName.localeCompare(b.displayName));

  moduleLogger.info('Collected image providers', {
    count: result.length,
    rawResult: result,
  });

  return result;
}

/**
 * Get embedding providers and their models
 * Uses cached models from the database when available
 */
async function collectEmbeddingProviders(): Promise<EmbeddingProviderInfo[]> {
  moduleLogger.info('Collecting embedding providers');

  const globalRepos = getRepositories();
  const embeddingProviders = getProvidersByCapability('embeddings');
  const result: EmbeddingProviderInfo[] = [];

  for (const provider of embeddingProviders) {
    let models: string[] = [];

    // First try to get cached embedding models from the database
    const cachedModels = await globalRepos.providerModels.findByProvider(
      provider.metadata.providerName,
      'embedding'
    );

    if (cachedModels.length > 0) {
      models = cachedModels.map(m => m.modelId);
    } else {
      // Fall back to static embedding models
      if (provider.getEmbeddingModels) {
        const embeddingModels = provider.getEmbeddingModels();
        models = embeddingModels.map(m => m.id || m.name);
      }
    }

    // Sort models alphabetically
    models.sort((a, b) => a.localeCompare(b));

    result.push({
      provider: provider.metadata.providerName,
      displayName: provider.metadata.displayName,
      models,
    });
  }

  // Sort providers alphabetically by displayName
  result.sort((a, b) => a.displayName.localeCompare(b.displayName));

  moduleLogger.info('Collected embedding providers', {
    count: result.length,
    rawResult: result,
  });

  return result;
}

/**
 * Collect runtime environment information
 */
function collectRuntimeEnvironment(): RuntimeEnvironmentInfo {
  moduleLogger.info('Collecting runtime environment information');

  let runtimeType: RuntimeEnvironmentInfo['runtimeType'] = 'node';
  if (isDockerEnvironment()) {
    runtimeType = 'docker';
  } else if (isLimaEnvironment()) {
    runtimeType = 'lima';
  } else if (isElectronShell()) {
    runtimeType = 'electron';
  }

  const result: RuntimeEnvironmentInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    runtimeType,
    electronShellVersion: getElectronShellVersion(),
    shellCapabilities: [...getShellCapabilities()],
    uptimeSeconds: process.uptime(),
    dataDirectory: getDataDir(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  moduleLogger.info('Collected runtime environment information', { rawResult: result });
  return result;
}

/**
 * Collect database security information
 */
async function collectDatabaseSecurity(): Promise<DatabaseSecurityInfo> {
  moduleLogger.info('Collecting database security information');

  let passphraseProtected = false;
  try {
    passphraseProtected = getHasUserPassphrase();
  } catch (error) {
    moduleLogger.debug('Could not check passphrase status', { error: getErrorMessage(error) });
  }

  let mainDbSizeBytes = 0;
  try {
    const mainDbStat = await fs.stat(getSQLiteDatabasePath());
    mainDbSizeBytes = mainDbStat.size;
  } catch {
    // DB file may not exist yet
  }

  let llmLogsDbSizeBytes = 0;
  try {
    const llmLogsStat = await fs.stat(getLLMLogsDatabasePath());
    llmLogsDbSizeBytes = llmLogsStat.size;
  } catch {
    // LLM logs DB may not exist yet
  }

  const result: DatabaseSecurityInfo = {
    passphraseProtected,
    mainDbSizeBytes,
    llmLogsDbSizeBytes,
    highestAppVersion: null,
  };

  moduleLogger.info('Collected database security information', { rawResult: result });
  return result;
}

/**
 * Collect backup status for main DB and LLM logs
 */
async function collectBackupStatus(): Promise<BackupStatusInfo> {
  moduleLogger.info('Collecting backup status');

  const mainDb: BackupInfo = { count: 0, newestDate: null, oldestDate: null, totalSizeBytes: 0 };
  const llmLogs: BackupInfo = { count: 0, newestDate: null, oldestDate: null, totalSizeBytes: 0 };

  try {
    const backupsDir = getBackupsDir();
    let files: string[];
    try {
      files = await fs.readdir(backupsDir);
    } catch {
      // Backups directory doesn't exist yet
      const result = { mainDb, llmLogs };
      moduleLogger.info('Collected backup status (no backups directory)', { rawResult: result });
      return result;
    }

    const mainDates: Date[] = [];
    const llmLogsDates: Date[] = [];

    for (const filename of files) {
      const llmLogsDate = parseLLMLogsBackupFilename(filename);
      if (llmLogsDate) {
        let size = 0;
        try {
          const stat = await fs.stat(path.join(backupsDir, filename));
          size = stat.size;
        } catch {
          // Skip files we can't stat
        }
        llmLogs.count++;
        llmLogs.totalSizeBytes += size;
        llmLogsDates.push(llmLogsDate);
        continue;
      }

      const mainDate = parseBackupFilename(filename);
      if (mainDate) {
        let size = 0;
        try {
          const stat = await fs.stat(path.join(backupsDir, filename));
          size = stat.size;
        } catch {
          // Skip files we can't stat
        }
        mainDb.count++;
        mainDb.totalSizeBytes += size;
        mainDates.push(mainDate);
      }
    }

    if (mainDates.length > 0) {
      mainDates.sort((a, b) => a.getTime() - b.getTime());
      mainDb.oldestDate = mainDates[0].toISOString();
      mainDb.newestDate = mainDates[mainDates.length - 1].toISOString();
    }

    if (llmLogsDates.length > 0) {
      llmLogsDates.sort((a, b) => a.getTime() - b.getTime());
      llmLogs.oldestDate = llmLogsDates[0].toISOString();
      llmLogs.newestDate = llmLogsDates[llmLogsDates.length - 1].toISOString();
    }
  } catch (error) {
    moduleLogger.warn('Failed to collect backup status', { error: getErrorMessage(error) });
  }

  const result = { mainDb, llmLogs };
  moduleLogger.info('Collected backup status', { rawResult: result });
  return result;
}

/**
 * Collect MCP server configuration
 */
async function collectMCPServers(userId: string): Promise<MCPServersInfo> {
  moduleLogger.info('Collecting MCP server configuration', { userId });

  const defaults: MCPServersInfo = {
    configured: 0,
    enabled: 0,
    serverNames: [],
    autoReconnect: true,
    maxReconnectAttempts: 5,
  };

  try {
    const globalRepos = getRepositories();
    const mcpConfig = await globalRepos.pluginConfigs.findByUserAndPlugin(userId, 'qtap-plugin-mcp');

    if (!mcpConfig) {
      moduleLogger.info('Collected MCP server configuration (no config)', { rawResult: defaults });
      return defaults;
    }

    const config = mcpConfig.config as Record<string, unknown>;
    let servers: Array<Record<string, unknown>> = [];

    if (config.servers) {
      try {
        servers = typeof config.servers === 'string'
          ? JSON.parse(config.servers)
          : Array.isArray(config.servers) ? config.servers : [];
      } catch {
        moduleLogger.debug('Failed to parse MCP servers config');
      }
    }

    const serverNames: string[] = [];
    let enabledCount = 0;

    for (const server of servers) {
      // Extract display name or name — never expose URL or auth fields
      const name = (server.displayName || server.name || 'Unnamed Server') as string;
      serverNames.push(name);
      if (server.enabled === true) {
        enabledCount++;
      }
    }

    const result: MCPServersInfo = {
      configured: servers.length,
      enabled: enabledCount,
      serverNames,
      autoReconnect: (config.autoReconnect as boolean) ?? true,
      maxReconnectAttempts: (config.maxReconnectAttempts as number) ?? 5,
    };

    moduleLogger.info('Collected MCP server configuration', { rawResult: result });
    return result;
  } catch (error) {
    moduleLogger.warn('Failed to collect MCP server configuration', { error: getErrorMessage(error) });
    return defaults;
  }
}

/**
 * Collect theme information
 */
async function collectThemeInfo(userId: string): Promise<ThemeReportInfo> {
  moduleLogger.info('Collecting theme information', { userId });

  const globalRepos = getRepositories();
  const chatSettings = await globalRepos.chatSettings.findByUserId(userId);

  const activeThemeId = chatSettings?.themePreference?.activeThemeId ?? null;
  const colorMode = chatSettings?.themePreference?.colorMode ?? 'system';

  let stats: ThemeReportInfo['stats'] = { total: 0, withDarkMode: 0, withCssOverrides: 0, errors: 0 };
  try {
    const rawStats = getThemeStats();
    stats = {
      total: rawStats.total,
      withDarkMode: rawStats.withDarkMode,
      withCssOverrides: rawStats.withCssOverrides,
      errors: rawStats.errors,
    };
  } catch (error) {
    moduleLogger.debug('Failed to get theme stats', { error: getErrorMessage(error) });
  }

  let themes: ThemeListItem[] = [];
  try {
    themes = getAllThemes().map(t => ({
      name: t.name,
      version: t.version,
      source: t.source,
    }));
  } catch (error) {
    moduleLogger.debug('Failed to get theme list', { error: getErrorMessage(error) });
  }

  const result: ThemeReportInfo = { activeThemeId, colorMode, stats, themes };
  moduleLogger.info('Collected theme information', { rawResult: result });
  return result;
}

/**
 * Collect feature configuration settings
 */
async function collectFeatureConfig(userId: string): Promise<FeatureConfigInfo> {
  moduleLogger.info('Collecting feature configuration', { userId });

  const globalRepos = getRepositories();
  const chatSettings = await globalRepos.chatSettings.findByUserId(userId);

  const dc = chatSettings?.dangerousContentSettings;
  const cc = chatSettings?.contextCompressionSettings;
  const am = chatSettings?.agentModeSettings;
  const sb = chatSettings?.storyBackgroundsSettings;
  const ts = chatSettings?.defaultTimestampConfig;
  const al = chatSettings?.autoLockSettings;
  const mc = chatSettings?.memoryCascadePreferences;

  const result: FeatureConfigInfo = {
    dangerousContent: {
      mode: dc?.mode ?? 'OFF',
      threshold: dc?.threshold ?? 0.7,
      scanTextChat: dc?.scanTextChat ?? true,
      scanImagePrompts: dc?.scanImagePrompts ?? true,
      scanImageGeneration: dc?.scanImageGeneration ?? false,
    },
    contextCompression: {
      enabled: cc?.enabled ?? true,
      windowSize: cc?.windowSize ?? 5,
      compressionTargetTokens: cc?.compressionTargetTokens ?? 800,
    },
    agentMode: {
      maxTurns: am?.maxTurns ?? 10,
      defaultEnabled: am?.defaultEnabled ?? false,
    },
    storyBackgrounds: {
      enabled: sb?.enabled ?? false,
      hasDefaultImageProfile: !!(sb?.defaultImageProfileId),
    },
    timestamps: {
      mode: ts?.mode ?? 'NONE',
      format: ts?.format ?? 'FRIENDLY',
    },
    autoLock: {
      enabled: al?.enabled ?? false,
      idleMinutes: al?.idleMinutes ?? 15,
    },
    memoryCascade: {
      onMessageDelete: mc?.onMessageDelete ?? 'ASK_EVERY_TIME',
      onSwipeRegenerate: mc?.onSwipeRegenerate ?? 'DELETE_MEMORIES',
    },
    autoDetectRng: chatSettings?.autoDetectRng ?? true,
    avatarDisplay: {
      mode: chatSettings?.avatarDisplayMode ?? 'ALWAYS',
      style: chatSettings?.avatarDisplayStyle ?? 'CIRCULAR',
    },
  };

  moduleLogger.info('Collected feature configuration', { rawResult: result });
  return result;
}

/**
 * Collect chat statistics from already-fetched chats
 */
function collectChatStats(chats: ChatMetadata[]): ChatStatsInfo {
  moduleLogger.info('Collecting chat statistics');

  let totalEstimatedCostUSD = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalMessages = 0;
  let agentModeChats = 0;
  let dangerousChats = 0;

  for (const chat of chats) {
    totalEstimatedCostUSD += chat.estimatedCostUSD ?? 0;
    totalPromptTokens += chat.totalPromptTokens ?? 0;
    totalCompletionTokens += chat.totalCompletionTokens ?? 0;
    totalMessages += chat.messageCount ?? 0;
    if (chat.agentModeEnabled === true) agentModeChats++;
    if (chat.isDangerousChat === true) dangerousChats++;
  }

  const result: ChatStatsInfo = {
    totalEstimatedCostUSD,
    totalPromptTokens,
    totalCompletionTokens,
    totalMessages,
    agentModeChats,
    dangerousChats,
  };

  moduleLogger.info('Collected chat statistics', { rawResult: result });
  return result;
}

/**
 * Collect LLM log statistics
 */
async function collectLLMLogStats(userId: string): Promise<LLMLogStatsInfo> {
  moduleLogger.info('Collecting LLM log statistics', { userId });

  try {
    const repos = getUserRepositories(userId);
    const globalRepos = getRepositories();

    const totalEntries = await repos.llmLogs.countByUserId();
    const tokenUsage = await repos.llmLogs.getTotalTokenUsage();

    const chatSettings = await globalRepos.chatSettings.findByUserId(userId);
    const loggingEnabled = chatSettings?.llmLoggingSettings?.enabled ?? true;
    const verboseMode = chatSettings?.llmLoggingSettings?.verboseMode ?? false;
    const retentionDays = chatSettings?.llmLoggingSettings?.retentionDays ?? 30;

    const result: LLMLogStatsInfo = {
      totalEntries,
      tokenUsage,
      loggingEnabled,
      verboseMode,
      retentionDays,
    };

    moduleLogger.info('Collected LLM log statistics', { rawResult: result });
    return result;
  } catch (error) {
    moduleLogger.warn('Failed to collect LLM log statistics', { error: getErrorMessage(error) });
    return {
      totalEntries: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      loggingEnabled: true,
      verboseMode: false,
      retentionDays: 30,
    };
  }
}

/**
 * Collect enhanced database statistics
 */
async function collectEnhancedDatabaseStats(userId: string): Promise<{ stats: EnhancedDatabaseStats; chats: ChatMetadata[] }> {
  moduleLogger.info('Collecting enhanced database statistics', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Count documents in each collection
  const [characters, chats, tags] = await Promise.all([
    repos.characters.findAll(),
    repos.chats.findAll(),
    repos.tags.findAll(),
  ]);

  // For memories, we need to count across all characters
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // Count favorite characters
  const favoriteCharacters = characters.filter(c => c.isFavorite).length;

  // Projects
  let projectCount = 0;
  try {
    const projects = await repos.projects.findAll();
    projectCount = projects.length;
  } catch (error) {
    moduleLogger.debug('Failed to count projects', { error: getErrorMessage(error) });
  }

  // Connection profiles
  let connectionProfileStats = { total: 0, webSearchEnabled: 0, toolUseEnabled: 0, dangerousCompatible: 0 };
  try {
    const profiles = await repos.connections.findAll();
    connectionProfileStats = {
      total: profiles.length,
      webSearchEnabled: profiles.filter(p => p.allowWebSearch).length,
      toolUseEnabled: profiles.filter(p => p.allowToolUse).length,
      dangerousCompatible: profiles.filter(p => p.isDangerousCompatible).length,
    };
  } catch (error) {
    moduleLogger.debug('Failed to count connection profiles', { error: getErrorMessage(error) });
  }

  // Image profiles
  let imageProfileCount = 0;
  try {
    const imgProfiles = await repos.imageProfiles.findAll();
    imageProfileCount = imgProfiles.length;
  } catch (error) {
    moduleLogger.debug('Failed to count image profiles', { error: getErrorMessage(error) });
  }

  // Embedding profiles
  let embeddingProfileCount = 0;
  try {
    const embProfiles = await repos.embeddingProfiles.findAll();
    embeddingProfileCount = embProfiles.length;
  } catch (error) {
    moduleLogger.debug('Failed to count embedding profiles', { error: getErrorMessage(error) });
  }

  // Prompt templates
  let promptTemplateStats = { total: 0, builtIn: 0, custom: 0 };
  try {
    const prompts = await globalRepos.promptTemplates.findAllForUser(userId);
    const builtIn = prompts.filter(p => p.isBuiltIn).length;
    promptTemplateStats = { total: prompts.length, builtIn, custom: prompts.length - builtIn };
  } catch (error) {
    moduleLogger.debug('Failed to count prompt templates', { error: getErrorMessage(error) });
  }

  // Roleplay templates
  let roleplayTemplateStats = { total: 0, builtIn: 0, custom: 0 };
  try {
    const rts = await globalRepos.roleplayTemplates.findAllForUser(userId);
    const builtIn = rts.filter(r => r.isBuiltIn).length;
    roleplayTemplateStats = { total: rts.length, builtIn, custom: rts.length - builtIn };
  } catch (error) {
    moduleLogger.debug('Failed to count roleplay templates', { error: getErrorMessage(error) });
  }

  const stats: EnhancedDatabaseStats = {
    characters: characters.length,
    favoriteCharacters,
    chats: chats.length,
    memories: memoriesCount,
    tags: tags.length,
    projects: projectCount,
    connectionProfiles: connectionProfileStats,
    imageProfiles: imageProfileCount,
    embeddingProfiles: embeddingProfileCount,
    promptTemplates: promptTemplateStats,
    roleplayTemplates: roleplayTemplateStats,
  };

  moduleLogger.info('Collected enhanced database statistics', { rawResult: stats });
  return { stats, chats };
}

/**
 * Collect storage statistics
 */
async function collectStorageStats(userId: string): Promise<StorageStats> {
  moduleLogger.info('Collecting storage statistics', { userId });

  try {
    const repos = getUserRepositories(userId);

    // Get all files for the user
    const userFiles = await repos.files.findAll();

    // Build folder statistics
    const folderStats = new Map<string, FolderStats>();
    let totalSize = 0;

    for (const file of userFiles) {
      totalSize += file.size;

      // Extract folder path or use root
      const folderPath = file.folderPath || '/';

      if (!folderStats.has(folderPath)) {
        folderStats.set(folderPath, {
          path: folderPath,
          fileCount: 0,
          totalSize: 0,
        });
      }

      const folder = folderStats.get(folderPath)!;
      folder.fileCount++;
      folder.totalSize += file.size;
    }

    const stats: StorageStats = {
      totalFiles: userFiles.length,
      totalSize,
      folders: Array.from(folderStats.values()).sort((a, b) => b.totalSize - a.totalSize),
    };

    moduleLogger.info('Collected storage statistics', { rawResult: stats });
    return stats;
  } catch (error) {
    moduleLogger.error('Failed to collect storage statistics', {}, error as Error);
    return {
      totalFiles: 0,
      totalSize: 0,
      folders: [],
    };
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Generate complete capabilities report data
 */
export async function generateReportData(userId: string): Promise<CapabilitiesReportData> {
  moduleLogger.info('Starting capabilities report generation', { userId });

  // Collect independent data in parallel where possible
  const [
    plugins,
    providers,
    modelsByProvider,
    cheapLLM,
    imagePromptLLM,
    embeddingProvider,
    imageProviders,
    embeddingProviders,
    runtimeEnvironment,
    databaseSecurity,
    backupStatus,
    mcpServers,
    themeInfo,
    featureConfig,
    dbResult,
    llmLogStats,
    storageStats,
  ] = await Promise.all([
    collectPluginInfo(),
    collectProviderInfo(userId),
    collectModels(userId),
    collectCheapLLMInfo(userId),
    collectImagePromptLLMInfo(userId),
    collectEmbeddingInfo(userId),
    collectImageProviders(),
    collectEmbeddingProviders(),
    Promise.resolve(collectRuntimeEnvironment()),
    collectDatabaseSecurity(),
    collectBackupStatus(),
    collectMCPServers(userId),
    collectThemeInfo(userId),
    collectFeatureConfig(userId),
    collectEnhancedDatabaseStats(userId),
    collectLLMLogStats(userId),
    collectStorageStats(userId),
  ]);

  // Derive chat stats from already-fetched chats
  const chatStats = collectChatStats(dbResult.chats);

  const data: CapabilitiesReportData = {
    version: getVersion(),
    nodeEnv: process.env.NODE_ENV || 'development',
    generatedAt: new Date().toISOString(),
    runtimeEnvironment,
    databaseSecurity,
    backupStatus,
    plugins,
    apiKeyTypes: collectApiKeyTypes(),
    providers,
    modelsByProvider,
    cheapLLM,
    imagePromptLLM,
    embeddingProvider,
    imageProviders,
    embeddingProviders,
    mcpServers,
    themeInfo,
    featureConfig,
    databaseStats: dbResult.stats,
    chatStats,
    llmLogStats,
    storageStats,
  };

  moduleLogger.info('Capabilities report generation complete', { userId });
  return data;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format USD currency
 */
function formatUSD(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/**
 * Generate markdown report from data
 */
export function generateMarkdownReport(data: CapabilitiesReportData): string {
  const lines: string[] = [];

  lines.push('# Quilltap Capabilities Report');
  lines.push('');
  lines.push(`Generated: ${new Date(data.generatedAt).toLocaleString()}`);
  lines.push('');

  // ========================================================================
  // 1. System Information (enhanced)
  // ========================================================================
  lines.push('## System Information');
  lines.push('');
  lines.push(`- **Version**: ${data.version}`);
  lines.push(`- **Node Environment**: ${data.nodeEnv}`);
  lines.push(`- **Node Version**: ${data.runtimeEnvironment.nodeVersion}`);
  lines.push(`- **Platform**: ${data.runtimeEnvironment.platform} (${data.runtimeEnvironment.arch})`);
  lines.push(`- **OS**: ${data.runtimeEnvironment.osType} ${data.runtimeEnvironment.osRelease}`);
  lines.push(`- **Runtime Type**: ${data.runtimeEnvironment.runtimeType}`);
  lines.push(`- **Total Memory**: ${formatBytes(data.runtimeEnvironment.totalMemoryBytes)}`);
  lines.push(`- **Free Memory**: ${formatBytes(data.runtimeEnvironment.freeMemoryBytes)}`);
  lines.push(`- **Uptime**: ${Math.floor(data.runtimeEnvironment.uptimeSeconds / 3600)}h ${Math.floor((data.runtimeEnvironment.uptimeSeconds % 3600) / 60)}m`);
  lines.push(`- **Timezone**: ${data.runtimeEnvironment.timezone}`);
  lines.push(`- **Data Directory**: ${data.runtimeEnvironment.dataDirectory}`);
  lines.push('');

  // ========================================================================
  // 2. Database & Security
  // ========================================================================
  lines.push('## Database & Security');
  lines.push('');
  lines.push(`- **Passphrase Protected**: ${data.databaseSecurity.passphraseProtected ? 'Yes' : 'No'}`);
  lines.push(`- **Main DB Size**: ${formatBytes(data.databaseSecurity.mainDbSizeBytes)}`);
  lines.push(`- **LLM Logs DB Size**: ${formatBytes(data.databaseSecurity.llmLogsDbSizeBytes)}`);
  if (data.databaseSecurity.highestAppVersion) {
    lines.push(`- **Highest App Version**: ${data.databaseSecurity.highestAppVersion}`);
  }
  lines.push('');

  // ========================================================================
  // 3. Backup Status
  // ========================================================================
  lines.push('## Backup Status');
  lines.push('');
  lines.push('| Database | Backups | Newest | Oldest | Total Size |');
  lines.push('|----------|---------|--------|--------|------------|');
  const mainNewest = data.backupStatus.mainDb.newestDate
    ? new Date(data.backupStatus.mainDb.newestDate).toLocaleDateString()
    : 'N/A';
  const mainOldest = data.backupStatus.mainDb.oldestDate
    ? new Date(data.backupStatus.mainDb.oldestDate).toLocaleDateString()
    : 'N/A';
  lines.push(`| Main DB | ${data.backupStatus.mainDb.count} | ${mainNewest} | ${mainOldest} | ${formatBytes(data.backupStatus.mainDb.totalSizeBytes)} |`);
  const llmNewest = data.backupStatus.llmLogs.newestDate
    ? new Date(data.backupStatus.llmLogs.newestDate).toLocaleDateString()
    : 'N/A';
  const llmOldest = data.backupStatus.llmLogs.oldestDate
    ? new Date(data.backupStatus.llmLogs.oldestDate).toLocaleDateString()
    : 'N/A';
  lines.push(`| LLM Logs | ${data.backupStatus.llmLogs.count} | ${llmNewest} | ${llmOldest} | ${formatBytes(data.backupStatus.llmLogs.totalSizeBytes)} |`);
  lines.push('');

  // ========================================================================
  // 4. Plugins (existing)
  // ========================================================================
  lines.push('## Plugins');
  lines.push('');

  lines.push('### Enabled Plugins');
  lines.push('');
  if (data.plugins.enabled.length > 0) {
    lines.push('| Name | Version | Capabilities |');
    lines.push('|------|---------|--------------|');
    for (const plugin of data.plugins.enabled) {
      lines.push(`| ${plugin.title} | ${plugin.version} | ${plugin.capabilities.join(', ')} |`);
    }
  } else {
    lines.push('*No enabled plugins*');
  }
  lines.push('');

  lines.push('### Disabled Plugins');
  lines.push('');
  if (data.plugins.disabled.length > 0) {
    lines.push('| Name | Version | Capabilities |');
    lines.push('|------|---------|--------------|');
    for (const plugin of data.plugins.disabled) {
      lines.push(`| ${plugin.title} | ${plugin.version} | ${plugin.capabilities.join(', ')} |`);
    }
  } else {
    lines.push('*No disabled plugins*');
  }
  lines.push('');

  // ========================================================================
  // 5. LLM Providers (existing — Available Providers table)
  // ========================================================================
  lines.push('## LLM Providers');
  lines.push('');
  lines.push('### Available Providers');
  lines.push('');
  lines.push('| Provider | Configured | Capabilities |');
  lines.push('|----------|------------|--------------|');
  for (const provider of data.providers) {
    const caps: string[] = [];
    if (provider.capabilities.chat) caps.push('Chat');
    if (provider.capabilities.imageGeneration) caps.push('Images');
    if (provider.capabilities.embeddings) caps.push('Embeddings');
    if (provider.capabilities.webSearch) caps.push('Web Search');
    const configured = provider.configured ? '✓' : '✗';
    lines.push(`| ${provider.displayName} | ${configured} | ${caps.join(', ')} |`);
  }
  lines.push('');

  // ========================================================================
  // 6. Models by Provider (existing)
  // ========================================================================
  lines.push('### Models by Provider');
  lines.push('');
  for (const providerModels of data.modelsByProvider) {
    lines.push(`#### ${providerModels.provider}`);
    lines.push('');
    if (providerModels.error) {
      lines.push(`*Error fetching models: ${providerModels.error}*`);
    } else if (providerModels.models.length > 0) {
      for (const model of providerModels.models) {
        lines.push(`- ${model}`);
      }
    } else {
      lines.push('*No models available*');
    }
    lines.push('');
  }

  // ========================================================================
  // 7. Cost Configuration (existing)
  // ========================================================================
  lines.push('## Cost Configuration');
  lines.push('');
  if (data.cheapLLM.provider) {
    lines.push(`- **Cheap LLM**: ${data.cheapLLM.provider} / ${data.cheapLLM.model} (${data.cheapLLM.profileName})`);
  } else {
    lines.push('- **Cheap LLM**: *Not configured*');
  }
  if (data.imagePromptLLM.provider) {
    lines.push(`- **Image Prompt LLM**: ${data.imagePromptLLM.provider} / ${data.imagePromptLLM.model} (${data.imagePromptLLM.profileName})`);
  }
  if (data.embeddingProvider.provider) {
    lines.push(`- **Embedding Provider**: ${data.embeddingProvider.provider} / ${data.embeddingProvider.model} (${data.embeddingProvider.profileName})`);
  } else {
    lines.push('- **Embedding Provider**: *Not configured*');
  }
  lines.push('');

  // ========================================================================
  // 8. Image Providers (existing)
  // ========================================================================
  lines.push('## Image Providers');
  lines.push('');
  if (data.imageProviders.length > 0) {
    lines.push('| Provider | Models |');
    lines.push('|----------|--------|');
    for (const provider of data.imageProviders) {
      const models = provider.models.length > 0 ? provider.models.join(', ') : '*No models listed*';
      lines.push(`| ${provider.displayName} | ${models} |`);
    }
  } else {
    lines.push('*No image providers available*');
  }
  lines.push('');

  // ========================================================================
  // 9. Embedding Providers (existing)
  // ========================================================================
  lines.push('## Embedding Providers');
  lines.push('');
  if (data.embeddingProviders.length > 0) {
    lines.push('| Provider | Models |');
    lines.push('|----------|--------|');
    for (const provider of data.embeddingProviders) {
      const models = provider.models.length > 0 ? provider.models.join(', ') : '*No models listed*';
      lines.push(`| ${provider.displayName} | ${models} |`);
    }
  } else {
    lines.push('*No embedding providers available*');
  }
  lines.push('');

  // ========================================================================
  // 10. MCP Servers
  // ========================================================================
  lines.push('## MCP Servers');
  lines.push('');
  if (data.mcpServers.configured > 0) {
    lines.push(`- **Configured**: ${data.mcpServers.configured}`);
    lines.push(`- **Enabled**: ${data.mcpServers.enabled}`);
    lines.push(`- **Auto-Reconnect**: ${data.mcpServers.autoReconnect ? 'Yes' : 'No'}`);
    lines.push(`- **Max Reconnect Attempts**: ${data.mcpServers.maxReconnectAttempts}`);
    lines.push('');
    lines.push('### Server Names');
    lines.push('');
    for (const name of data.mcpServers.serverNames) {
      lines.push(`- ${name}`);
    }
  } else {
    lines.push('*No MCP servers configured*');
  }
  lines.push('');

  // ========================================================================
  // 11. Theme Information
  // ========================================================================
  lines.push('## Theme Information');
  lines.push('');
  lines.push(`- **Active Theme**: ${data.themeInfo.activeThemeId ?? 'Default'}`);
  lines.push(`- **Color Mode**: ${data.themeInfo.colorMode}`);
  lines.push(`- **Total Themes**: ${data.themeInfo.stats.total}`);
  lines.push(`- **With Dark Mode**: ${data.themeInfo.stats.withDarkMode}`);
  lines.push(`- **With CSS Overrides**: ${data.themeInfo.stats.withCssOverrides}`);
  if (data.themeInfo.stats.errors > 0) {
    lines.push(`- **Load Errors**: ${data.themeInfo.stats.errors}`);
  }
  lines.push('');
  if (data.themeInfo.themes.length > 0) {
    lines.push('| Theme | Version | Source |');
    lines.push('|-------|---------|--------|');
    for (const theme of data.themeInfo.themes) {
      lines.push(`| ${theme.name} | ${theme.version} | ${theme.source} |`);
    }
  }
  lines.push('');

  // ========================================================================
  // 12. Feature Configuration
  // ========================================================================
  lines.push('## Feature Configuration');
  lines.push('');

  lines.push('### The Concierge (Dangerous Content)');
  lines.push('');
  lines.push(`- **Mode**: ${data.featureConfig.dangerousContent.mode}`);
  lines.push(`- **Threshold**: ${data.featureConfig.dangerousContent.threshold}`);
  lines.push(`- **Scan Text Chat**: ${data.featureConfig.dangerousContent.scanTextChat ? 'Yes' : 'No'}`);
  lines.push(`- **Scan Image Prompts**: ${data.featureConfig.dangerousContent.scanImagePrompts ? 'Yes' : 'No'}`);
  lines.push(`- **Scan Image Generation**: ${data.featureConfig.dangerousContent.scanImageGeneration ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push('### Context Compression');
  lines.push('');
  lines.push(`- **Enabled**: ${data.featureConfig.contextCompression.enabled ? 'Yes' : 'No'}`);
  lines.push(`- **Window Size**: ${data.featureConfig.contextCompression.windowSize}`);
  lines.push(`- **Compression Target Tokens**: ${data.featureConfig.contextCompression.compressionTargetTokens}`);
  lines.push('');

  lines.push('### Prospero (Agent Mode)');
  lines.push('');
  lines.push(`- **Max Turns**: ${data.featureConfig.agentMode.maxTurns}`);
  lines.push(`- **Default Enabled**: ${data.featureConfig.agentMode.defaultEnabled ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push('### The Lantern (Story Backgrounds)');
  lines.push('');
  lines.push(`- **Enabled**: ${data.featureConfig.storyBackgrounds.enabled ? 'Yes' : 'No'}`);
  lines.push(`- **Has Default Image Profile**: ${data.featureConfig.storyBackgrounds.hasDefaultImageProfile ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push('### Timestamps');
  lines.push('');
  lines.push(`- **Mode**: ${data.featureConfig.timestamps.mode}`);
  lines.push(`- **Format**: ${data.featureConfig.timestamps.format}`);
  lines.push('');

  lines.push('### Auto-Lock');
  lines.push('');
  lines.push(`- **Enabled**: ${data.featureConfig.autoLock.enabled ? 'Yes' : 'No'}`);
  lines.push(`- **Idle Minutes**: ${data.featureConfig.autoLock.idleMinutes}`);
  lines.push('');

  lines.push('### Memory Cascade');
  lines.push('');
  lines.push(`- **On Message Delete**: ${data.featureConfig.memoryCascade.onMessageDelete}`);
  lines.push(`- **On Swipe/Regenerate**: ${data.featureConfig.memoryCascade.onSwipeRegenerate}`);
  lines.push('');

  lines.push('### Pascal the Croupier (RNG)');
  lines.push('');
  lines.push(`- **Auto-Detect RNG**: ${data.featureConfig.autoDetectRng ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push('### Avatar Display');
  lines.push('');
  lines.push(`- **Mode**: ${data.featureConfig.avatarDisplay.mode}`);
  lines.push(`- **Style**: ${data.featureConfig.avatarDisplay.style}`);
  lines.push('');

  // ========================================================================
  // 13. Database Statistics (enhanced)
  // ========================================================================
  lines.push('## Database Statistics');
  lines.push('');
  lines.push('| Collection | Count |');
  lines.push('|------------|-------|');
  lines.push(`| Characters | ${data.databaseStats.characters} |`);
  lines.push(`| Favorite Characters | ${data.databaseStats.favoriteCharacters} |`);
  lines.push(`| Chats | ${data.databaseStats.chats} |`);
  lines.push(`| Memories | ${data.databaseStats.memories} |`);
  lines.push(`| Tags | ${data.databaseStats.tags} |`);
  lines.push(`| Projects | ${data.databaseStats.projects} |`);
  lines.push(`| Connection Profiles | ${data.databaseStats.connectionProfiles.total} (${data.databaseStats.connectionProfiles.webSearchEnabled} web search, ${data.databaseStats.connectionProfiles.toolUseEnabled} tool use, ${data.databaseStats.connectionProfiles.dangerousCompatible} dangerous) |`);
  lines.push(`| Image Profiles | ${data.databaseStats.imageProfiles} |`);
  lines.push(`| Embedding Profiles | ${data.databaseStats.embeddingProfiles} |`);
  lines.push(`| Prompt Templates | ${data.databaseStats.promptTemplates.total} (${data.databaseStats.promptTemplates.builtIn} built-in, ${data.databaseStats.promptTemplates.custom} custom) |`);
  lines.push(`| Roleplay Templates | ${data.databaseStats.roleplayTemplates.total} (${data.databaseStats.roleplayTemplates.builtIn} built-in, ${data.databaseStats.roleplayTemplates.custom} custom) |`);
  lines.push('');

  // ========================================================================
  // 14. Chat Statistics
  // ========================================================================
  lines.push('## Chat Statistics');
  lines.push('');
  lines.push(`- **Total Messages**: ${data.chatStats.totalMessages.toLocaleString()}`);
  lines.push(`- **Total Prompt Tokens**: ${data.chatStats.totalPromptTokens.toLocaleString()}`);
  lines.push(`- **Total Completion Tokens**: ${data.chatStats.totalCompletionTokens.toLocaleString()}`);
  lines.push(`- **Estimated Total Cost**: ${formatUSD(data.chatStats.totalEstimatedCostUSD)}`);
  lines.push(`- **Agent Mode Chats**: ${data.chatStats.agentModeChats}`);
  lines.push(`- **Dangerous Chats**: ${data.chatStats.dangerousChats}`);
  lines.push('');

  // ========================================================================
  // 15. LLM Log Statistics
  // ========================================================================
  lines.push('## LLM Log Statistics');
  lines.push('');
  lines.push(`- **Total Log Entries**: ${data.llmLogStats.totalEntries.toLocaleString()}`);
  lines.push(`- **Total Prompt Tokens**: ${data.llmLogStats.tokenUsage.promptTokens.toLocaleString()}`);
  lines.push(`- **Total Completion Tokens**: ${data.llmLogStats.tokenUsage.completionTokens.toLocaleString()}`);
  lines.push(`- **Total Tokens**: ${data.llmLogStats.tokenUsage.totalTokens.toLocaleString()}`);
  lines.push(`- **Logging Enabled**: ${data.llmLogStats.loggingEnabled ? 'Yes' : 'No'}`);
  lines.push(`- **Verbose Mode**: ${data.llmLogStats.verboseMode ? 'Yes' : 'No'}`);
  lines.push(`- **Retention**: ${data.llmLogStats.retentionDays === 0 ? 'Forever' : `${data.llmLogStats.retentionDays} days`}`);
  lines.push('');

  // ========================================================================
  // 16. Storage Statistics (existing)
  // ========================================================================
  lines.push('## Storage Statistics');
  lines.push('');
  lines.push('### Summary');
  lines.push('');
  lines.push(`- **Total Files**: ${data.storageStats.totalFiles}`);
  lines.push(`- **Total Size**: ${formatBytes(data.storageStats.totalSize)}`);
  lines.push('');

  lines.push('### Folder Breakdown');
  lines.push('');
  if (data.storageStats.folders.length > 0) {
    lines.push('| Folder | Files | Size |');
    lines.push('|--------|-------|------|');
    for (const folder of data.storageStats.folders) {
      lines.push(`| ${folder.path} | ${folder.fileCount} | ${formatBytes(folder.totalSize)} |`);
    }
    lines.push(`| **Total** | **${data.storageStats.totalFiles}** | **${formatBytes(data.storageStats.totalSize)}** |`);
  } else {
    lines.push('*No files in storage*');
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate and save a capabilities report
 */
export async function generateAndSaveReport(userId: string): Promise<{
  reportId: string;
  filename: string;
  storageKey: string;
  size: number;
  content: string;
}> {
  moduleLogger.info('Generating and saving capabilities report', { userId });

  // Generate report data
  const data = await generateReportData(userId);

  // Generate markdown
  const markdown = generateMarkdownReport(data);

  // Create report metadata
  const reportId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `capabilities-report-${timestamp}.md`;

  // Upload to file storage
  const buffer = Buffer.from(markdown, 'utf-8');
  const uploadResult = await fileStorageManager.uploadFile({
    filename,
    content: buffer,
    contentType: 'text/markdown',
    projectId: null,
  });

  moduleLogger.info('Capabilities report saved', {
    reportId,
    filename,
    storageKey: uploadResult.storageKey,
    size: buffer.length,
  });

  return {
    reportId,
    filename,
    storageKey: uploadResult.storageKey,
    size: buffer.length,
    content: markdown,
  };
}
