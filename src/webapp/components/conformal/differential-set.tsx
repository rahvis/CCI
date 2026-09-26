import { Check } from "lucide-react";
import type { ConformalPrediction } from "@/lib/chat/types";

export function DifferentialSet({ cp }: { cp: ConformalPrediction }) {
  const inSet = cp.prediction_set.filter((e) => e.in_set);
  return (
    <div className="mt-2 rounded-md border border-hairline bg-peach/40 p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
        Conformal prediction set C(x) · coverage {Math.round(cp.target_coverage * 100)}%
      </div>
      <ul className="mt-2 space-y-1.5">
        {cp.prediction_set.map((entry) => (
          <li
            key={entry.label}
            className={`flex items-center justify-between rounded-sm px-2 py-1 text-sm ${
              entry.in_set ? "bg-paper text-ink" : "text-muted/70"
            }`}
          >
            <span className="flex items-center gap-2">
              {entry.in_set ? (
                <Check className="h-3.5 w-3.5 text-verified-green" />
              ) : (
                <span className="h-3.5 w-3.5" />
              )}
              {entry.label}
            </span>
            <span className="flex items-center gap-2 font-mono text-xs">
              {(() => {
                const va = cp.venn_abers?.intervals.find((i) => i.label === entry.label);
                return va ? (
                  <span className="text-muted/80" title="Venn-Abers interval; its width reflects how much calibration data supports this score">
                    [{(va.p0 * 100).toFixed(0)}–{(va.p1 * 100).toFixed(0)}]
                  </span>
                ) : null;
              })()}
              <span>{(entry.probability * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-xs text-muted">
        Calibrated set size: {inSet.length} candidate{inSet.length === 1 ? "" : "s"} satisfy the 1−α bound.
        {cp.venn_abers && (
          <> Bracketed ranges are Venn-Abers intervals (n={cp.venn_abers.calibration_n}); a wide
          range means the calibration set says little about that score.</>
        )}
      </div>
    </div>
  );
}
