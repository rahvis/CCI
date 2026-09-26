"use client";

import type { ChatRole, ConfidentialProof, ConformalPrediction } from "@/lib/chat/types";

// Hand-rolled fetch + ReadableStream SSE client — not the AI SDK's `useChat`.
// The server emits a 4th frame type (`event: proof`) carrying the
// conformal-prediction + confidential-proof trailer, which the AI SDK's own
// UI-message-stream protocol has no clean extension point for. This parser
// ports directly from the vanilla-JS SSE reader already proven in the
// previous FastAPI app's chat page.

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "proof"; conformalPrediction: ConformalPrediction; confidentialProof: ConfidentialProof | null }
  | { type: "done"; tokens: number; elapsedSeconds: number; tokensPerSecond: number | null }
  | { type: "error"; error: string };

export async function* streamChat(
  message: string,
  history: { role: ChatRole; content: string }[],
): AsyncGenerator<ChatStreamEvent> {
  let resp: Response;
  try {
    resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
  } catch (err) {
    yield { type: "error", error: err instanceof Error ? err.message : "network error" };
    return;
  }

  if (!resp.ok || !resp.body) {
    yield { type: "error", error: `HTTP ${resp.status}` };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice(7).trim();
      let data: any;
      try {
        data = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }
      if (event === "token" && typeof data.t === "string") {
        yield { type: "token", text: data.t };
      } else if (event === "proof") {
        yield {
          type: "proof",
          conformalPrediction: data.conformal_prediction,
          confidentialProof: data.confidential_proof,
        };
      } else if (event === "done") {
        yield {
          type: "done",
          tokens: data.tokens,
          elapsedSeconds: data.elapsed_seconds,
          tokensPerSecond: data.tokens_per_second,
        };
      } else if (event === "error") {
        yield { type: "error", error: data.error };
      }
    }
  }
}
