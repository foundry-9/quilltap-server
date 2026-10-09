/**
 * The seven `wardrobe_*` tools as one table — name → run. Each entry runs its
 * handler, formats the result for the conversation, and projects the payload
 * the executor returns. The executor builds one `WardrobeToolContext` for all
 * of them, so the turn's announcement set reaches every tool that changes an
 * outfit.
 *
 * @module tools/handlers/wardrobe-tool-table
 */

import { executeWardrobeArchiveTool, formatWardrobeArchiveResults } from './wardrobe-archive-handler';
import { executeWardrobeCreateTool, formatWardrobeCreateResults } from './wardrobe-create-handler';
import type { WardrobeToolContext } from './wardrobe-handler-shared';
import { executeWardrobeListTool, formatWardrobeListResults } from './wardrobe-list-handler';
import { executeWardrobeReadTool, formatWardrobeReadResults } from './wardrobe-read-handler';
import { executeWardrobeTakeOffTool, formatWardrobeTakeOffResults } from './wardrobe-take-off-handler';
import { executeWardrobeUpdateTool, formatWardrobeUpdateResults } from './wardrobe-update-handler';
import { executeWardrobeWearTool, formatWardrobeWearResults } from './wardrobe-wear-handler';

export interface WardrobeToolRun {
  success: boolean;
  result: Record<string, unknown> | null;
  error?: string;
}

export type WardrobeToolRunner = (input: unknown, context: WardrobeToolContext) => Promise<WardrobeToolRun>;

export const WARDROBE_TOOL_TABLE: Record<string, WardrobeToolRunner> = {
  wardrobe_list: async (input, context) => {
    const r = await executeWardrobeListTool(input, context);
    return {
      success: r.success,
      result: r.success
        ? { formattedText: formatWardrobeListResults(r), items: r.items, total_count: r.total_count }
        : null,
      error: r.success ? undefined : r.error,
    };
  },
  wardrobe_read: async (input, context) => {
    const r = await executeWardrobeReadTool(input, context);
    return {
      success: r.success,
      result: r.success ? { formattedText: formatWardrobeReadResults(r), ...r } : null,
      error: r.success ? undefined : r.error,
    };
  },
  wardrobe_create: async (input, context) => {
    const r = await executeWardrobeCreateTool(input, context);
    return {
      success: r.success,
      result: r.success
        ? {
            formattedText: formatWardrobeCreateResults(r),
            item_id: r.item_id,
            title: r.title,
            equipped: r.equipped,
            recipient_name: r.recipient_name,
            current_state: r.current_state,
          }
        : null,
      error: r.success ? undefined : r.error,
    };
  },
  wardrobe_update: async (input, context) => {
    const r = await executeWardrobeUpdateTool(input, context);
    return {
      success: r.success,
      result: r.success ? { formattedText: formatWardrobeUpdateResults(r), ...r } : null,
      error: r.success ? undefined : r.error,
    };
  },
  wardrobe_archive: async (input, context) => {
    const r = await executeWardrobeArchiveTool(input, context);
    return {
      success: r.success,
      result: r.success
        ? { formattedText: formatWardrobeArchiveResults(r), item_id: r.item_id, title: r.title, action: r.action }
        : null,
      error: r.success ? undefined : r.error,
    };
  },
  // Wear and take-off always return a result: a partial run still changed slots.
  wardrobe_wear: async (input, context) => {
    const r = await executeWardrobeWearTool(input, context);
    return {
      success: r.success,
      result: {
        formattedText: formatWardrobeWearResults(r),
        operations: r.operations,
        current_state: r.current_state,
        coverage_summary: r.coverage_summary,
      },
      error: r.success ? undefined : r.error,
    };
  },
  wardrobe_take_off: async (input, context) => {
    const r = await executeWardrobeTakeOffTool(input, context);
    return {
      success: r.success,
      result: {
        formattedText: formatWardrobeTakeOffResults(r),
        operations: r.operations,
        current_state: r.current_state,
        coverage_summary: r.coverage_summary,
      },
      error: r.success ? undefined : r.error,
    };
  },
};
