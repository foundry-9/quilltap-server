/**
 * Provider Base Classes
 *
 * Reusable base classes for building LLM provider plugins.
 * External plugins can extend these classes to create custom providers
 * with minimal boilerplate.
 *
 * @packageDocumentation
 */

export {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from './openai-compatible';
