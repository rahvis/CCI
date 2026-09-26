export const runtime = "nodejs";

import { getAttestationSnapshot } from "@/lib/crypto/session-key";
import {
  CALIBRATION_FINGERPRINT,
  CALIBRATION_ALPHA,
  CALIBRATION_N,
  CLASSIFICATION_PROMPT_ID,
} from "@/lib/conformal/calibration-scores";

// Never triggers a fresh attestation subprocess call — always returns the
// process-level cache (refreshed at boot, every 6h, or reactively if near
// expiry; see lib/crypto/session-key.ts). Fast, safe to poll from the UI's
// footer status pill.
export async function GET() {
  const snapshot = await getAttestationSnapshot();
  return Response.json({
    verified: snapshot.verified,
    verification_error: snapshot.verificationError,
    enclave_pubkey: snapshot.enclavePubkeyHex,
    fetched_at: snapshot.fetchedAt,
    expires_at: snapshot.expiresAt,
    is_local_dev_placeholder: snapshot.isLocalDevPlaceholder,
    decoded_payload: snapshot.decodedPayload,
    // Everything a third party needs to recompute the nonce for themselves.
    // The commitment is sha256 over a canonical JSON object of these fields,
    // see lib/crypto/signing-payload.ts sessionCommitmentInput().
    calibration_commitment: {
      calibration_fingerprint: CALIBRATION_FINGERPRINT,
      alpha: CALIBRATION_ALPHA,
      n: CALIBRATION_N,
      prompt_template_id: CLASSIFICATION_PROMPT_ID,
    },
    // Honesty note surfaced directly in the API so no client can accidentally
    // misrepresent what this proves.
    note:
      "The nonce commits to the session public key AND the statistical preconditions " +
      "of the coverage guarantee (calibration fingerprint, alpha, prompt template id). " +
      "It is carried via the attestation CLI's -n flag, landing in the MAA client-payload " +
      "claim (x-ms-runtime.client-payload.nonce), NOT the SEV-SNP hardware REPORT_DATA " +
      "field, which commits to the host compatibility layer's runtime data instead.",
  });
}
