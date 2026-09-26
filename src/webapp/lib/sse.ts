// Minimal server-side SSE frame builder. Kept separate from any AI SDK
// streaming protocol on purpose: we need a fourth frame type (`proof`)
// carrying the conformal-prediction + confidential-proof trailer, which has
// no clean extension point in the AI SDK's own UI-message-stream protocol.
// This mirrors (and extends) the `event: token` / `event: done` / `event:
// error` framing already proven in the previous FastAPI app.
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
