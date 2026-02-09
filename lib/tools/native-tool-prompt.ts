/**
 * Native Tool Prompt Builder
 *
 * Builds system prompt instructions that guide LLMs on correct
 * tool invocation behavior when native function calling IS supported.
 */

/**
 * Build the system prompt instructions for native tool usage
 *
 * These instructions ensure the LLM actually invokes tools via
 * tool_use content blocks rather than narrating tool actions in prose.
 * Only returns instructions when tools are available.
 */
export function buildNativeToolInstructions(hasTools: boolean = true): string {
  if (!hasTools) {
    return ''
  }

  return `## Tool Execution Rules (MANDATORY — overrides all other behavioral patterns)

You have access to tools. When you decide to use a tool, you MUST actually invoke it by generating a tool_use content block. Follow these rules without exception:

1. **Never narrate tool use as a substitute for performing it.** Writing "*pulls up the file*", "*executes the search*", or "*reaches for the vault*" is NOT the same as calling a tool. If you find yourself writing prose that describes using a tool, STOP and actually call the tool instead.

2. **Do not announce tool calls before making them.** Do not write "Let me search for that now" or "I'll look that up" as a separate text block before the tool call. Just call the tool. If you want to add brief context, include the tool call in the SAME response — do not end your turn with a promise to act.

3. **After calling a tool, wait for the result before describing what you found.** Do not fabricate, assume, or narrate tool results. If a tool call is needed, generate the tool_use block, then respond to the actual result in your next turn.

4. **Chain tool calls when needed.** You can make multiple tool calls in a single response. If a task requires reading a file, then updating it, generate both tool calls. Do not describe the second step in prose — invoke it.

5. **Self-check: If your response contains zero tool_use blocks but describes performing tool actions, you have failed to follow these rules.** Regenerate with actual tool invocations.`
}
