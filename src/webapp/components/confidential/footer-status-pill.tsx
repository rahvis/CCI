"use client";

import { useEffect, useState } from "react";

interface AttestationStatus {
  verified: boolean;
  enclave_pubkey: string;
  is_local_dev_placeholder: boolean;
}

export function FooterStatusPill({ eProcess }: { eProcess?: { turns: number; meanE: number; maxAttainableE: number; alarmFired: boolean } }) {
  const [status, setStatus] = useState<AttestationStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const resp = await fetch("/api/attestation");
        const data = await resp.json();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!status) {
    return <span className="text-xs text-muted">Checking enclave session…</span>;
  }

  const keyPrefix = status.enclave_pubkey ? status.enclave_pubkey.slice(2, 10) : "————————";

  // The e-value is always shown against its attainable ceiling. Quoting one
  // without the other invites reading the scale as unbounded, when in fact the
  // calibration size caps it (see lib/conformal/evalue.ts).
  const eSuffix = eProcess && eProcess.turns > 0 ? (
    <span className={eProcess.alarmFired ? "text-verified-red" : "text-muted"}>
      {" · E="}
      {eProcess.meanE.toFixed(2)}/{eProcess.maxAttainableE.toFixed(2)} max over {eProcess.turns} turn
      {eProcess.turns === 1 ? "" : "s"}
    </span>
  ) : null;

  if (status.verified) {
    return (
      <span className="text-xs text-verified-green">
        🟢 MAA Session Active | Enclave Key Bound: 0x{keyPrefix}…{eSuffix}
      </span>
    );
  }
  if (status.is_local_dev_placeholder) {
    return <span className="text-xs text-verified-yellow">🟡 Local dev — no real attestation available</span>;
  }
  return <span className="text-xs text-verified-red">🔴 MAA Session Unverified</span>;
}
