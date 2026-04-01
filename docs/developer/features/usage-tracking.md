# Usage & Remaining-Balance Tracking Feature Request

**Status:** Proposal / Not Implemented

## Summary

Improve the Tools workspace and provider plugins so that Quilltap surfaces how much budget is left on each configured LLM API key. Today admins must open every provider’s dashboard manually. This feature captures the expected UX, required provider API calls, and guardrails identified during investigation.

## Goals

- Show live “credits remaining” or recent spend for every configured provider inside the Tools ➜ Capabilities Report and Provider Settings views.
- Alert admins when a provider is close to depletion (threshold configurable per provider or globally).
- Favor official/documented APIs; only rely on private endpoints where users explicitly opt in.

## Provider Notes

### OpenAI

- Official [Usage API](https://platform.openai.com/docs/api-reference/usage) exposes per-key spend when filtered by `api_key_ids`.
- Dashboard also uses the undocumented `GET https://api.openai.com/dashboard/billing/credit_grants` endpoint which returns `total_granted`, `total_used`, and `total_available`. If Quilltap calls this route, it must be gated behind an “allow undocumented APIs” toggle and handle Cloudflare-block failures gracefully.
- Implementation idea:
  - Provider plugin fetches Usage data every N minutes (default 15) and caches in Mongo under the provider connection.
  - If admin enables “Show Credit Grants,” call the dashboard endpoint and merge `total_available` into the UI.

### OpenRouter

- [Documented endpoint](https://openrouter.ai/docs/api/reference/limits): `GET https://openrouter.ai/api/v1/key`
  - Returns `limit_remaining`, `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, etc.
  - Requires only the user’s API key; no extra scopes.
- Implementation idea:
  - Provider plugin pulls `/api/v1/key` whenever the Capabilities Report runs or on demand.
  - Store `limit_remaining` plus the timestamp in provider metadata so we can trend usage over time.

### Anthropic

- Offers a [Usage & Cost Admin API](https://docs.anthropic.com/en/docs/build-with-claude/usage-cost-api) that **requires** an Admin API key (`sk-ant-admin…`).
- API returns fine-grained usage by model/workspace/key but not “credits remaining.” Admins still need to set an internal budget ceiling and compare to reported spend.
- Implementation idea:
  - Add fields to the Anthropic provider config for `adminApiKey` and optional monthly budget numbers.
  - Capabilities Report fetches recent usage and computes “% of budget consumed.”

### Google Gemini

- Gemini usage bills through Google Cloud. There is no Gemini-specific balance endpoint.
- Recommended approach: hook into Google Cloud Budgets and programmatic Pub/Sub notifications (see [Set up programmatic notifications](https://cloud.google.com/billing/docs/how-to/notify)).
- Implementation idea:
  - Provider config gains “Billing Account ID” and optional Pub/Sub topic details.
  - Expose instructions + link so admins can create a budget; Quilltap can poll Pub/Sub or accept signed webhooks pushed into an internal API route.

### Grok (xAI)

- Public API documentation only covers inference endpoints. No published billing/usage route.
- Feature request track: subscribe to xAI updates or partner program to learn if a usage endpoint becomes available.
- For now, display a notice in Provider Settings telling admins to check the xAI dashboard manually and optionally enter remaining credits manually for alerting.

### Gab AI

- Documentation sits behind Cloudflare and there is no exposed API for credit balances.
- Treat similar to Grok: surface instructions for manual tracking and allow admin-entered numbers for alert thresholds.

### Ollama & OpenAI-Compatible (LM Studio, vLLM, etc.)

- These are self-hosted endpoints with no concept of credits.
- UI should simply show “local / unlimited” and skip alerts.

## UX Requirements

- **Tools ➜ Capabilities Report**
  - Add a “Provider Usage” section summarizing:
    - Current balance (if provider supports it)
    - Last refreshed timestamp
    - Link to view detailed history or provider dashboard
  - If a provider has no balance API, show a badge such as “Manual tracking only” with instructions.

- **Provider Settings**
  - Add toggles/fields per provider:
    - “Enable balance polling” (OpenAI undocumented, OpenRouter documented)
    - “Budget amount” + “Alert threshold %”
    - Optional admin hooks (Anthropic Admin API key, Google Billing Pub/Sub topic, manual remaining credits).
  - Validation: highlight if required keys/secrets are missing for the selected tracking option.

- **Alerts**
  - When remaining credits fall below the configured threshold (or spend exceeds budget), surface:
    - Banner inside the Tools workspace.
    - Optional email/slack webhook (stretch goal).

## Engineering Tasks

1. **Backend**
   - Extend provider plugin contracts to support `getUsageSnapshot(): Promise<UsageSnapshot | null>`.
   - Create a cron/job runner (or reuse existing Capabilities Report scheduler) to call each provider that has tracking enabled.
   - Persist snapshots in Mongo (`providerUsage` collection) with timestamps for auditing.
   - Build alerting helpers that compare current values against thresholds and emit events for the UI/notifications.

2. **Frontend**
   - Update Capabilities Report page to render provider usage cards.
   - Enhance Provider Settings modals/forms with new fields/toggles.
   - Add alert UI components (badges, banners).

3. **Docs**
   - README “Provider Support” table: include a “Balance API” column that summarizes what we can pull automatically.
   - Add deployment guidance (e.g., Anthropic Admin key storage, Google Billing webhook setup).

4. **Testing**
   - Integration tests for each provider’s polling logic (mock responses).
   - E2E test for Capabilities Report to ensure data surfaces correctly even when some providers don’t support tracking.

## Open Questions

- Are we comfortable shipping support for OpenAI’s undocumented `credit_grants` endpoint, or should it stay behind a feature flag until OpenAI offers an official balance API?
- Do we need to throttle OpenRouter `/api/v1/key` calls more aggressively to avoid rate-limit issues if many admins refresh the report simultaneously?
- For Anthropic/Gemini where only usage (not balance) is available, should we ask admins to enter their purchased credit pool so we can compute remaining amounts locally?
- Should alerts integrate with the existing Notification Center, or should we build a dedicated provider-alerts module?

## Success Metrics

- Admins can view remaining credits or spend for every provider from within Quilltap with zero external tabs.
- Alerting triggers before a provider runs out of funds (as reported by admins).
- Capabilities Report includes provider usage data in every export generated after this feature ships.
