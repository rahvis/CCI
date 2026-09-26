export const runtime = "nodejs";

import { sseFrame } from "@/lib/sse";
import { readSSELines } from "@/lib/vllm/stream";
import { VLLM_CHAT_URL, VLLM_MODEL, FEATURE_LOGPROBS_SUPPORTED, TARGET_COVERAGE } from "@/lib/conformal/config";
import { meanTop1Prob, heuristicConfidence, type TokenLogprob } from "@/lib/conformal/score";
import { categorizeResponse } from "@/lib/conformal/categorize";
import { decide } from "@/lib/conformal/decide";
import { signResponse } from "@/lib/crypto/session-key";
import type { ChatRequestBody, ConformalPrediction } from "@/lib/chat/types";

const encoder = new TextEncoder();

export async function POST(req: Request) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(sseFrame("error", { error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const message = (body.message ?? "").toString();
  const history = Array.isArray(body.history) ? body.history : [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseFrame(event, data)));
      };

      // Categorization depends only on the user's message, so it's kicked
      // off immediately, in parallel with the (slow, ~4 tok/s CPU)
      // generation below, instead of waiting for generation to finish.
      const categorizePromise = categorizeResponse(message).catch(() => null);

      const started = Date.now();
      let fullText = "";
      const tokenLogprobs: TokenLogprob[] = [];
      let sawLogprobs = false;

      try {
        const vllmResp = await fetch(VLLM_CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: VLLM_MODEL,
            messages: [...history, { role: "user", content: message }],
            max_tokens: 256,
            stream: true,
            ...(FEATURE_LOGPROBS_SUPPORTED ? { logprobs: true, top_logprobs: 5 } : {}),
          }),
        });

        if (!vllmResp.ok || !vllmResp.body) {
          const text = await vllmResp.text().catch(() => "");
          enqueue("error", { error: `vLLM returned ${vllmResp.status}: ${text.slice(0, 500)}` });
          controller.close();
          return;
        }

        for await (const line of readSSELines(vllmResp)) {
          if (!line.startsWith("data: ")) continue;
          const chunk = line.slice(6).trim();
          if (chunk === "[DONE]") break;
          if (!chunk) continue;
          let parsed: any;
          try {
            parsed = JSON.parse(chunk);
          } catch {
            continue;
          }
          const delta = parsed?.choices?.[0]?.delta;
          const piece: string | undefined = delta?.content;
          if (piece) {
            fullText += piece;
            enqueue("token", { t: piece });
          }
          const lpContent = parsed?.choices?.[0]?.logprobs?.content;
          if (Array.isArray(lpContent)) {
            sawLogprobs = true;
            for (const entry of lpContent) {
              if (typeof entry?.logprob === "number") {
                tokenLogprobs.push({ token: entry.token, logprob: entry.logprob });
              }
            }
          }
        }
      } catch (err) {
        enqueue("error", { error: err instanceof Error ? err.message : String(err) });
        controller.close();
        return;
      }

      const elapsed = (Date.now() - started) / 1000;
      const degraded = !sawLogprobs;
      // exp(mean logprob) over the GENERATED tokens. A sequence likelihood, not
      // conformal output, and named accordingly throughout.
      const sequenceLikelihood = sawLogprobs ? meanTop1Prob(tokenLogprobs) : heuristicConfidence(fullText);

      const categorizeResult = await categorizePromise;
      let conformalPrediction: ConformalPrediction;
      if (categorizeResult) {
        conformalPrediction = decide(categorizeResult, sequenceLikelihood, {
          degraded,
          degradedReason: degraded ? "logprobs_unavailable" : undefined,
        });
      } else {
        conformalPrediction = {
          primitive_type: "General_QA",
          sequence_likelihood: sequenceLikelihood,
          calibrated_confidence: sequenceLikelihood,
          target_coverage: TARGET_COVERAGE,
          quantile_q_hat: 0,
          prediction_set: [],
          abstain: true,
          abstain_reason: "CATEGORIZATION_UNAVAILABLE",
          degraded: true,
          degraded_reason: "categorization_call_failed",
        };
      }

      let confidentialProof = null;
      try {
        // The signature covers the conformal block and the calibration
        // commitment, not just the text, so a tampered confidence value or a
        // swapped threshold is detectable by the client.
        confidentialProof = await signResponse(fullText, conformalPrediction);
      } catch {
        confidentialProof = null;
      }

      enqueue("proof", { conformal_prediction: conformalPrediction, confidential_proof: confidentialProof });

      const tokenCount = tokenLogprobs.length || fullText.split(/\s+/).filter(Boolean).length;
      enqueue("done", {
        tokens: tokenCount,
        elapsed_seconds: Math.round(elapsed * 10) / 10,
        tokens_per_second: elapsed > 0 ? Math.round((tokenCount / elapsed) * 100) / 100 : null,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
