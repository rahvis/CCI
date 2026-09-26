// The exact bytes the enclave signs, and the exact bytes committed to in the
// attestation nonce. Shared by the server (which produces them) and the browser
// (which re-derives them to verify), so the two can never drift apart.
//
// Why this exists at all: a signature over the response text alone proves the
// text came from the attested process, but says nothing about which calibration
// set produced the threshold behind the accompanying confidence claim. A
// provider could swap, subset or post-hoc select the calibration data and every
// signature would still verify. Binding the calibration commitment is what
// makes the coverage claim falsifiable by the verifier rather than merely
// asserted by the server.

import type { ConformalPrediction } from "@/lib/chat/types";

export const SIGNED_PAYLOAD_VERSION = "response_text+conformal+fingerprint" as const;

/**
 * Canonical, stable serialization. Field order is fixed explicitly rather than
 * left to object-literal order, and floats are rendered at fixed precision, so
 * the same logical response always produces the same bytes on both sides.
 */
export function canonicalSignedPayload(
  responseText: string,
  conformal: ConformalPrediction | null,
  calibrationFingerprint: string,
  timestamp: number,
): string {
  const c = conformal
    ? {
        q: conformal.quantile_q_hat.toFixed(10),
        t: conformal.target_coverage.toFixed(10),
        a: conformal.abstain,
        r: conformal.abstain_reason,
        s: conformal.prediction_set.map((e) => ({
          l: e.label,
          p: e.probability.toFixed(10),
          i: e.in_set,
        })),
        e: conformal.e_value ? conformal.e_value.e_value.toFixed(10) : null,
      }
    : null;

  return JSON.stringify({
    v: SIGNED_PAYLOAD_VERSION,
    text: responseText,
    conformal: c,
    fingerprint: calibrationFingerprint,
    ts: timestamp,
  });
}

/**
 * What the attestation nonce commits to: the session key AND the statistical
 * preconditions of the coverage guarantee. A verifier recomputes this from the
 * published calibration artifact and checks it against the nonce carried in the
 * MAA token.
 */
export function sessionCommitmentInput(
  publicKeyHex: string,
  calibrationFingerprint: string,
  alpha: number,
  promptTemplateId: string,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      pk: publicKeyHex,
      fingerprint: calibrationFingerprint,
      alpha: alpha.toFixed(10),
      prompt_template_id: promptTemplateId,
    }),
    "utf8",
  );
}
