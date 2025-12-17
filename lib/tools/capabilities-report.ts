/**
 * Capabilities Report Service
 *
 * Generates comprehensive system reports about Quilltap's configuration,
 * capabilities, and statistics.
 */

import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { getAllPlugins } from '@/lib/plugins/registry';
import {
  providerRegistry,
  getAllProviders,
  getProvidersByCapability,
  getConfigRequirements,
} from '@/lib/plugins/provider-registry';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { s3FileService } from '@/lib/s3/file-service';
import { decryptApiKey } from '@/lib/encryption';
import { getFileMetadata, listFiles } from '@/lib/s3/operations';
import { validateS3Config } from '@/lib/s3/config';
import type { LLMProviderPlugin } from '@/lib/plugins/interfaces/provider-plugin';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';
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
  personas: number;
  chats: number;
  memories: number;
  tags: number;
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

export interface CapabilitiesReportData {
  version: string;
  nodeEnv: string;
  generatedAt: string;
  plugins: {
    enabled: PluginInfo[];
    disabled: PluginInfo[];
  };
  apiKeyTypes: string[];
  providers: ProviderInfo[];
  modelsByProvider: ModelInfo[];
  cheapLLM: CheapLLMInfo;
  embeddingProvider: EmbeddingInfo;
  imageProviders: ImageProviderInfo[];
  embeddingProviders: EmbeddingProviderInfo[];
  databaseStats: DatabaseStats;
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
 * Collect plugin information
 */
function collectPluginInfo(): { enabled: PluginInfo[]; disabled: PluginInfo[] } {
  moduleLogger.info('Collecting plugin information');

  const allPlugins = getAllPlugins();
  const enabled: PluginInfo[] = [];
  const disabled: PluginInfo[] = [];

  for (const plugin of allPlugins) {
    const info: PluginInfo = {
      name: plugin.manifest.name,
      title: plugin.manifest.title,
      version: plugin.manifest.version,
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
 */
async function collectModels(userId: string): Promise<ModelInfo[]> {
  moduleLogger.info('Collecting models from providers', { userId });

  const repos = getUserRepositories(userId);
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

      // Decrypt the API key
      const decryptedKey = decryptApiKey(
        apiKeyRecord.ciphertext,
        apiKeyRecord.iv,
        apiKeyRecord.authTag,
        userId
      );

      const baseUrl = baseUrlByProvider.get(providerName);

      // Fetch models
      if (provider.getAvailableModels) {
        moduleLogger.info('Fetching models from provider', { providerName });
        const models = await provider.getAvailableModels(decryptedKey, baseUrl);
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
      } else {
        // Fall back to static model info if available
        if (provider.getModelInfo) {
          const modelInfo = provider.getModelInfo();
          const models = modelInfo.map(m => m.id || m.name).sort((a, b) => a.localeCompare(b));
          modelsByProvider.push({
            provider: providerName,
            models,
          });
        }
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
 */
function collectImageProviders(): ImageProviderInfo[] {
  moduleLogger.info('Collecting image providers');

  const imageProviders = getProvidersByCapability('imageGeneration');
  const result: ImageProviderInfo[] = [];

  for (const provider of imageProviders) {
    const models: string[] = [];

    // Get static image generation models if available
    if (provider.getImageGenerationModels) {
      const imageModels = provider.getImageGenerationModels();
      models.push(...imageModels.map(m => m.id || m.name));
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
 */
function collectEmbeddingProviders(): EmbeddingProviderInfo[] {
  moduleLogger.info('Collecting embedding providers');

  const embeddingProviders = getProvidersByCapability('embeddings');
  const result: EmbeddingProviderInfo[] = [];

  for (const provider of embeddingProviders) {
    const models: string[] = [];

    // Get static embedding models if available
    if (provider.getEmbeddingModels) {
      const embeddingModels = provider.getEmbeddingModels();
      models.push(...embeddingModels.map(m => m.id || m.name));
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
 * Collect database statistics
 */
async function collectDatabaseStats(userId: string): Promise<DatabaseStats> {
  moduleLogger.info('Collecting database statistics', { userId });

  const repos = getUserRepositories(userId);

  // Count documents in each collection
  const [characters, personas, chats, tags] = await Promise.all([
    repos.characters.findAll(),
    repos.personas.findAll(),
    repos.chats.findAll(),
    repos.tags.findAll(),
  ]);

  // For memories, we need to count across all characters
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  const stats: DatabaseStats = {
    characters: characters.length,
    personas: personas.length,
    chats: chats.length,
    memories: memoriesCount,
    tags: tags.length,
  };

  moduleLogger.info('Collected database statistics', { rawResult: stats });
  return stats;
}

/**
 * Collect S3 storage statistics
 */
async function collectStorageStats(userId: string): Promise<StorageStats> {
  moduleLogger.info('Collecting storage statistics', { userId });

  try {
    const config = validateS3Config();
    const prefix = config.pathPrefix || '';
    const userPrefix = `${prefix}users/${userId}/`;

    // List all files for the user
    const allKeys = await listFiles(userPrefix, 10000);

    // Build folder statistics
    const folderStats = new Map<string, FolderStats>();
    let totalSize = 0;

    for (const key of allKeys) {
      // Get file metadata for size
      const metadata = await getFileMetadata(key);
      const fileSize = metadata?.size || 0;
      totalSize += fileSize;

      // Extract category from key (e.g., users/userId/IMAGE/file -> IMAGE)
      const relativePath = key.replace(userPrefix, '');
      const parts = relativePath.split('/');
      const category = parts[0] || 'root';

      if (!folderStats.has(category)) {
        folderStats.set(category, {
          path: `/${category}`,
          fileCount: 0,
          totalSize: 0,
        });
      }

      const folder = folderStats.get(category)!;
      folder.fileCount++;
      folder.totalSize += fileSize;
    }

    const stats: StorageStats = {
      totalFiles: allKeys.length,
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

  const data: CapabilitiesReportData = {
    version: getVersion(),
    nodeEnv: process.env.NODE_ENV || 'development',
    generatedAt: new Date().toISOString(),
    plugins: collectPluginInfo(),
    apiKeyTypes: collectApiKeyTypes(),
    providers: await collectProviderInfo(userId),
    modelsByProvider: await collectModels(userId),
    cheapLLM: await collectCheapLLMInfo(userId),
    embeddingProvider: await collectEmbeddingInfo(userId),
    imageProviders: collectImageProviders(),
    embeddingProviders: collectEmbeddingProviders(),
    databaseStats: await collectDatabaseStats(userId),
    storageStats: await collectStorageStats(userId),
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
 * Generate markdown report from data
 */
export function generateMarkdownReport(data: CapabilitiesReportData): string {
  const lines: string[] = [];

  lines.push('# Quilltap Capabilities Report');
  lines.push('');
  lines.push(`Generated: ${new Date(data.generatedAt).toLocaleString()}`);
  lines.push('');

  // System Information
  lines.push('## System Information');
  lines.push('');
  lines.push(`- **Version**: ${data.version}`);
  lines.push(`- **Node Environment**: ${data.nodeEnv}`);
  lines.push('');

  // Plugins
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

  // API Key Types
  lines.push('## API Key Types');
  lines.push('');
  if (data.apiKeyTypes.length > 0) {
    for (const keyType of data.apiKeyTypes) {
      lines.push(`- ${keyType}`);
    }
  } else {
    lines.push('*No API key types available*');
  }
  lines.push('');

  // LLM Providers
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

  // Models by Provider
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

  // Cost Configuration
  lines.push('## Cost Configuration');
  lines.push('');
  if (data.cheapLLM.provider) {
    lines.push(`- **Cheap LLM**: ${data.cheapLLM.provider} / ${data.cheapLLM.model} (${data.cheapLLM.profileName})`);
  } else {
    lines.push('- **Cheap LLM**: *Not configured*');
  }
  if (data.embeddingProvider.provider) {
    lines.push(`- **Embedding Provider**: ${data.embeddingProvider.provider} / ${data.embeddingProvider.model} (${data.embeddingProvider.profileName})`);
  } else {
    lines.push('- **Embedding Provider**: *Not configured*');
  }
  lines.push('');

  // Image Providers
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

  // Embedding Providers
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

  // Database Statistics
  lines.push('## Database Statistics');
  lines.push('');
  lines.push('| Collection | Count |');
  lines.push('|------------|-------|');
  lines.push(`| Characters | ${data.databaseStats.characters} |`);
  lines.push(`| Personas | ${data.databaseStats.personas} |`);
  lines.push(`| Chats | ${data.databaseStats.chats} |`);
  lines.push(`| Memories | ${data.databaseStats.memories} |`);
  lines.push(`| Tags | ${data.databaseStats.tags} |`);
  lines.push('');

  // Storage Statistics
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
  s3Key: string;
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

  // Upload to S3
  const buffer = Buffer.from(markdown, 'utf-8');
  await s3FileService.uploadUserFile(
    userId,
    reportId,
    filename,
    'REPORT',
    buffer,
    'text/markdown'
  );

  const s3Key = s3FileService.generateS3Key(userId, reportId, filename, 'REPORT');

  moduleLogger.info('Capabilities report saved', {
    reportId,
    filename,
    s3Key,
    size: buffer.length,
  });

  return {
    reportId,
    filename,
    s3Key,
    size: buffer.length,
    content: markdown,
  };
}
