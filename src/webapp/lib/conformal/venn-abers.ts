// Inductive Venn-Abers Predictors (IVAP) and the isotonic regression they are
// built on.
//
// Venn-Abers answers a different question from the conformal layer in
// decide.ts. Conformal prediction asks "which categories belong in the set at
// level alpha"; Venn-Abers asks "what probability should we attach to this
// category, and how much does the calibration data actually pin that down".
// Its output is an interval [p0, p1] rather than a point, and the WIDTH of that
// interval is the signal worth reporting: it is wide exactly where the
// calibration set has little to say.
//
// Reference: Vovk & Petej, "Venn-Abers Predictors", UAI 2014; Vovk, Petej &
// Fedorova, "Large-scale probabilistic predictors with and without guarantees
// of validity", NIPS 2015. The isotonic machinery is the Pool-Adjacent-
// Violators Algorithm of Ayer et al. (Ann. Math. Statist., 1955).

export interface IsotonicPoint {
  x: number;
  y: number;
  /** Observation weight. Defaults to 1. Used by tie pre-aggregation. */
  w?: number;
}

export interface IsotonicBlock {
  sumW: number;
  sumWY: number;
  minX: number;
  maxX: number;
}

export interface IsotonicFit {
  /** Blocks in ascending x, with strictly increasing means. */
  blocks: IsotonicBlock[];
}

export function blockMean(b: IsotonicBlock): number {
  return b.sumWY / b.sumW;
}

/**
 * Pool-Adjacent-Violators. O(m) after the sort.
 *
 * Two details here are correctness issues rather than polish.
 *
 * First, points sharing an x MUST be aggregated before the merge loop. Feeding
 * [(x,0),(x,1)] to PAVA unaggregated reads as non-decreasing, so the pair never
 * merges and g(x) ends up two-valued, which is not a function. This is also the
 * semantics IVAP wants when a test score coincides exactly with a calibration
 * score: the test point folds into that calibration point.
 *
 * Second, the merge test is `<=` with no floating-point epsilon. Merging
 * equal-mean neighbours changes no fitted value but yields the canonical
 * coarsest block decomposition, which is what makes `blockWeight` and
 * `blocks.length` deterministic and hardware-independent. An epsilon would make
 * the reported diagnostics depend on the machine.
 */
export function fitIsotonic(points: IsotonicPoint[]): IsotonicFit {
  if (points.length === 0) return { blocks: [] };

  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Tie pre-aggregation.
  const aggregated: IsotonicBlock[] = [];
  for (const p of sorted) {
    const w = p.w ?? 1;
    const last = aggregated[aggregated.length - 1];
    if (last !== undefined && last.minX === p.x) {
      last.sumW += w;
      last.sumWY += w * p.y;
    } else {
      aggregated.push({ sumW: w, sumWY: w * p.y, minX: p.x, maxX: p.x });
    }
  }

  const stack: IsotonicBlock[] = [];
  for (const point of aggregated) {
    stack.push({ ...point });
    while (stack.length >= 2) {
      const top = stack[stack.length - 1];
      const below = stack[stack.length - 2];
      if (blockMean(top) > blockMean(below)) break;
      stack.pop();
      stack.pop();
      stack.push({
        sumW: below.sumW + top.sumW,
        sumWY: below.sumWY + top.sumWY,
        minX: below.minX,
        maxX: top.maxX,
      });
    }
  }

  return { blocks: stack };
}

export interface IsotonicEval {
  value: number;
  /** Total weight of the block the query fell in. Drives the interval width. */
  blockWeight: number;
}

/**
 * Evaluate a fit at x. Constant extrapolation outside the fitted range; for x
 * falling in a gap between blocks, the last block with minX <= x wins
 * (left-constant). The gap case cannot arise for p0/p1, because IVAP always
 * evaluates at a point it has just inserted, but it does arise when the harness
 * applies a fixed calibrator to held-out points, so the convention is fixed
 * here and disclosed rather than left to chance.
 */
export function evalIsotonic(fit: IsotonicFit, x: number): IsotonicEval {
  const { blocks } = fit;
  if (blocks.length === 0) return { value: 0, blockWeight: 0 };

  if (x <= blocks[0].maxX) {
    return { value: blockMean(blocks[0]), blockWeight: blocks[0].sumW };
  }

  let chosen = blocks[0];
  for (const b of blocks) {
    if (b.minX <= x) chosen = b;
    else break;
  }
  return { value: blockMean(chosen), blockWeight: chosen.sumW };
}

export interface VennAbersCalibrationPoint {
  /** The score. See the note in the module docstring of decide.ts on why this
   *  is P-hat(y|x) rather than the raw length-normalized logprob. */
  s: number;
  /** One-vs-rest outcome: 1 if this category was the true one, else 0. */
  z: 0 | 1;
}

export interface VennAbersResult {
  p0: number;
  p1: number;
  width: number;
  /** Minimax-log-loss point summary. Carries NO validity guarantee: see below. */
  point: number;
  /** Weight of the containing block in the g1 fit. Small weight, wide interval. */
  blockWeight: number;
  /** Number of blocks in the g1 fit. Two or three means the calibrator is
   *  nearly constant and carries almost no query-specific information. */
  blocks: number;
}

/**
 * Inductive Venn-Abers Predictor for one binary (one-vs-rest) problem.
 *
 * Fits isotonic regression twice against the calibration set augmented with the
 * test point: once assuming its label is 0, once assuming 1. The resulting
 * [p0, p1] brackets the probability, and p0 <= p1 always, because isotonic
 * regression is monotone in the response vector. We assert that rather than
 * trust it: a violation means a tie-handling or merge-condition bug.
 */
export function ivap(
  cal: readonly VennAbersCalibrationPoint[],
  sStar: number,
): VennAbersResult {
  const base: IsotonicPoint[] = cal.map((c) => ({ x: c.s, y: c.z }));

  const fit0 = fitIsotonic([...base, { x: sStar, y: 0 }]);
  const fit1 = fitIsotonic([...base, { x: sStar, y: 1 }]);

  const e0 = evalIsotonic(fit0, sStar);
  const e1 = evalIsotonic(fit1, sStar);

  const p0 = e0.value;
  const p1 = e1.value;

  if (p0 > p1 + 1e-12) {
    throw new Error(
      `IVAP invariant violated: p0=${p0} > p1=${p1} at s*=${sStar}. ` +
        "This indicates a PAVA tie-handling or merge-condition bug.",
    );
  }

  const denom = 1 - p0 + p1;
  return {
    p0,
    p1,
    width: p1 - p0,
    point: denom === 0 ? 0.5 : p1 / denom,
    blockWeight: e1.blockWeight,
    blocks: fit1.blocks.length,
  };
}

/**
 * Cross Venn-Abers over k folds, merged by arithmetic mean.
 *
 * IMPORTANT: CVAP has NO validity theorem. Vovk, Petej & Fedorova say so
 * explicitly. It is an empirical variance-reduction heuristic. Production emits
 * plain `ivap`; this exists so the evaluation harness can report both, and any
 * text describing CVAP output must not claim the Venn guarantee.
 *
 * k defaults to the calibration size, i.e. leave-one-out, which uses the most
 * data per fold and involves no fold-seed randomness, so results are
 * bit-reproducible.
 */
export function cvap(
  cal: readonly VennAbersCalibrationPoint[],
  sStar: number,
  k: number = cal.length,
): VennAbersResult & { folds: { p0: number; p1: number }[] } {
  const folds: { p0: number; p1: number }[] = [];
  const effectiveK = Math.max(1, Math.min(k, cal.length));

  for (let f = 0; f < effectiveK; f++) {
    const subset = cal.filter((_, i) => i % effectiveK !== f);
    if (subset.length === 0) continue;
    const r = ivap(subset, sStar);
    folds.push({ p0: r.p0, p1: r.p1 });
  }

  if (folds.length === 0) {
    const r = ivap(cal, sStar);
    return { ...r, folds: [{ p0: r.p0, p1: r.p1 }] };
  }

  const p0 = folds.reduce((a, f) => a + f.p0, 0) / folds.length;
  const p1 = folds.reduce((a, f) => a + f.p1, 0) / folds.length;
  const denom = 1 - p0 + p1;

  const full = ivap(cal, sStar);
  return {
    p0,
    p1,
    width: p1 - p0,
    point: denom === 0 ? 0.5 : p1 / denom,
    blockWeight: full.blockWeight,
    blocks: full.blocks,
    folds,
  };
}

/**
 * Turn per-category one-vs-rest intervals into a point distribution.
 *
 * The form quoted in much of the literature, p_y = p1_y / sum_y'(1 - p0 + p1),
 * does NOT sum to one for more than two classes: its total is
 * sum(p1) / sum(1 - p0 + p1), which equals 1 only when every p0 is 1. The
 * correct construction takes each class's binary regularized point and then
 * normalizes, which reduces to the familiar expression when K = 2.
 *
 * This output is a convenience summary and NOT Venn-calibrated. The Venn
 * guarantee attaches to the multiprobabilistic [p0, p1] output; collapsing to a
 * point discards it. It can also flip the argmax relative to raw softmax, since
 * each class has its own isotonic fit. Callers that care about validity should
 * read the intervals.
 */
export function normalizeMulticlass(results: readonly VennAbersResult[]): number[] {
  const q = results.map((r) => r.point);
  const total = q.reduce((a, b) => a + b, 0);
  if (total === 0) return q.map(() => 1 / Math.max(1, q.length));
  return q.map((v) => v / total);
}
