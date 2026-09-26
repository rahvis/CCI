// Conformal p-values, e-values, and the session-level e-process.
//
// WHAT NULL IS BEING TESTED. This is the part that is easiest to state wrongly,
// so it is stated exactly. Let D = {(X_i, Y_i)} be the calibration pairs and
// s(x,y) = 1 - P_hat(y|x) the nonconformity score under the frozen model and
// fixed prompt template. For a query X and candidate category y:
//
//   H_0^(y): the augmented sequence ((X_1,Y_1), ..., (X_n,Y_n), (X, y))
//            is exchangeable.
//
// That is a CONJUNCTION the test cannot take apart: (a) y is the true category
// for X, and (b) (X, y) comes from the same distribution as the calibration
// pairs, meaning same query distribution, same labelling convention, same
// weights, same template, same decoding configuration.
//
// DIRECTION OF VALIDITY. A LARGE e-value is evidence AGAINST H_0. It says
// either the label is wrong or the query is out of distribution, and it cannot
// distinguish those two. It is an anomaly and escalation statistic. It is NOT a
// confidence score and NOT a "trust statistic" that rises as the model becomes
// more reliable. A small e-value is likewise not evidence FOR H_0; e-values do
// not accumulate support for a null.
//
// LABEL-FREE DEPLOYMENT. Validity needs the last pair to carry the true label,
// which production does not have. The resolution is exact. Since s(X,y) is
// minimized at y_hat(X) = argmax_y P_hat(y|X), and p is non-increasing in s, we
// get p(X, y_hat) = max_y p(X,y) >= p(X, Y). For any non-increasing calibrator
// f, therefore e(X, y_hat) <= f(p(X, Y)), so E[e(X, y_hat)] <= 1 under H_0.
// Evaluating at the model's own top-1 category is thus valid and label-free,
// conservative by exactly the top-1-versus-truth gap. Its meaning is what the
// product wants: a large value means even the best-supported category is
// unusually nonconforming, i.e. the query is out of scope. It is the
// continuous-valued sibling of the EMPTY_PREDICTION_SET abstention.
//
// CONDITIONING CAVEAT. E[e] <= 1 is over the joint draw of the calibration set
// and the test point. It is NOT conditional on the realized calibration set.
// Since the calibration set is authored once and frozen, the guarantee concerns
// hypothetical re-draws that will never happen. See the training-conditional
// Beta figures reported in the paper for how much spread that hides.
//
// References: Vovk & Wang, "E-values: calibration, combination and
// applications", Ann. Statist. 49(3), 2021; Ramdas, Grunwald, Vovk & Shafer,
// "Game-theoretic statistics and safe anytime-valid inference", Statist. Sci.
// 38(4), 2023.

export type CalibratorName = "kappa_power" | "mixture";

export interface CalibratorSpec {
  name: CalibratorName;
  /** Only for kappa_power. Must lie in (0,1). */
  kappa?: number;
}

export const DEFAULT_CALIBRATOR: CalibratorSpec = { name: "kappa_power", kappa: 0.5 };

/**
 * Conformal p-value, (#{i : s_i >= s} + 1) / (n + 1).
 *
 * `calScoresSorted` must be ascending. Achievable values are k/(n+1), so the
 * resolution floor is 1/(n+1); callers should surface that alongside the value
 * rather than leave readers to assume the scale is continuous.
 */
export function conformalPValue(calScoresSorted: readonly number[], s: number): number {
  const n = calScoresSorted.length;
  if (n === 0) return 1;

  // First index with value >= s, by binary search.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (calScoresSorted[mid] >= s) hi = mid;
    else lo = mid + 1;
  }
  const countGreaterEqual = n - lo;
  return (countGreaterEqual + 1) / (n + 1);
}

/**
 * Smoothed (randomized) conformal p-value: exactly uniform under
 * exchangeability rather than merely super-uniform, so E[e] = 1 exactly.
 *
 * NOT used in production. The same query must yield the same p-value, or the
 * signed audit trail stops meaning anything. The harness uses it under a fixed
 * seed so the paper can report how much conservativeness determinism costs.
 * `tau` is injected rather than drawn internally for exactly that reason.
 */
export function conformalPValueSmoothed(
  calScoresSorted: readonly number[],
  s: number,
  tau: number,
): number {
  const n = calScoresSorted.length;
  if (n === 0) return 1;
  let greater = 0;
  let equal = 0;
  for (const si of calScoresSorted) {
    if (si > s) greater++;
    else if (si === s) equal++;
  }
  return (greater + tau * (equal + 1)) / (n + 1);
}

/**
 * Calibrate a p-value into an e-value.
 *
 * kappa_power: e = kappa * p^(kappa-1), kappa in (0,1). Integrates to exactly 1
 * over [0,1] and is decreasing, so it is a calibrator, and it is admissible.
 *
 * mixture: f(p) = (1 - p + p ln p) / (p ln^2 p), which is the integral over
 * kappa of the family above, hence itself a calibrator, and parameter-free.
 *
 * NOT offered: the Vovk-Sellke maximum p-ratio, 1/(-e p ln p). It is the
 * pointwise supremum of the kappa family, i.e. the calibrator chosen with
 * hindsight, and its integral diverges, so it is NOT an e-value. It may be
 * reported as a maximum Bayes factor but must never be merged.
 */
export function calibrate(p: number, spec: CalibratorSpec = DEFAULT_CALIBRATOR): number {
  const pc = Math.min(1, Math.max(Number.MIN_VALUE, p));
  if (spec.name === "mixture") {
    if (pc >= 1) return 1;
    const lp = Math.log(pc);
    return (1 - pc + pc * lp) / (pc * lp * lp);
  }
  const kappa = spec.kappa ?? 0.5;
  if (!(kappa > 0 && kappa < 1)) {
    throw new Error(`kappa must lie in (0,1), got ${kappa}`);
  }
  return kappa * Math.pow(pc, kappa - 1);
}

/** The kappa maximizing the e-value attainable at the smallest possible p. */
export function optimalKappa(n: number): number {
  return -1 / Math.log(1 / (n + 1));
}

/**
 * Largest e-value any pre-specified calibrator can produce at calibration size
 * n, attained at p_min = 1/(n+1).
 *
 * This matters operationally and is easy to miss. At n = 30 the ceiling is
 * about 3.32, well under the Ville alarm threshold 1/alpha = 10 at alpha = 0.10,
 * so a mean-merged session e-process CANNOT fire however anomalous the traffic.
 * Every surface that displays an e-value should display this beside it.
 */
export function maxAttainableEValue(n: number, spec?: CalibratorSpec): number {
  const pMin = 1 / (n + 1);
  const s: CalibratorSpec = spec ?? { name: "kappa_power", kappa: optimalKappa(n) };
  return calibrate(pMin, s);
}

/** Smallest calibration size at which a mean-merged alarm at `alpha` is reachable. */
export function minCalibrationSizeForAlarm(alpha: number): number {
  const target = 1 / alpha;
  for (let n = 2; n <= 100000; n++) {
    if (maxAttainableEValue(n) >= target) return n;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Merge e-values by arithmetic mean.
 *
 * Valid under ARBITRARY DEPENDENCE by linearity of expectation alone, which is
 * why it is the only merger shipped here: with a shared frozen calibration set
 * the per-turn e-values are dependent through that set, and nothing stronger
 * applies. Vovk & Wang show the arithmetic mean is essentially admissible among
 * symmetric mergers under arbitrary dependence, so there is nothing to gain
 * from a more elaborate rule.
 *
 * Two things this requires saying correctly. The merged object is an e-value
 * for the INTERSECTION null, so a large value means at least one turn is
 * anomalous and never identifies which. And it is valid at any FIXED t;
 * checking after every turn and stopping when it looks large is optional
 * stopping, which linearity does not cover.
 *
 * Optional weights must be PREDICTABLE, i.e. a function of turn index or the
 * past only. Weighting by how alarming a turn turned out to be breaks validity.
 */
export function mergeMean(es: readonly number[], weights?: readonly number[]): number {
  if (es.length === 0) return 1;
  if (!weights) return es.reduce((a, b) => a + b, 0) / es.length;
  if (weights.length !== es.length) {
    throw new Error("weights length must match e-values length");
  }
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0) throw new Error("weights must sum to a positive value");
  return es.reduce((acc, e, i) => acc + (weights[i] / wsum) * e, 0);
}

/**
 * Running product, in log space.
 *
 * DIAGNOSTIC ONLY. This is NOT a valid test martingale in this system. The
 * product needs independence, or the adapted condition E[e_t | F_{t-1}] <= 1.
 * With a fixed shared calibration set the e-values are dependent through it and
 * F_{t-1} carries information about it, so the condition fails. Separately,
 * turns within one conversation are plainly not exchangeable with independent
 * single-shot calibration prompts, nor with each other, so an alarm here would
 * fire on conversational structure rather than model failure.
 *
 * Kept because the harness measures its false-alarm rate, which turns "the
 * product is not valid here" from an assertion into a measurement.
 */
export function mergeProductLog(es: readonly number[]): number {
  return es.reduce((acc, e) => acc + Math.log(Math.max(Number.MIN_VALUE, e)), 0);
}

export interface SessionEProcess {
  version: 1;
  /** Reset the process if this changes: an E accumulated across two different
   *  calibration bases is meaningless. */
  calibrationFingerprint: string;
  turns: number;
  sumE: number;
  /** The valid statistic. */
  meanE: number;
  /** Always carried alongside meanE so the scale is never misread. */
  maxAttainableE: number;
  logProdE: number;
  /** Ville bounds the SUPREMUM over t, so a process that crossed and fell back
   *  has still rejected. Storing only the current value would lose that. */
  maxLogProdE: number;
  perTurnE: number[];
  alarmAlpha: number;
  alarmFired: boolean;
  merger: "arithmetic_mean";
  validUnder: "arbitrary_dependence";
  resetReason?: string;
}

export function newSessionEProcess(
  calibrationFingerprint: string,
  n: number,
  alarmAlpha = 0.1,
): SessionEProcess {
  return {
    version: 1,
    calibrationFingerprint,
    turns: 0,
    sumE: 0,
    meanE: 0,
    maxAttainableE: maxAttainableEValue(n),
    logProdE: 0,
    maxLogProdE: 0,
    perTurnE: [],
    alarmAlpha,
    alarmFired: false,
    merger: "arithmetic_mean",
    validUnder: "arbitrary_dependence",
  };
}

export function advanceSessionEProcess(
  prev: SessionEProcess | undefined,
  e: number,
  calibrationFingerprint: string,
  n: number,
  alarmAlpha = 0.1,
): SessionEProcess {
  let state = prev;
  let resetReason: string | undefined;
  if (!state || state.calibrationFingerprint !== calibrationFingerprint) {
    resetReason = state ? "calibration_fingerprint_changed" : undefined;
    state = newSessionEProcess(calibrationFingerprint, n, alarmAlpha);
  }

  const turns = state.turns + 1;
  const sumE = state.sumE + e;
  const meanE = sumE / turns;
  const logProdE = state.logProdE + Math.log(Math.max(Number.MIN_VALUE, e));

  return {
    ...state,
    turns,
    sumE,
    meanE,
    logProdE,
    maxLogProdE: Math.max(state.maxLogProdE, logProdE),
    perTurnE: [...state.perTurnE, e],
    alarmFired: state.alarmFired || meanE >= 1 / alarmAlpha,
    resetReason,
  };
}
