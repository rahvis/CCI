# CCI — Conformal Confidential Inference 

Source mirror of the chatbot deployed on `cci-gemma-vm` (Azure Confidential VM,
AMD SEV-SNP), currently reachable at **https://20.127.95.200** (self-signed
cert — see below).

https://github.com/user-attachments/assets/3e1dac31-3e37-4bb4-a988-23db230860c0

## Layout

- **`webapp/`** — the Next.js 15 App Router app (TypeScript, Tailwind). This
  is the whole chatbot: the chat UI, the vLLM proxy, the conformal-prediction
  engine (split conformal, Venn-Abers, e-values), and the confidential-inference
  proof chain. See `webapp/CALIBRATION.md` for the calibration methodology and
  its honest scope and limits.

### The statistical layer

| File | What it does |
| --- | --- |
| `lib/conformal/categorize.ts` | teacher-forced scoring of the three response modes against vLLM |
| `lib/conformal/decide.ts` | prediction set, abstention, Venn-Abers interval, e-value |
| `lib/conformal/venn-abers.ts` | PAVA isotonic regression and the inductive Venn-Abers predictor |
| `lib/conformal/evalue.ts` | conformal p-values, calibrators, merging, session e-process |
| `lib/conformal/stats.ts` | incomplete beta, Clopper-Pearson, training-conditional coverage |
| `lib/conformal/calibration-scores.ts` | **generated** committed calibration matrix and its fingerprint |
| `scripts/calibrate.ts` | offline calibration; `--emit-scores` regenerates the module above |
| `scripts/evaluate.ts` | evaluation harness; `--collect` hits vLLM, `--analyze` is pure |
| `scripts/selftest.ts` | statistical invariants, including `E[e] <= 1` under the null |

### What the attestation commits to

The attestation nonce is `sha256(pubkey || calibration_fingerprint || alpha ||
prompt_template_id)`, not just the public key, and the per-response signature
covers the response text, the conformal block and the fingerprint rather than
the text alone. A verifier holding the published calibration set can therefore
recompute the commitment, match it against the nonce inside the MAA token, and
detect a substituted calibration set. `lib/crypto/signing-payload.ts` holds the
canonical byte encoding, shared by server and browser so the two cannot drift.

Recalibrating changes the fingerprint and therefore the nonce, so the service
must be restarted after recalibration for the token to be reissued.
- **`tls-proxy/`** — a small (~50 line, dependency-free) Node TLS-terminating
  reverse proxy in front of the Next.js app.

## Why there's a TLS proxy

The VM has no domain name, only a bare IP, so there's no path to a CA-issued
certificate. But the confidential-inference UI's client-side signature
verification uses Web Crypto (`crypto.subtle`), which browsers restrict to
"secure contexts" (HTTPS, or `localhost`) — plain HTTP to an IP address does
not qualify. `tls-proxy/server.js` terminates a self-signed TLS connection on
:443 and proxies (including SSE streaming, unbuffered) to the Next.js app on
`127.0.0.1:3000`; :80 just 301-redirects to :443. Visitors see a one-time
browser certificate warning, which is expected for a self-signed cert.

## Deployed topology on the VM

Three systemd services:

| Service | What | Port |
|---|---|---|
| `vllm.service` | vLLM serving `gemma-1b` (float32, CPU-only — no AVX512 on this SKU) | `127.0.0.1:8000` |
| `cci-webapp.service` | This Next.js app (`node server.js`, standalone build) | `127.0.0.1:3000` |
| `cci-tls-proxy.service` | The TLS proxy | `0.0.0.0:443`, `:80` (redirect) |

The VM also has a 4GB swapfile and `OOMScoreAdjust=-900` on `vllm.service`
(vLLM is memory-resident at ~10.7GB of the VM's 14GB RAM with very little
headroom — this protects it from being OOM-killed by anything else running
on the box, at the cost of making the webapp/proxy the preferred kill target
instead).

## Building and deploying

```bash
cd webapp
npm install
npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
rsync -avz --delete .next/standalone/ azureuser@20.127.95.200:/opt/cci/webapp/
```

Then on the VM: `sudo systemctl restart cci-webapp.service`.

`tls-proxy/` and the systemd unit files aren't rebuilt — they only change if
the proxy script itself changes; redeploy by rsyncing `tls-proxy/` to
`/opt/cci/tls-proxy/` and restarting `cci-tls-proxy.service`.

## Recalibrating the conformal prediction thresholds

See `webapp/CALIBRATION.md`. In short: edit `webapp/calibration/prompts.jsonl`,
run `npm run calibrate` against a reachable vLLM instance, and hand-paste the
printed `Q_HAT` into `webapp/lib/conformal/config.ts`.
