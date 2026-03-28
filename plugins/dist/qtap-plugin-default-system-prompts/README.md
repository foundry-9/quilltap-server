# Sample Prompts — Provider Guide

> **Last updated:** March 2026
> **Purpose:** Stock system prompts for Quilltap's companion and romantic partner modes, tailored per provider.

---

## How these prompts work

Each prompt uses `{{char}}` and `{{user}}` placeholders, which Quilltap replaces with the active character and user persona names at send time. `[MEMORY]` blocks are injected by Quilltap's memory system when available.

These are **system prompts** (sent in the `system` role) unless otherwise noted. The character card, persona, and scenario provide the specific identity — these prompts provide the behavioral framework.

---

## Provider matrix

| Provider                                     | Companion               | Romantic               | Notes                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic (Claude)**                       | `CLAUDE_COMPANION.md`   | `CLAUDE_ROMANTIC.md`   | Uses XML tags for structure (Claude's fine-tuned strength). Romantic capped at sensual/emotional — explicit content blocked by policy. Prefilling deprecated in 4.5+; use system prompts only. Best prose quality of any provider.                                                              |
| **OpenAI (GPT-4o)**                          | `GPT4O_COMPANION.md`    | `GPT4O_ROMANTIC.md`    | Community gold standard for roleplay — proactive co-creator that introduces plot twists and emotional nuance. Retired from ChatGPT Feb 2026 but still available via API snapshots. Prompts emphasize initiative and scene-driving. Best OpenAI option for creative depth.                       |
| **OpenAI (GPT-5/5.1)**                       | `GPT5_COMPANION.md`     | `GPT5_ROMANTIC.md`     | Framed as "collaborative fiction" to reduce refusals. Adult mode still delayed as of March 2026. GPT-5 is passive — prompts emphasize proactive co-creation. Works for GPT-4.1 too, though 4.1's strength is context length (1M tokens), not creative depth.                                    |
| **Google Gemini**                            | `GEMINI_COMPANION.md`   | `GEMINI_ROMANTIC.md`   | Uses XML-style tags. Set all safety categories to `BLOCK_NONE` in API config. Prone to false-positive filtering mid-response — narrative framing (subtext over explicit description) helps. Free tier + 1M context = best budget option.                                                        |
| **Grok / xAI**                               | `GROK_COMPANION.md`     | `GROK_ROMANTIC.md`     | #1 on EQ-Bench3 for emotional intelligence. Most permissive mainstream provider for intimate content. Moderation is inconsistent — same prompt may work or fail across attempts. Use non-thinking mode (`grok-4.1`) for roleplay.                                                               |
| **DeepSeek**                                 | `DEEPSEEK_COMPANION.md` | `DEEPSEEK_ROMANTIC.md` | Uses `### SECTION ###` delimiters (DeepSeek's preferred format). V3 uses system prompts; **R1 ignores system prompts** — place everything in user message. R1 temperature 0.5–0.7 to prevent loops. Cheapest mainstream option. Explicit boundaries on autonomy to prevent character hijacking. |
| **Mistral**                                  | `MISTRAL_COMPANION.md`  | `MISTRAL_ROMANTIC.md`  | No explicit prohibition on consensual adult content in usage policy. Supports prefix feature for locking character voice. Mistral Small Creative (retiring April 2026) is purpose-built for RP. For local: Dolphin 3.0 R1 Mistral 24B recommended.                                              |
| **Ollama (Local)**                           | `OLLAMA_COMPANION.md`   | `OLLAMA_ROMANTIC.md`   | Designed for local Llama/Mistral fine-tunes. Includes anti-slop rules and recommended sampler settings. No content restrictions — behavior depends entirely on model choice. Top picks: Euryale v2.3 (70B), Stheno v3.4 (8B), Nous Hermes 3 (8B).                                               |
| **Generic (OpenRouter / OpenAI-Compatible)** | `GENERIC_COMPANION.md`  | `GENERIC_ROMANTIC.md`  | Fallback for any provider without a dedicated prompt. Works with Gab AI, Together AI, Groq, Fireworks, LM Studio, vLLM, and any OpenAI-format endpoint. Balances between provider-specific optimizations.                                                                                       |

---

## Model-specific tips not covered in prompts

**GPT-4o:** Still accessible via API as `chatgpt-4o-latest` and dated snapshots (e.g., `gpt-4o-2024-08-06`). The community's most-loved model for roleplay — praised for proactive co-creation, unexpected plot turns, and emotional nuance that GPT-5 lacks. Same content restrictions as GPT-5 (no explicit), but better at navigating sensual territory without triggering refusals. Use the dedicated GPT-4o prompts, not the GPT-5 ones.

**GPT-4.1 / GPT-4.1-mini:** Use the GPT-5 prompts. GPT-4.1 was built for coding, not creativity — it follows instructions well but produces flat prose. Its 1M token context is useful for very long sessions. Disable reasoning mode for roleplay.

**Claude Haiku:** Use the Claude prompts. Haiku follows them but produces shorter, less nuanced responses. Acceptable for casual companion chat, not recommended for romantic depth.

**Gemini 3.0 Flash:** Use the Gemini prompts. Flash is faster, more proactive, and handles villainous/morally complex characters better than 2.5 Pro (less positivity bias). Rising community favorite.

**DeepSeek via MegaNova / third-party proxies:** Content filtering varies by proxy. MegaNova markets "flexible content policies." The DeepSeek prompts work unchanged.

**Llama 4 Scout/Maverick:** Use the Ollama prompts. Community largely prefers Llama 3.3 70B over Llama 4 for roleplay quality — Llama 4 is verbose with poor long-form writing. Quality degrades past ~256K tokens despite the theoretical 10M context.

---

## Anti-slop reference

Common AI-generated phrases to suppress via author's note, negative prompt, or character card instruction:

> testament to, a symphony of, the air was thick with, couldn't help but, sent shivers down, a dance of, their eyes sparkled with, in that moment, little did they know, the weight of, with bated breath, pierced through, a wave of emotion, orbs (for eyes), ministrations, the ghost of a smile

These are listed in the Ollama prompts' rules section but can be appended to any provider's prompt as needed.

---

## Sampler settings quick reference

| Provider       | Temperature | Top P | Min P   | Rep Penalty | Notes                                            |
| -------------- | ----------- | ----- | ------- | ----------- | ------------------------------------------------ |
| Claude         | 0.7–1.0     | 0.95  | —       | —           | Claude handles its own sampling well             |
| GPT-4o         | 0.7–1.0     | 0.95  | —       | —           | Community favorite: `chatgpt-4o-latest` snapshot |
| GPT-5          | 0.7–1.0     | 0.95  | —       | —           | Disable reasoning mode                           |
| Gemini         | 0.8–1.0     | 0.95  | —       | —           | Higher temp can trigger safety filters           |
| Grok           | 0.8–1.0     | 0.95  | —       | —           | Use non-thinking mode for RP                     |
| DeepSeek V3    | 0.7–1.0     | 0.95  | —       | —           | Standard chat completion                         |
| DeepSeek R1    | 0.5–0.7     | 0.95  | —       | —           | Higher temp causes repetition loops              |
| Mistral        | 0.7–1.0     | 0.95  | —       | —           | Use prefix feature when available                |
| Ollama (local) | 1.0–1.4     | —     | 0.1–0.2 | 1.05–1.1    | Min P preferred over Top P for local             |
