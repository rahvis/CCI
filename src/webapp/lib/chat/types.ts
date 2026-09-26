// Shared types for the chat protocol. This is a deliberately small,
// hand-authored shape (not the Vercel AI SDK's UIMessage protocol) — see
// lib/sse.ts for why a custom SSE frame set was chosen.

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  // Present only on assistant messages that completed successfully.
  conformalPrediction?: ConformalPrediction;
  confidentialProof?: ConfidentialProof;
  // Present only on assistant messages that errored before completing.
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Running session-level e-process. Optional: sessions persisted before this
   *  existed must still load. */
  eProcess?: import("@/lib/conformal/evalue").SessionEProcess;
}

export type ConformalCategory =
  | "Direct Answer"
  | "Needs Clarification"
  | "Escalate — Outside Model's Reliable Scope";

export interface PredictionSetEntry {
  label: ConformalCategory;
  probability: number;
  in_set: boolean;
}

/** Venn-Abers interval for one category. The WIDTH is the signal: it is wide
 *  exactly where the calibration set has little to say about this score. */
export interface VennAbersInterval {
  label: ConformalCategory;
  p0: number;
  p1: number;
  width: number;
  /** Convenience point summary. NOT Venn-calibrated: collapsing the interval
   *  discards the guarantee, which attaches to the interval itself. */
  point: number;
}

export interface VennAbersBlock {
  /** "ivap" in production. Cross-Venn-Abers has no validity theorem and is
   *  used only by the evaluation harness. */
  method: "ivap";
  score_input: "softmax_phat";
  intervals: VennAbersInterval[];
  calibration_n: number;
}

export interface EValueBlock {
  /** Conformal p-value at the model's own top-1 category: the only label-free
   *  choice, and provably still a valid e-value. */
  p_value: number;
  /** Resolution floor, 1/(n+1). Surfaced so the scale is not misread. */
  p_min: number;
  e_value: number;
  /** Largest value any pre-specified calibrator can reach at this n. Always
   *  displayed alongside e_value. */
  e_max_attainable: number;
  calibrator: string;
  /** A LARGE e-value is evidence AGAINST exchangeability, meaning the label is
   *  wrong or the query is out of distribution. It is an anomaly statistic, not
   *  a confidence score. */
  interpretation: "large_value_is_evidence_against_exchangeability";
}

export interface ConformalPrediction {
  primitive_type: string;
  /** exp(mean logprob) over the GENERATED tokens. This is a sequence
   *  likelihood, not conformal output. Named accordingly: the old
   *  `calibrated_confidence` asserted something untrue. */
  sequence_likelihood: number;
  /** @deprecated Retained so messages persisted by older clients still render.
   *  Same value as sequence_likelihood. */
  calibrated_confidence?: number;
  target_coverage: number;
  quantile_q_hat: number;
  prediction_set: PredictionSetEntry[];
  abstain: boolean;
  abstain_reason: string | null;
  degraded: boolean;
  degraded_reason?: string;
  /** Optional: absent on messages persisted before these were added. */
  venn_abers?: VennAbersBlock;
  e_value?: EValueBlock;
}

export interface ConfidentialProof {
  hardware_tee: string;
  cloud_provider: string;
  maa_jwt: string;
  maa_verified: boolean;
  enclave_pubkey: string;
  signature: string;
  timestamp: number;
  /** Commitment to the calibration set, prompt template, category set and
   *  alpha. Bound into the attestation nonce, so a verifier can check that the
   *  threshold behind a coverage claim came from the published calibration set
   *  rather than one chosen after the fact. */
  calibration_fingerprint?: string;
  /** What the signature actually covers. Older deployments signed the response
   *  text alone; the current one covers the conformal block too. */
  signed_payload?: "response_text" | "response_text+conformal+fingerprint";
}

export interface ChatRequestBody {
  message: string;
  history: { role: ChatRole; content: string }[];
}
