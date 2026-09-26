import { CATEGORIES, VLLM_COMPLETIONS_URL, VLLM_MODEL } from "@/lib/conformal/config";
import type { ConformalCategory } from "@/lib/chat/types";

// Scores each of the 3 fixed categories by genuine, UNCONSTRAINED
// teacher-forcing: append the category label as literal text after a fixed
// classification prompt, ask vLLM's legacy /v1/completions endpoint to
// echo the prompt back with per-token logprobs (`echo:true, max_tokens:0`),
// and read the label's own token log-probabilities straight from
// `prompt_logprobs`/`logprobs.token_logprobs`.
//
// This deliberately avoids vLLM's `structured_outputs.choice` guided
// decoding for SCORING: live-verified on this VM, forcing a single choice
// masks disallowed tokens and renormalizes softmax over the one remaining
// path, so every forced candidate reports ~0 logprob (~100% "confidence")
// regardless of the model's true relative preference — useless for
// comparing candidates. Teacher-forcing each candidate independently and
// reading its natural (unmasked) log-likelihood is the standard technique
// for scoring fixed multiple-choice candidates against a causal LM.
//
// Because candidates have different token lengths ("Escalate…" vs "Needs
// Clarification"), each candidate's score is its *average* per-token
// log-probability (not the raw sum), avoiding a length bias toward shorter
// labels, then the 3 averaged scores are softmax-normalized against each
// other to produce genuine relative probabilities that sum to 1.

/** Identifies the exact classification template below. Part of the
 *  calibration fingerprint: changing the template invalidates the calibration
 *  set, and a verifier must be able to see that. Bump on any edit. */
export const CLASSIFICATION_PROMPT_ID = "intent-3way/v1";

function buildPrompt(userMessage: string): string {
  return (
    "Classify the user's query below into exactly one intent category: " +
    '"Direct Answer", "Needs Clarification", or "Escalate — Outside Model\'s Reliable Scope".\n\n' +
    `User query: ${userMessage}\n\n` +
    "Intent category:"
  );
}

interface CompletionsLogprobs {
  tokens: string[];
  token_logprobs: (number | null)[];
  text_offset: number[];
}

async function scoreCandidate(prefix: string, category: ConformalCategory): Promise<number> {
  const label = ` ${category}`;
  const fullPrompt = prefix + label;
  const labelStartChar = prefix.length;

  const resp = await fetch(VLLM_COMPLETIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VLLM_MODEL,
      prompt: fullPrompt,
      max_tokens: 0,
      echo: true,
      logprobs: 1,
    }),
  });
  if (!resp.ok) {
    throw new Error(`vLLM /v1/completions ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const logprobs: CompletionsLogprobs = data.choices[0].logprobs;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < logprobs.tokens.length; i++) {
    const offset = logprobs.text_offset[i];
    const lp = logprobs.token_logprobs[i];
    if (offset >= labelStartChar && lp !== null) {
      sum += lp;
      count++;
    }
  }
  if (count === 0) return -Infinity;
  return sum / count; // length-normalized average log-probability
}

export interface CategorizeResult {
  scores: { label: ConformalCategory; probability: number }[];
  winner: ConformalCategory;
  /** Raw length-normalized mean log-probability per category, before the
   *  softmax. Kept so the calibration artifact can record the pre-softmax
   *  scores and the evaluation harness can run the "feed IVAP ell instead of
   *  P-hat" ablation. Not used on the request hot path. */
  meanLogprobs: number[];
}

export async function categorizeResponse(userMessage: string): Promise<CategorizeResult> {
  const prefix = buildPrompt(userMessage);
  const avgLogprobs = await Promise.all(CATEGORIES.map((c) => scoreCandidate(prefix, c)));

  // Numerically-stable softmax over the averaged per-token log-probabilities.
  const maxScore = Math.max(...avgLogprobs);
  const exps = avgLogprobs.map((s) => Math.exp(s - maxScore));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probabilities = exps.map((e) => e / sumExps);

  const scores = CATEGORIES.map((label, i) => ({ label, probability: probabilities[i] }));
  const winner = scores.reduce((best, cur) => (cur.probability > best.probability ? cur : best)).label;
  return { scores, winner, meanLogprobs: avgLogprobs };
}
