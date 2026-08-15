export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

const OMITTED_EVENT_TYPES = new Set([
  "turn_start",
  "turn_end",
]);

/**
 * Project raw SDK agent events onto the wire shape the desktop client
 * consumes, filtering out events it never uses.
 *
 * Unlike upstream's web client (which streams Pi 0.84 delta events), the
 * desktop client still streams from the cumulative `message` snapshot on each
 * `message_update`, so the `assistantMessageEvent` delta payload is dropped
 * here rather than serialized and transmitted for every streamed chunk.
 */
export function toClientAgentEvent(
  event: AgentEventLike,
): AgentEventLike | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;

  if (event.type === "tool_execution_update") {
    // Forward only the progress payload; the repeated tool arguments are not
    // needed client-side and would bloat every progress chunk.
    return {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      partialResult: event.partialResult,
    };
  }

  if (event.type === "message_update") {
    const { assistantMessageEvent: _delta, ...snapshotEvent } = event;
    void _delta;
    return snapshotEvent;
  }

  if (event.type === "agent_end") {
    // The desktop client uses these fields to show non-retryable provider
    // failures, unlike upstream's web-only client which needs no end payload.
    return {
      type: "agent_end",
      ...(event.willRetry !== undefined ? { willRetry: event.willRetry } : {}),
      ...(event.messages !== undefined ? { messages: event.messages } : {}),
    };
  }

  return event;
}

/**
 * True when the event is a streaming update already reflected in the session
 * snapshot that the SSE stream replays right after `connected`. Skipping it
 * avoids re-delivering the in-flight partial message that started before the
 * client (re)connected.
 */
export function isEventIncludedInSnapshot(
  event: AgentEventLike,
  snapshot: unknown,
): boolean {
  return snapshot !== undefined
    && (event.type === "message_start" || event.type === "message_update")
    && event.message === snapshot;
}
