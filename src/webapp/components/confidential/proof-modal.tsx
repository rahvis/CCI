"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { decodeJwtPayload, type VerificationResult } from "@/lib/crypto/verify-attestation";
import type { ConfidentialProof } from "@/lib/chat/types";

function Row({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-hairline py-2 last:border-0">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="break-all text-sm text-ink">{value}</span>
    </div>
  );
}

export function ProofModal({
  proof,
  verification,
}: {
  proof: ConfidentialProof | null;
  verification: VerificationResult;
}) {
  const [copied, setCopied] = useState(false);
  const claims = proof?.maa_jwt ? decodeJwtPayload(proof.maa_jwt) : null;
  const tee = (claims?.["x-ms-isolation-tee"] ?? {}) as Record<string, unknown>;

  const copyProof = async () => {
    if (!proof) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(proof, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API can be unavailable (e.g. insecure context) — non-fatal
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>🛡️ Confidential Inference Verification</DialogTitle>
        <DialogDescription>
          Hardware attestation and message-signature proof for this specific response.
        </DialogDescription>
      </DialogHeader>

      {!proof ? (
        <p className="text-sm text-muted">No proof data was returned with this message.</p>
      ) : (
        <div className="space-y-0">
          <Row label="Hardware TEE" value={proof.hardware_tee} />
          <Row label="Cloud provider" value={proof.cloud_provider} />
          <Row
            label="Attestation status"
            value={proof.maa_verified ? "Valid — signed JWT verified against Azure MAA JWKS" : "Unverified"}
          />
          <Row label="Enclave public key (session)" value={proof.enclave_pubkey} />
          <Row label="Message signature (ECDSA P-256 / SHA-256)" value={proof.signature} />
          {proof.calibration_fingerprint && (
            <Row label="Calibration commitment" value={proof.calibration_fingerprint} />
          )}
          {proof.signed_payload && (
            <Row
              label="Signature covers"
              value={
                proof.signed_payload === "response_text+conformal+fingerprint"
                  ? "response text + conformal block + calibration commitment"
                  : "response text only (signed by an earlier deployment)"
              }
            />
          )}
          <Row
            label="Signature check (this browser, Web Crypto)"
            value={verification.signatureValid ? "✅ Verified" : "❌ Failed"}
          />
          {tee && Object.keys(tee).length > 0 && (
            <Row
              label="SEV-SNP claims"
              value={
                <span className="font-mono text-xs">
                  is-debuggable: {String(tee["x-ms-sevsnpvm-is-debuggable"])}
                  {", "}
                  compliance-status: {String(tee["x-ms-compliance-status"])}
                </span>
              }
            />
          )}
        </div>
      )}

      <div className="mt-4 rounded-md bg-lavender/50 p-3 text-xs leading-relaxed text-muted">
        <strong className="text-ink">What this does and doesn&apos;t prove.</strong> The attestation
        nonce commits to the session public key <em>and</em> to the statistical preconditions of the
        coverage guarantee: the calibration commitment above, the level alpha, and the prompt template
        identifier. So a verifier can recompute the commitment from the published calibration set and
        check that the threshold behind the confidence claim came from that set rather than one chosen
        after the fact.
        <br />
        <br />
        That commitment travels as MAA <em>client-payload</em> metadata alongside the hardware
        attestation, which is the attestation CLI&apos;s only input-binding option. It is not embedded
        in the SEV-SNP hardware REPORT_DATA field, which commits to the host compatibility layer&apos;s
        own runtime data instead. So this proves the JWT, this session&apos;s signing key and this
        calibration set were issued together, and that this message, its conformal block and that
        commitment were signed by that key. It does not mean the hardware quote&apos;s own REPORT_DATA
        commits to any of them.
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="outline" size="sm" onClick={copyProof} disabled={!proof}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy full proof JSON"}
        </Button>
      </div>
    </DialogContent>
  );
}
