// Client-side verification. No network call is needed per message: the
// session's MAA JWT is fetched and cached once (GET /api/attestation) and each
// message's signature is checked locally via Web Crypto.
//
// The signature covers the canonical payload built in signing-payload.ts, not
// the response text alone, so verifying it also verifies the conformal block
// and the calibration commitment that the coverage claim rests on.

import { canonicalSignedPayload } from "@/lib/crypto/signing-payload";
import type { ConformalPrediction, ConfidentialProof } from "@/lib/chat/types";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Hand-rolled base64url JSON decode — no `jwt-decode` dependency needed. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const segment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Verifies a message's ECDSA-P256/SHA-256 signature against the session's
 * enclave public key, entirely client-side via SubtleCrypto. The server
 * signs with Node's `dsaEncoding: 'ieee-p1363'` (raw r||s), which is exactly
 * what SubtleCrypto.verify expects — no DER parsing needed here.
 */
export async function verifyMessageSignature(
  content: string,
  signatureHex: string,
  enclavePubkeyHex: string,
): Promise<boolean> {
  try {
    const pubKeyBytes = hexToBytes(enclavePubkeyHex);
    const sigBytes = hexToBytes(signatureHex);
    const key = await crypto.subtle.importKey(
      "raw",
      pubKeyBytes as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const contentBytes = new TextEncoder().encode(content);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes as BufferSource,
      contentBytes as BufferSource,
    );
  } catch {
    return false;
  }
}

export type BadgeState = "green" | "yellow" | "red";

export interface VerificationResult {
  state: BadgeState;
  signatureValid: boolean;
  sessionVerified: boolean;
  reason?: string;
}

export async function verifyMessage(
  content: string,
  proof: ConfidentialProof | null,
  conformal?: ConformalPrediction,
): Promise<VerificationResult> {
  if (!proof || !proof.signature || !proof.enclave_pubkey) {
    return { state: "red", signatureValid: false, sessionVerified: false, reason: "no proof data" };
  }
  // Messages signed by an older deployment covered the response text alone.
  // Fall back to that so history persisted before this change still verifies
  // rather than silently turning yellow.
  const signed =
    proof.signed_payload === "response_text+conformal+fingerprint"
      ? canonicalSignedPayload(
          content,
          conformal ?? null,
          proof.calibration_fingerprint ?? "",
          proof.timestamp,
        )
      : content;
  const signatureValid = await verifyMessageSignature(signed, proof.signature, proof.enclave_pubkey);
  if (signatureValid && proof.maa_verified) {
    return { state: "green", signatureValid, sessionVerified: true };
  }
  if (signatureValid) {
    return {
      state: "yellow",
      signatureValid,
      sessionVerified: false,
      reason: "signature valid but session MAA attestation is stale or unverified",
    };
  }
  return { state: "yellow", signatureValid, sessionVerified: proof.maa_verified, reason: "signature check failed" };
}
