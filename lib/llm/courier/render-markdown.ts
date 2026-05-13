/**
 * The Courier — render an assembled LLM request as a single Markdown blob.
 *
 * Used by the manual / clipboard transport. The orchestrator builds the same
 * `formattedMessages` array it would send to an API provider, then hands it
 * here. We render the entire request as Markdown the human user can copy out,
 * carry to an external LLM, and paste a reply back in.
 *
 * No tool descriptions are included. The remote LLM is operating purely on
 * text context and any tools its host happens to offer (web search, code
 * interpreter, etc.) — none of Quilltap's tools are reachable.
 */

import type { LLMMessage } from '@quilltap/plugin-types';

export interface CourierAttachmentDescriptor {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface RenderCourierRequestInput {
  /** The assembled provider-shaped messages (system + history + new user msg). */
  messages: LLMMessage[];
  /** Display name of the responding character. */
  characterName: string;
  /** Informational model label from the profile (free text). */
  modelLabel?: string;
}

export interface RenderCourierRequestOutput {
  markdown: string;
  attachments: CourierAttachmentDescriptor[];
}

const HUMAN_READABLE_ROLES: Record<string, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool result',
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function escapeFilename(name: string): string {
  return name.replace(/[\]\[()]/g, (c) => '\\' + c);
}

function attachmentDownloadUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

/**
 * Convert an LLMMessage attachment into the descriptor we surface to the UI
 * and reference inside the Markdown blob. Filenames missing on the attachment
 * fall back to the attachment id.
 */
function descriptorFromAttachment(att: NonNullable<LLMMessage['attachments']>[number]): CourierAttachmentDescriptor {
  return {
    fileId: att.id,
    filename: att.filename || att.id,
    mimeType: att.mimeType || 'application/octet-stream',
    sizeBytes: typeof att.size === 'number' ? att.size : 0,
    downloadUrl: attachmentDownloadUrl(att.id),
  };
}

/**
 * Render a single LLMMessage as a Markdown section.
 */
function renderMessageBlock(m: LLMMessage, atts: CourierAttachmentDescriptor[]): string {
  const roleLabel = HUMAN_READABLE_ROLES[m.role] ?? m.role;
  const speaker = m.name ? `${roleLabel} — ${m.name}` : roleLabel;
  const lines: string[] = [];
  lines.push(`### ${speaker}`);
  lines.push('');
  if (m.content && m.content.length > 0) {
    lines.push(m.content);
    lines.push('');
  }
  if (atts.length > 0) {
    lines.push('**Attachments** _(download below; re-upload in your destination client if it supports the type):_');
    lines.push('');
    for (const a of atts) {
      lines.push(
        `- [${escapeFilename(a.filename)}](${a.downloadUrl}) — ${a.mimeType}, ${formatBytes(a.sizeBytes)}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderCourierRequestAsMarkdown(input: RenderCourierRequestInput): RenderCourierRequestOutput {
  const { messages, characterName, modelLabel } = input;
  const aggregatedAttachments: CourierAttachmentDescriptor[] = [];

  // Pull system prompt out of position 0 if present. Provider-shaped requests
  // always lead with the system role here, but we render defensively in case
  // the caller passes a history without one.
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const parts: string[] = [];

  parts.push('# Instructions');
  parts.push('');
  parts.push(
    `You are roleplaying as **${characterName}**. Below is the full context Quilltap would otherwise send to an LLM API. Read the **System** section for character identity, scene state, memories, and any roleplay-template instructions; then read the **Conversation** for prior messages; then write **${characterName}**'s next turn.`,
  );
  parts.push('');
  parts.push('- Respond in Markdown as plain prose — no JSON wrapper.');
  parts.push('- Do not break character.');
  parts.push('- You have no Quilltap tools available; respond using only text. Any tools offered by your own host (web search, code interpreter, etc.) are your own discretion.');
  if (modelLabel) {
    parts.push(`- Suggested model: \`${modelLabel}\` (informational; use whichever LLM you prefer).`);
  }
  parts.push('');

  if (systemMessages.length > 0) {
    parts.push('# System');
    parts.push('');
    for (const m of systemMessages) {
      if (m.content && m.content.length > 0) {
        parts.push(m.content);
        parts.push('');
      }
    }
  }

  parts.push('# Conversation');
  parts.push('');
  if (nonSystemMessages.length === 0) {
    parts.push('_(no prior conversation)_');
    parts.push('');
  } else {
    for (const m of nonSystemMessages) {
      const messageAtts = (m.attachments ?? []).map(descriptorFromAttachment);
      for (const a of messageAtts) {
        if (!aggregatedAttachments.some((x) => x.fileId === a.fileId)) {
          aggregatedAttachments.push(a);
        }
      }
      parts.push(renderMessageBlock(m, messageAtts));
    }
  }

  parts.push('# Your turn');
  parts.push('');
  parts.push(`Write **${characterName}**'s next message. Return only the message body in Markdown.`);
  parts.push('');

  return {
    markdown: parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    attachments: aggregatedAttachments,
  };
}

// ============================================================================
// Delta renderer
// ============================================================================

/**
 * Per-character delta-mode checkpoint stored on the chat row. The orchestrator
 * consults this to decide whether to render the full bundle (no checkpoint =
 * first turn for this character) or the delta bundle.
 */
export interface CourierCheckpoint {
  lastResolvedMessageId: string;
  /** ISO timestamp of when the operator submitted the paste. The delta
   *  includes every chat event with `createdAt > resolvedAt`. */
  resolvedAt: string;
}

/**
 * One delta event — corresponds to a chat_message row that came AFTER the
 * checkpoint. The orchestrator passes these in chronological order; the
 * renderer turns them into Markdown sections.
 */
export interface CourierDeltaEvent {
  /** Display speaker label, already resolved (e.g. "Ariadne", "User", or "[Staff: Aurora]"). */
  speaker: string;
  /** ISO timestamp for the section header. */
  createdAt: string;
  /** Body text to render under the heading. */
  content: string;
  /** Attachments referenced by this event. */
  attachments?: CourierAttachmentDescriptor[];
}

export interface RenderCourierDeltaInput {
  events: CourierDeltaEvent[];
  characterName: string;
  modelLabel?: string;
}

export interface RenderCourierDeltaOutput {
  markdown: string;
  attachments: CourierAttachmentDescriptor[];
}

function renderDeltaEventBlock(event: CourierDeltaEvent): string {
  const lines: string[] = [];
  lines.push(`### ${event.speaker} _(${event.createdAt})_`);
  lines.push('');
  if (event.content && event.content.length > 0) {
    lines.push(event.content);
    lines.push('');
  }
  const atts = event.attachments ?? [];
  if (atts.length > 0) {
    lines.push('**Attachments** _(download below; re-upload if your destination client supports the type):_');
    lines.push('');
    for (const a of atts) {
      lines.push(
        `- [${escapeFilename(a.filename)}](${a.downloadUrl}) — ${a.mimeType}, ${formatBytes(a.sizeBytes)}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Render the delta-mode bundle: a short continuation header plus only the
 * chat events that came AFTER the last successful Courier resolve for this
 * character. No system prompt is included — the desktop LLM client is
 * assumed to remember its own prior conversation.
 */
export function renderCourierDeltaAsMarkdown(input: RenderCourierDeltaInput): RenderCourierDeltaOutput {
  const { events, characterName, modelLabel } = input;
  const aggregatedAttachments: CourierAttachmentDescriptor[] = [];

  const parts: string[] = [];
  parts.push('# Continuing the conversation');
  parts.push('');
  parts.push(
    `You are still **${characterName}**. The bundle below contains only what is new since your last reply — Quilltap has otherwise been carrying on the conversation without you. Read the new messages, then write **${characterName}**'s next turn.`,
  );
  parts.push('');
  parts.push('- Respond in Markdown as plain prose — no JSON wrapper.');
  parts.push('- Do not break character.');
  parts.push('- If your LLM client has lost the earlier conversation (new chat, app restart, switched models), ask the operator to switch this bubble to "Use full context" before you reply.');
  if (modelLabel) {
    parts.push(`- Suggested model: \`${modelLabel}\` (informational; use whichever LLM you prefer).`);
  }
  parts.push('');

  parts.push('# New since your last reply');
  parts.push('');
  if (events.length === 0) {
    parts.push('_(Nothing new — the operator nudged you to continue speaking.)_');
    parts.push('');
  } else {
    for (const e of events) {
      const atts = e.attachments ?? [];
      for (const a of atts) {
        if (!aggregatedAttachments.some((x) => x.fileId === a.fileId)) {
          aggregatedAttachments.push(a);
        }
      }
      parts.push(renderDeltaEventBlock(e));
    }
  }

  parts.push('# Your turn');
  parts.push('');
  parts.push(`Write **${characterName}**'s next message. Return only the message body in Markdown.`);
  parts.push('');

  return {
    markdown: parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    attachments: aggregatedAttachments,
  };
}

