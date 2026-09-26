// Line-buffered SSE reader for vLLM's streaming /v1/chat/completions
// response. Node's native fetch gives a WHATWG ReadableStream body; chunks
// don't necessarily land on line boundaries, so partial lines are buffered
// across reads exactly like the previous FastAPI app's `aiter_lines()` did.
export async function* readSSELines(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) yield line;
    }
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}
