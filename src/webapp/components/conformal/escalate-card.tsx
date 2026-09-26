import { AlertTriangle } from "lucide-react";
import type { ConformalPrediction } from "@/lib/chat/types";

const REASON_COPY: Record<string, string> = {
  EMPTY_PREDICTION_SET: "No category met the calibrated confidence bound for this query.",
  PREDICTION_SET_COVERS_ALL_CATEGORIES:
    "All categories fell within the calibrated bound — this query gives no discriminative signal.",
  CATEGORIZATION_UNAVAILABLE: "The categorization step could not be completed for this query.",
};

export function EscalateCard({ cp }: { cp: ConformalPrediction }) {
  const pct = Math.round((cp.sequence_likelihood ?? cp.calibrated_confidence ?? 0) * 1000) / 10;
  return (
    <div className="mt-2 rounded-md border border-verified-red/30 bg-verified-red-bg p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-verified-red">
        <AlertTriangle className="h-4 w-4" />
        I don&apos;t know — this falls outside my calibrated confidence bound
      </div>
      <p className="mt-1.5 text-sm text-ink">
        {cp.abstain_reason ? REASON_COPY[cp.abstain_reason] ?? cp.abstain_reason : "Confidence too low to answer reliably."}
      </p>
      <div className="mt-2 text-xs text-muted">
        Calibrated confidence: {pct.toFixed(1)}% (target: {Math.round(cp.target_coverage * 100)}%) · Reason:{" "}
        {cp.abstain_reason ?? "UNKNOWN"}
      </div>
    </div>
  );
}
