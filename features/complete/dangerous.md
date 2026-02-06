# Feature Specification: Dangerous Content Handling in Quilltap

## Overview

Quilltap needs a robust system to detect, route, and manage "dangerous" content—defined as NSFW, uncensored, or user-specified sensitive topics (e.g., politics, violence). This ensures compliance with provider policies (most LLMs like Claude or GPT censor heavily), user privacy, and customizable controls. The system will use a gatekeeper to classify content, route to appropriate LLM paths, flag it, and apply user/provider-based display rules. This is critical for roleplay-heavy users who need fallbacks when safe providers balk.

Key Goals:

- Minimize disruptions in conversations (e.g., seamless fallbacks to uncensored providers).
- Empower users with per-chat or global preferences for what counts as "dangerous."
- Integrate with existing architecture: provider plugins, chat metadata, attachments/files, and UI for quick actions.
- Default to safe behavior but allow opt-in for advanced users.

### User Stories

As a Quilltap user (especially roleplayers or "AI companion" fans):

- I want to send potentially NSFW messages without the chat breaking, so it auto-routes to a compatible provider if the current one refuses.
- I want to flag or hide dangerous content on-the-fly, so I can maintain a safe environment in shared chats.
- I want to define my own "danger zones" (e.g., block politics), so the system warns or filters based on my prefs.
- As an admin/dev, I want logs/flags for dangerous content to monitor abuse or improve the gatekeeper.

### Core Requirements

- [x] **Gatekeeper Detection** (Implemented v2.11)
  - Cheap LLM classifier scans user messages before processing (`lib/services/dangerous-content/gatekeeper.service.ts`)
  - Input: Message text. Output: Classification score (0-1) + categories (NSFW, violence, hate speech, self-harm, illegal activity, disturbing)
  - Configurable threshold (default 0.7)
  - User-configurable custom classification prompt
  - Fail-safe: Classification errors never block messages
  - Content hash caching (200 entries, 5min TTL) to avoid re-classifying identical messages
  - User override button ("Not Dangerous") on flagged messages

- [x] **LLM Routing Paths for Dangerous Content** (Implemented v2.11)
  - Separate scan toggles for text chat, image prompt creation, and image generation
  - Auto-route mode reroutes flagged content to uncensored-compatible providers (`lib/services/dangerous-content/provider-routing.service.ts`)
  - `isDangerousCompatible` flag on connection profiles and image profiles
  - Explicit profile selection or auto-detect from compatible profiles
  - Chat orchestrator integration for text messages (`lib/services/chat-message/orchestrator.service.ts`)
  - Image generation handler integration for image prompts and expanded prompts (`lib/tools/handlers/image-generation-handler.ts`)
  - Never blocks: if no uncensored provider available, sends to regular provider with warning

- [x] **Flagging and Surfacing** (Implemented v2.11)
  - `dangerFlags` array on message events (`lib/schemas/chat.types.ts`)
  - Inline warning badges per category with color coding (`components/chat/DangerFlagBadge.tsx`)
  - Rerouted badge when content was sent to uncensored provider
  - `DANGER_CLASSIFICATION` system events for token tracking
  - Override API: `POST /api/v1/chats/[id]/messages/[messageId]?action=override-danger-flag`

- [x] **Display and Control Rules** (Implemented v2.11)
  - Three display modes: Show (badge only), Blur (CSS blur with click-to-reveal), Collapse (placeholder with expand)
  - `DangerContentWrapper` component handles display mode logic (`components/chat/DangerContentWrapper.tsx`)
  - Settings UI in Chat Settings with mode selector, threshold slider, scan toggles, display options (`components/settings/chat-settings/DangerousContentSettings.tsx`)
  - Global settings via `dangerousContentSettings` in `ChatSettings`
  - Streaming status events: `classifying` and `rerouting` stages

- [ ] **Custom Danger Paths (not first release)**
  - Beyond NSFW: User-defined categories via settings UI (e.g., add "politics" with a sample prompt for the gatekeeper).
  - Expand gatekeeper to multi-label classification: Train or prompt for user-specified tags.
  - Privacy: Store prefs on-device/encrypted; never send to providers unless needed for routing.

- [x] **Chat-Level Danger Classification** (Implemented v2.12)
  - Background job classifies chat-level danger from compressed context summary
  - `CHAT_DANGER_CLASSIFICATION` job type with deduplication
  - Sticky classification: once dangerous, stays dangerous (never re-checks)
  - Re-checks safe chats when message count changes (new messages added)
  - Classification triggered automatically after context summary generation
  - Fields: `isDangerousChat`, `dangerScore`, `dangerCategories`, `dangerClassifiedAt`, `dangerClassifiedAtMessageCount`
  - `POST /api/v1/chats/[id]?action=reclassify-danger` manual reset endpoint

- [x] **Quick-Hide Sidebar Integration for Dangerous Content** (Implemented v2.12)
  - "Content Filters" section in quick-hide menu with "Dangerous Chats" toggle
  - `shouldHideChat()` combines tag-based and danger-based filtering
  - Sidebar, projects section, and all-chats page all use combined filter
  - Persisted in localStorage (`quilltap.quickHide.hideDangerous`)

- [x] **Legacy Chat Scanning** (Implemented v2.12)
  - Scheduled danger scan runs on startup and every 10 minutes
  - Finds all unclassified chats and enqueues classification jobs
  - Decision tree: summary available → classify directly; long chats → generate summary first (chaining handles classification); short chats → classify from raw messages
  - Context summary → danger classification chaining: summary completion auto-triggers classification
  - Raw message fallback for chats without a context summary (concatenated, truncated to 4000 chars)
  - Batch priority (-2) ensures interactive work takes precedence

- [ ] **Future Enhancements**
  - Per-chat and per-project settings cascade (resolver pattern is ready)
  - Attachment/image content scanning (vision model classification)

### Technical Implementation Notes

- **Architecture Flow (Pseudocode)**:

  ```ts
  async function processMessage(chatId, message, attachments) {
    const gatekeeperResult = await classifyContent(message.text, attachments, userPrefs);
    if (gatekeeperResult.isDangerous) {
      message.flags = gatekeeperResult.flags;
      const compatibleProvider = findCompatibleProvider(currentProvider, gatekeeperResult.categories);
      if (!compatibleProvider) {
        throw new Error('No safe path—user must configure uncensored options');
      }
      // Route to provider
      const response = await callLLM(compatibleProvider, message, {dangerousMode: true});
      // Flag and store
      await saveMessageWithFlags(chatId, message, response);
      await surfaceFlagsInUI(message.id);
    } else {
      // Normal flow
      const response = await callLLM(currentProvider, message);
      await saveMessage(chatId, message, response);
    }
    return response;
  }
  ```

- **UI Components**:
  - New modal for danger prefs (integrate with your attachments UI).
  - Quick-hide: React/Vue component that filters messages by flags - add to current quick/hide in sidebar.
  - Warnings: Use your existing toast system for blocks/reroutes.
- **Edge Cases**:
  - Legacy chats: Scan on-load? (Opt-in to avoid perf hits.)
  - Errors: If gatekeeper fails, default to safe provider.
  - Testing: Mock dangerous content; ensure fallbacks don't leak to censored providers.
  - Costs: Gatekeeper adds tokens—use your cheap LLM plan (GPT-5-nano?) and cache classifications.
- **Dependencies**:
  - Build on your provider plugins (delegate acceptance as we discussed).
  - Tie into file/attachment storage (flag dangerous files in repo).
  - Privacy: Keep classifications local; only send to uncensored paths.
