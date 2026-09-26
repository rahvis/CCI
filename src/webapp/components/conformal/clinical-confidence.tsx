import type { ConformalPrediction } from "@/lib/chat/types";

export function ClinicalConfidence({ cp }: { cp: ConformalPrediction }) {
  const pct = Math.round((cp.sequence_likelihood ?? cp.calibrated_confidence ?? 0) * 1000) / 10;
  // The winning category's Venn-Abers interval. Its width is the signal worth
  // showing: wide means the calibration set has little to say about this score.
  const winner = cp.prediction_set.reduce(
    (b, c) => (c.probability > b.probability ? c : b),
    cp.prediction_set[0],
  );
  const va = cp.venn_abers?.intervals.find((i) => i.label === winner?.label);
  return (
    <div className="mt-2 rounded-md border border-hairline bg-mint/40 p-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-muted">
        <span>Conformal calibration · {Math.round(cp.target_coverage * 100)}% target coverage</span>
        {cp.degraded && <span className="text-verified-yellow">degraded</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-hairline/60">
          <div
            className="h-full rounded-full bg-teal transition-[width]"
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          />
        </div>
        <span className="text-sm font-medium text-ink">{pct.toFixed(1)}%</span>
      </div>
      {va && (
        <div className="mt-2 border-t border-hairline pt-2 text-xs text-ink">
          <span className="font-medium">Venn-Abers calibrated</span>{" "}
          <span className="text-muted">({va.label}):</span>{" "}
          <span className="font-mono">
            {(va.p0 * 100).toFixed(1)}–{(va.p1 * 100).toFixed(1)}%
          </span>{" "}
          <span className="text-muted">
            (width {(va.width * 100).toFixed(1)} pts, n={cp.venn_abers!.calibration_n})
          </span>
        </div>
      )}
      {cp.e_value && (
        <div className="mt-1 text-xs text-muted">
          e-value{" "}
          <span className="font-mono text-ink">{cp.e_value.e_value.toFixed(2)}</span> of{" "}
          <span className="font-mono">{cp.e_value.e_max_attainable.toFixed(2)}</span> max ·
          large values indicate the query is unlike the calibration set
        </div>
      )}
      <div className="mt-1 text-xs text-muted">
        Sequence likelihood (not conformal-calibrated) · Inference engine: vLLM
      </div>
    </div>
  );
}
