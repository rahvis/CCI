"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { ProofModal } from "@/components/confidential/proof-modal";
import { verifyMessage, type VerificationResult } from "@/lib/crypto/verify-attestation";
import type { ConfidentialProof, ConformalPrediction } from "@/lib/chat/types";

const TONE = {
  green: {
    Icon: ShieldCheck,
    classes: "bg-verified-green-bg text-verified-green",
    label: "AMD SEV-SNP | Enclave Verified",
  },
  yellow: {
    Icon: ShieldAlert,
    classes: "bg-verified-yellow-bg text-verified-yellow",
    label: "Unverified Host / Standard Compute",
  },
  red: {
    Icon: ShieldOff,
    classes: "bg-verified-red-bg text-verified-red",
    label: "No Proof Available",
  },
} as const;

export function HipaaEnclaveBadge({
  content,
  proof,
  conformal,
}: {
  content: string;
  proof: ConfidentialProof | null;
  conformal?: ConformalPrediction;
}) {
  const [verification, setVerification] = useState<VerificationResult>({
    state: "red",
    signatureValid: false,
    sessionVerified: false,
  });

  useEffect(() => {
    let cancelled = false;
    verifyMessage(content, proof, conformal).then((v) => {
      if (!cancelled) setVerification(v);
    });
    return () => {
      cancelled = true;
    };
  }, [content, proof, conformal]);

  const tone = TONE[verification.state];
  const Icon = tone.Icon;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${tone.classes}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {tone.label}
        </button>
      </DialogTrigger>
      <ProofModal proof={proof} verification={verification} />
    </Dialog>
  );
}
