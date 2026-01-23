/**
 * SSE Event Stream Parser
 *
 * Parses Server-Sent Events (SSE) from text/event-stream format.
 * Handles the standard SSE format:
 *
 * event: message
 * data: {"jsonrpc":"2.0","id":1,"result":{...}}
 *
 * : keep-alive comment
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

import type { SSEEvent } from './types';

/**
 * Parse SSE events from a chunk of text
 *
 * Handles multi-line data fields (concatenated with newlines) and
 * ignores comment lines (starting with ':').
 *
 * @param chunk - Raw text chunk from the SSE stream
 * @returns Array of parsed SSE events
 */
export function parseSSEEvents(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = chunk.split('\n');

  let currentEvent: Partial<SSEEvent> = {};
  let dataLines: string[] = [];

  for (const line of lines) {
    // Comment/keep-alive line - ignore
    if (line.startsWith(':')) {
      continue;
    }

    // Empty line signals end of event
    if (line === '') {
      if (dataLines.length > 0) {
        currentEvent.data = dataLines.join('\n');
        events.push(currentEvent as SSEEvent);
      }
      currentEvent = {};
      dataLines = [];
      continue;
    }

    // Parse field:value
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      // Line with no colon - treat as field name with empty value
      continue;
    }

    const field = line.slice(0, colonIndex);
    // Value starts after colon, skip optional leading space
    let value = line.slice(colonIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'event':
        currentEvent.event = value;
        break;
      case 'data':
        // Data can span multiple lines
        dataLines.push(value);
        break;
      case 'id':
        currentEvent.id = value;
        break;
      case 'retry':
        const retry = parseInt(value, 10);
        if (!isNaN(retry)) {
          currentEvent.retry = retry;
        }
        break;
      // Unknown fields are ignored per spec
    }
  }

  // Handle case where chunk ends without trailing newline
  if (dataLines.length > 0) {
    currentEvent.data = dataLines.join('\n');
    events.push(currentEvent as SSEEvent);
  }

  return events;
}

/**
 * Parse JSON data from an SSE event
 *
 * @param event - The SSE event to parse
 * @returns Parsed JSON data or null if parsing fails
 */
export function parseSSEData<T = unknown>(event: SSEEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

/**
 * Check if an SSE event is a keep-alive or comment
 *
 * @param line - Raw line from SSE stream
 * @returns true if line is a comment/keep-alive
 */
export function isSSEComment(line: string): boolean {
  return line.startsWith(':');
}

/**
 * Create an SSE stream reader from a ReadableStream
 *
 * Handles buffering across chunks to ensure complete events are parsed.
 *
 * @param stream - ReadableStream from fetch response
 * @returns AsyncGenerator yielding SSE events
 */
export async function* createSSEReader(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const events = parseSSEEvents(buffer);
          for (const event of events) {
            yield event;
          }
        }
        break;
      }

      // Decode and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Look for complete events (double newline)
      let eventEnd = buffer.indexOf('\n\n');
      while (eventEnd !== -1) {
        const eventText = buffer.slice(0, eventEnd + 2);
        buffer = buffer.slice(eventEnd + 2);

        const events = parseSSEEvents(eventText);
        for (const event of events) {
          yield event;
        }

        eventEnd = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
