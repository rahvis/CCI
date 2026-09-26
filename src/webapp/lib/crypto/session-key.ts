// Confidential inference proof chain: a single ephemeral ECDSA P-256
// keypair is generated once per server process. Its public key hash is
// bound into an MAA attestation JWT via the guest-attestation CLI's `-n`
// nonce flag (the ONLY input-binding mechanism it exposes — see the honesty
// note below), and every chat response is signed with the private key so a
// client can verify, per message, with zero extra network round-trips.
//
// IMPORTANT / honest scoping: the attestation CLI's `-n <nonce>` flag does
// NOT write into the SEV-SNP hardware REPORT_DATA field. Verified live
// against this VM: the nonce ends up base64-encoded at
// payload["x-ms-runtime"]["client-payload"]["nonce"], while
// payload["x-ms-sevsnpvm-reportdata"] is a fixed value unrelated to the
// nonce we pass. So this proves "the JWT and this session's key were issued
// together via MAA's client-payload channel" — not "the hardware quote's
// own REPORT_DATA commits to this key". The UI must say exactly that.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import type { ConformalPrediction } from "@/lib/chat/types";
import {
  canonicalSignedPayload,
  sessionCommitmentInput,
  SIGNED_PAYLOAD_VERSION,
} from "@/lib/crypto/signing-payload";
import { CALIBRATION_FINGERPRINT, CALIBRATION_ALPHA, CLASSIFICATION_PROMPT_ID } from "@/lib/conformal/calibration-scores";
import { createRemoteJWKSet, jwtVerify } from "jose";

const execFileAsync = promisify(execFile);

const ATTESTATION_BIN = process.env.ATTESTATION_BIN || "/usr/local/bin/AttestationClient";
const MAA_ENDPOINT = process.env.MAA_ENDPOINT || "https://sharedeus2.eus2.attest.azure.net";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // force refresh if <5min from expiry

interface AttestationSnapshot {
  jwt: string | null;
  verified: boolean;
  verificationError: string | null;
  decodedPayload: Record<string, unknown> | null;
  claimedNonceMatches: boolean;
  fetchedAt: number | null;
  expiresAt: number | null;
  /** true only when running without a real attestation binary (local dev) */
  isLocalDevPlaceholder: boolean;
}

interface SessionKeyState {
  privateKey: KeyObject;
  publicKeyHex: string; // 65-byte uncompressed point, 130 hex chars
  publicKeyHashHex: string; // sha256(uncompressed point), 64 hex chars
  /** sha256 over the key AND the statistical preconditions of the coverage
   *  guarantee. This, not the bare key hash, is what goes into the nonce. */
  sessionCommitmentHex: string;
  attestation: AttestationSnapshot;
  initPromise: Promise<void> | null;
  refreshTimer: NodeJS.Timeout | null;
}

// A module-level singleton. Next.js's instrumentation `register()` hook
// calls initSessionKey() once at boot; this file also lazily self-inits as
// a defensive fallback so no request path can ever see an uninitialized
// state, even if register() hasn't been wired up in some environment.
const globalForSessionKey = globalThis as unknown as { __cciSessionKey?: SessionKeyState };

function base64UrlDecodeJson(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function uncompressedPointHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const toFixed32 = (b64url: string) => {
    const buf = Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (buf.length === 32) return buf;
    const padded = Buffer.alloc(32);
    buf.copy(padded, 32 - buf.length);
    return padded;
  };
  const x = toFixed32(jwk.x);
  const y = toFixed32(jwk.y);
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString("hex");
}

function initState(): SessionKeyState {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyHex = uncompressedPointHex(publicKey);
  const publicKeyHashHex = createHash("sha256").update(Buffer.from(publicKeyHex, "hex")).digest("hex");
  const sessionCommitmentHex = createHash("sha256")
    .update(
      sessionCommitmentInput(
        publicKeyHex,
        CALIBRATION_FINGERPRINT,
        CALIBRATION_ALPHA,
        CLASSIFICATION_PROMPT_ID,
      ),
    )
    .digest("hex");
  return {
    privateKey,
    publicKeyHex,
    publicKeyHashHex,
    sessionCommitmentHex,
    attestation: {
      jwt: null,
      verified: false,
      verificationError: "not yet fetched",
      decodedPayload: null,
      claimedNonceMatches: false,
      fetchedAt: null,
      expiresAt: null,
      isLocalDevPlaceholder: false,
    },
    initPromise: null,
    refreshTimer: null,
  };
}

function getState(): SessionKeyState {
  if (!globalForSessionKey.__cciSessionKey) {
    globalForSessionKey.__cciSessionKey = initState();
  }
  return globalForSessionKey.__cciSessionKey;
}

async function fetchAttestation(): Promise<void> {
  const state = getState();
  try {
    const { stdout } = await execFileAsync(
      ATTESTATION_BIN,
      ["-a", MAA_ENDPOINT, "-n", state.sessionCommitmentHex, "-o", "token"],
      { timeout: 60_000 },
    );
    const jwt = stdout.trim();
    const parts = jwt.split(".");
    if (parts.length !== 3) throw new Error("unexpected attestation client output shape");
    const decodedPayload = base64UrlDecodeJson(parts[1]);

    const runtime = decodedPayload["x-ms-runtime"] as
      | { "client-payload"?: { nonce?: string } }
      | undefined;
    const rawNonceClaim = runtime?.["client-payload"]?.nonce ?? "";
    const decodedNonce = Buffer.from(rawNonceClaim, "base64").toString("utf8");
    const claimedNonceMatches = decodedNonce === state.sessionCommitmentHex;

    let verified = false;
    let verificationError: string | null = null;
    try {
      const issuer = decodedPayload.iss as string;
      const jwks = createRemoteJWKSet(new URL(`${issuer}/certs`));
      await jwtVerify(jwt, jwks);
      verified = true;
    } catch (err) {
      verificationError = err instanceof Error ? err.message : String(err);
    }

    state.attestation = {
      jwt,
      verified: verified && claimedNonceMatches,
      verificationError: verified ? (claimedNonceMatches ? null : "nonce/client-payload mismatch") : verificationError,
      decodedPayload,
      claimedNonceMatches,
      fetchedAt: Date.now(),
      expiresAt: typeof decodedPayload.exp === "number" ? decodedPayload.exp * 1000 : null,
      isLocalDevPlaceholder: false,
    };
  } catch (err) {
    // No real TEE (local dev, or the binary/tpm isn't reachable) — never
    // fabricate a "verified" state. Badge logic must treat this as
    // unverified/yellow-or-red, never green.
    state.attestation = {
      jwt: null,
      verified: false,
      verificationError: err instanceof Error ? err.message : String(err),
      decodedPayload: null,
      claimedNonceMatches: false,
      fetchedAt: Date.now(),
      expiresAt: null,
      // Keyed off the binary's actual presence, not NODE_ENV: `next start`
      // always reports NODE_ENV=production regardless of which host it's
      // running on, so that wouldn't reliably distinguish "no real TEE here"
      // (a local dev machine) from a genuine, otherwise-broken VM deploy.
      isLocalDevPlaceholder: !existsSync(ATTESTATION_BIN),
    };
  }
}

export async function initSessionKey(): Promise<void> {
  const state = getState();
  if (!state.initPromise) {
    state.initPromise = fetchAttestation();
  }
  await state.initPromise;
  if (!state.refreshTimer) {
    state.refreshTimer = setInterval(() => {
      fetchAttestation().catch(() => {});
    }, REFRESH_INTERVAL_MS);
    state.refreshTimer.unref?.();
  }
}

async function ensureFreshAttestation(): Promise<void> {
  const state = getState();
  await initSessionKey();
  const { expiresAt } = state.attestation;
  if (expiresAt !== null && Date.now() > expiresAt - REFRESH_MARGIN_MS) {
    await fetchAttestation();
  }
}

export async function getAttestationSnapshot(): Promise<AttestationSnapshot & { enclavePubkeyHex: string }> {
  await ensureFreshAttestation();
  const state = getState();
  return { ...state.attestation, enclavePubkeyHex: state.publicKeyHex };
}

export interface SignedProof {
  hardware_tee: string;
  cloud_provider: string;
  maa_jwt: string;
  maa_verified: boolean;
  enclave_pubkey: string;
  signature: string;
  timestamp: number;
  calibration_fingerprint: string;
  signed_payload: typeof SIGNED_PAYLOAD_VERSION;
}

/**
 * Sign a response together with its conformal block and the calibration
 * commitment, not the response text alone. A tampered confidence value or a
 * swapped threshold is then detectable, which is what the accompanying coverage
 * claim needs in order to mean anything to a third party.
 */
export async function signResponse(
  responseText: string,
  conformal: ConformalPrediction | null = null,
): Promise<SignedProof> {
  await ensureFreshAttestation();
  const state = getState();
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = canonicalSignedPayload(
    responseText,
    conformal,
    CALIBRATION_FINGERPRINT,
    timestamp,
  );
  const signature = cryptoSign("sha256", Buffer.from(payload, "utf8"), {
    key: state.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("hex");
  return {
    hardware_tee: "AMD SEV-SNP",
    cloud_provider: "Azure Confidential VM",
    maa_jwt: state.attestation.jwt ?? "",
    maa_verified: state.attestation.verified,
    enclave_pubkey: state.publicKeyHex,
    signature,
    timestamp,
    calibration_fingerprint: CALIBRATION_FINGERPRINT,
    signed_payload: SIGNED_PAYLOAD_VERSION,
  };
}
