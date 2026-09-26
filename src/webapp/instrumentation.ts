// Next.js 15's stable instrumentation hook: register() runs once when the
// server process starts, before it begins serving requests. Used here to
// generate the session's ECDSA keypair and fetch the first MAA attestation
// JWT up front, so the per-message hot path (`/api/chat`) never pays that
// cost — see lib/crypto/session-key.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initSessionKey } = await import("./lib/crypto/session-key");
    await initSessionKey();
  }
}
