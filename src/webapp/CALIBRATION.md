# Conformal calibration, Venn-Abers, and e-values: honest scope

## What is calibrated

`Q_HAT` in `lib/conformal/config.ts` comes from `scripts/calibrate.ts`, run
against the live vLLM instance over `calibration/prompts.jsonl`: **n=150
hand-authored examples, 50 per category**, at **alpha=0.10 (90% target
coverage)**.

**Run 2026-09-22 against the deployed `gemma-1b`/vLLM instance:**
n=150, alpha=0.10, rank=ceil(151*0.9)=136, **Q_HAT=0.6580**,
**CALIBRATION_FINGERPRINT=2399d3ac624333ff5619c1b567ba0de32a85b86003774b6eba9a24476a999a80**.

The first 30 prompts are the original hand-authored set, kept in place so that
run stays reproducible; the remaining 120 are small-business scenarios. The set
is synthetic and carries no claim to represent real traffic.

## Why n=150 and not n=30

Not a tuning preference. Achievable conformal p-values are `k/(n+1)`, so the
smallest is `1/(n+1)`, and over the calibrator family `e = kappa*p^(kappa-1)`
the largest attainable e-value at calibration size n is therefore capped. At
n=30 that cap is **3.32**, below the Ville alarm threshold `1/alpha = 10`. Since
the arithmetic mean is the only merging rule valid under this system's
dependence structure, and a mean of quantities bounded by 3.32 is bounded by
3.32, **a session e-process at n=30 cannot fire on any input whatsoever**.

Attainability requires n >= 132 at alpha=0.10, 312 at 0.05, 2076 at 0.01. At
n=150 the ceiling is 11.07.

The calibrator matters too. The conventional `kappa = 0.5` gives a ceiling of
only 6.14 at n=150, still below the alarm. `decide.ts` therefore ships
`kappa* = -1/ln(1/(n+1)) = 0.1993`, which maximises the attainable value. kappa
depends only on n, fixed in advance, so this is pre-specified rather than
data-dependent.

## What the numbers mean, and what they do not

- **`sequence_likelihood`** is `exp(mean logprob)` over the *generated* tokens.
  It is a sequence-likelihood statistic and **not** conformal output. It was
  previously named `calibrated_confidence`, which asserted something untrue; the
  old field is retained as a deprecated alias so persisted sessions still render.
- **Coverage is a property of the procedure, not of any one response.** Split
  conformal coverage is marginal over the joint draw of calibration set and test
  point. Conditional on this calibration draw it is Beta(136,15): mean 0.9007,
  sd 0.0243, and probability 0.460 of falling below the 90% target.
- **A large e-value is evidence AGAINST exchangeability**, meaning the label is
  wrong or the query is out of distribution, and it cannot separate the two. It
  is an anomaly statistic, not a confidence score. Every surface showing an
  e-value also shows its attainable ceiling.
- **Venn-Abers intervals are the guarantee-bearing output**; the normalised
  point summary is a convenience with no validity theorem. Production emits the
  inductive predictor (IVAP). Cross Venn-Abers has no validity theorem and is
  used only by the evaluation harness.

## Arithmetic worth knowing

A category is in the set iff `P_hat >= 1 - Q_HAT = 0.3420`. Three probabilities
summing to 1 can all clear that only if `Q_HAT >= 2/3 = 0.6667`. At 0.6580 the
`PREDICTION_SET_COVERS_ALL_CATEGORIES` branch is unreachable, but by only
0.0087; it was unreachable by 0.308 at the previous threshold of 0.5639. The
evaluation harness verifies the count is zero rather than assuming it.

## Recalibrating

```bash
ssh -N -L 8000:127.0.0.1:8000 azureuser@<host>          # reach vLLM
VLLM_COMPLETIONS_URL=http://127.0.0.1:8000/v1/completions \
  npm run calibrate -- --emit-scores                     # prints Q_HAT + module
npm run evaluate                                         # pure analysis, no network
npm run selftest                                         # statistical invariants
```

Paste the printed `Q_HAT` into `lib/conformal/config.ts` and the printed module
body into `lib/conformal/calibration-scores.ts`. Both are deliberate manual
steps, not something recomputed silently at request time.

**Regenerating the calibration artifact changes `CALIBRATION_FINGERPRINT`, which
is bound into the attestation nonce.** That is the point: a verifier who holds
the published calibration set can recompute the commitment and detect a
substituted one. It also means the deployment must be restarted after
recalibration, so the attestation token is reissued over the new commitment.
