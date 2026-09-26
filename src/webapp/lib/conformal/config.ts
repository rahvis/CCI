import type { ConformalCategory } from "@/lib/chat/types";

export const VLLM_CHAT_URL = process.env.VLLM_CHAT_URL || "http://127.0.0.1:8000/v1/chat/completions";
export const VLLM_COMPLETIONS_URL =
  process.env.VLLM_COMPLETIONS_URL || "http://127.0.0.1:8000/v1/completions";
export const VLLM_MODEL = process.env.VLLM_MODEL || "gemma-1b";

// Live-verified against the deployed vLLM build (0.1.dev1+g3918f3c5a, CPU):
// streaming + logprobs/top_logprobs on /v1/chat/completions works as-is.
export const FEATURE_LOGPROBS_SUPPORTED = true;

// Live-verified: forcing a single choice via `structured_outputs.choice`
// collapses every candidate's reported logprob to ~0 (the FSM masks
// disallowed tokens and the softmax is renormalized over the one remaining
// path), which makes relative-likelihood comparison between candidates
// meaningless. Categorical scoring instead uses /v1/completions with
// echo+prompt_logprobs teacher-forcing (lib/conformal/categorize.ts), which
// reads genuine *unconstrained* log-likelihoods — no guided decoding needed
// for scoring at all. This flag now just gates whether the categorical
// prediction-set branch is enabled; kept as an explicit switch in case a
// future vLLM build breaks the /v1/completions echo path.

export const CATEGORIES: ConformalCategory[] = [
  "Direct Answer",
  "Needs Clarification",
  "Escalate — Outside Model's Reliable Scope",
];

// Standard split-conformal quantile: q_hat = the ceil((n+1)(1-alpha))-th
// smallest non-conformity score s_i = 1 - P_hat(true_category_i | x_i) over a
// hand-labeled calibration set. See scripts/calibrate.ts and
// calibration/prompts.jsonl.
//
// Run 2026-09-22 against the deployed gemma-1b/vLLM instance:
//   n = 150 (50 per category), alpha = 0.10, rank = ceil(151*0.9) = 136,
//   Q_HAT = 0.6580, fingerprint 2399d3ac...a999a80.
//
// Deliberately 90%, not the 99% in chatbotCC.md's mockups: a 99% coverage
// claim is not defensible from a calibration set of this size. See
// CALIBRATION.md.
//
// One consequence worth recording, because it is arithmetic rather than
// opinion. A category is in the set iff P_hat >= 1 - Q_HAT = 0.3420. Three
// probabilities summing to 1 can all clear that only if 3(1 - Q_HAT) <= 1,
// i.e. Q_HAT >= 2/3 = 0.6667. At 0.6580 the all-categories abstention branch
// in decide.ts is therefore still unreachable, but by only 0.0087. It was
// unreachable by 0.308 at the previous n=30 threshold of 0.5639.
export const TARGET_COVERAGE = 0.9;
export const Q_HAT = 0.6580;

// Fallback path, used only when FEATURE_LOGPROBS_SUPPORTED is false
// (heuristic, non-calibrated) — kept for robustness, not expected to
// trigger against the currently deployed vLLM build.
