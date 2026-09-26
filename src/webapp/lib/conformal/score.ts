export interface TokenLogprob {
  token: string;
  logprob: number;
}

/**
 * Real, response-level confidence: exp(mean(logprob)) over the tokens the
 * model actually generated in the streamed response, straight from vLLM's
 * own logprobs — not a fabricated number.
 */
export function meanTop1Prob(tokens: TokenLogprob[]): number {
  if (tokens.length === 0) return 0;
  const meanLogprob = tokens.reduce((sum, t) => sum + t.logprob, 0) / tokens.length;
  return Math.exp(meanLogprob);
}

/**
 * Degraded fallback confidence proxy, used only if FEATURE_LOGPROBS_SUPPORTED
 * is ever flipped to false (e.g. a future vLLM build drops logprob support).
 * Not calibrated — the API always marks payloads using this as `degraded`.
 */
export function heuristicConfidence(responseText: string): number {
  const words = responseText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const uniqueRatio = new Set(words.map((w) => w.toLowerCase())).size / words.length;
  const lengthFactor = Math.min(1, words.length / 15);
  return Math.max(0, Math.min(1, uniqueRatio * 0.7 + lengthFactor * 0.3));
}
