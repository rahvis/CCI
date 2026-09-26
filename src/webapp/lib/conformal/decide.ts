import { CATEGORIES, Q_HAT, TARGET_COVERAGE } from "@/lib/conformal/config";
import type { CategorizeResult } from "@/lib/conformal/categorize";
import type {
  ConformalPrediction,
  PredictionSetEntry,
  VennAbersBlock,
  EValueBlock,
} from "@/lib/chat/types";
import { ivap, type VennAbersCalibrationPoint } from "@/lib/conformal/venn-abers";
import {
  conformalPValue,
  calibrate,
  maxAttainableEValue,
  optimalKappa,
  type CalibratorSpec,
} from "@/lib/conformal/evalue";

// The calibrator is kappa* = -1/ln(1/(n+1)), which maximises the attainable
// e-value at this calibration size. kappa depends only on n, which is fixed in
// advance, so this is a pre-specified calibrator and not a data-dependent
// choice. It matters operationally: the conventional kappa = 0.5 has a ceiling
// of only 6.14 at n = 150, below the Ville alarm threshold of 10 at
// alpha = 0.10, so a session monitor built on it could never fire. See the
// attainability bound in lib/conformal/evalue.ts.
const SHIPPED_CALIBRATOR: CalibratorSpec = {
  name: "kappa_power",
  kappa: optimalKappa(CALIBRATION_N),
};
import {
  CALIBRATION_SCORES,
  CALIBRATION_N,
  CALIBRATION_SORTED_TRUE_SCORES,
  CALIBRATION_ONE_VS_REST,
} from "@/lib/conformal/calibration-scores";

/**
 * Real Adaptive Prediction Set (APS) math: non-conformity score
 * s(x,y) = 1 - P_hat(y|x); category y is in the prediction set C(x) iff
 * s(x,y) <= q_hat (equivalently P_hat(y|x) >= 1 - q_hat). q_hat is the
 * offline-calibrated split-conformal quantile from scripts/calibrate.ts.
 *
 * Decision rule:
 *  - |C(x)| == 1                     -> single high-confidence answer
 *  - 1 < |C(x)| < CATEGORIES.length  -> differential/multi-candidate set
 *  - |C(x)| == 0                     -> abstain, EMPTY_PREDICTION_SET
 *  - |C(x)| == CATEGORIES.length     -> abstain, PREDICTION_SET_COVERS_ALL_CATEGORIES
 *
 * Note on that last branch: with K normalized probabilities summing to 1, it is
 * reachable only when 1 - q_hat <= 1/K. At larger q_hat it is unreachable
 * arithmetic rather than dead code, and the evaluation harness verifies which
 * regime the deployed threshold is in rather than leaving it to assumption.
 *
 * Venn-Abers and the e-value are computed from the in-memory calibration score
 * matrix and cost no extra vLLM call, so they add no inference latency.
 */
export function decide(
  categorize: CategorizeResult,
  sequenceLikelihood: number,
  opts: { degraded?: boolean; degradedReason?: string } = {},
): ConformalPrediction {
  const prediction_set: PredictionSetEntry[] = categorize.scores.map(({ label, probability }) => ({
    label,
    probability,
    in_set: 1 - probability <= Q_HAT,
  }));

  const inSetCount = prediction_set.filter((e) => e.in_set).length;

  let abstain = false;
  let abstain_reason: string | null = null;
  if (inSetCount === 0) {
    abstain = true;
    abstain_reason = "EMPTY_PREDICTION_SET";
  } else if (inSetCount === CATEGORIES.length) {
    abstain = true;
    abstain_reason = "PREDICTION_SET_COVERS_ALL_CATEGORIES";
  }

  let venn_abers: VennAbersBlock | undefined;
  let e_value: EValueBlock | undefined;

  if (CALIBRATION_SCORES.length > 0) {
    venn_abers = {
      method: "ivap",
      score_input: "softmax_phat",
      calibration_n: CALIBRATION_N,
      intervals: CATEGORIES.map((label, k) => {
        const cal = CALIBRATION_ONE_VS_REST[k] as VennAbersCalibrationPoint[];
        const r = ivap(cal, categorize.scores[k].probability);
        return { label, p0: r.p0, p1: r.p1, width: r.width, point: r.point };
      }),
    };

    // Evaluated at the model's own top-1 category. That is the only label-free
    // option in production, and it remains a valid e-value because the top-1
    // p-value dominates the true-label p-value and the calibrator is
    // non-increasing.
    const top1 = categorize.scores.reduce((b, c) => (c.probability > b.probability ? c : b));
    const p = conformalPValue(CALIBRATION_SORTED_TRUE_SCORES, 1 - top1.probability);
    e_value = {
      p_value: p,
      p_min: 1 / (CALIBRATION_N + 1),
      e_value: calibrate(p, SHIPPED_CALIBRATOR),
      e_max_attainable: maxAttainableEValue(CALIBRATION_N, SHIPPED_CALIBRATOR),
      calibrator: `kappa_power(${SHIPPED_CALIBRATOR.kappa!.toFixed(4)})`,
      interpretation: "large_value_is_evidence_against_exchangeability",
    };
  }

  return {
    primitive_type: "General_QA",
    sequence_likelihood: sequenceLikelihood,
    calibrated_confidence: sequenceLikelihood,
    target_coverage: TARGET_COVERAGE,
    quantile_q_hat: Q_HAT,
    prediction_set,
    abstain,
    abstain_reason,
    degraded: opts.degraded ?? false,
    degraded_reason: opts.degradedReason,
    venn_abers,
    e_value,
  };
}
