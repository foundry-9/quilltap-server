/**
 * Destructive Tool Allowlist (4.6 Private Character Rooms)
 *
 * Curated set of tool names that mutate vault or file state irreversibly. In
 * autonomous rooms (`chat.chatType === 'autonomous'`), these tools are removed
 * from the per-turn tool list before the LLM call unless the room owner has
 * explicitly pre-authorized destructive tools via `chat.runDestructiveToolsAllowed === 1`
 * AND the user-level policy is not 'always_refuse'.
 *
 * The user-level setting (`chat_settings.autonomousRoomSettings.destructiveToolPolicy`)
 * is a CEILING: when set to 'always_refuse', the per-room flag cannot grant
 * destructive-tool access.
 *
 * Why a curated set rather than a per-tool flag: there is no
 * `requiresHumanConfirmation` field on tool definitions today, and adding one
 * would touch every tool file in `lib/tools/`. For the 4.6 cut, an explicit
 * allowlist in one place is both lean and easy to audit. Generalization to a
 * structural per-tool flag is a future refactor.
 *
 * Adding a new destructive tool: add its `name` literal to this Set. The
 * per-turn filter in `lib/services/chat-message/streaming.service.ts`
 * (`buildTools()`) handles the rest.
 */

export const DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  'doc_delete_file',
  'doc_delete_folder',
]);

