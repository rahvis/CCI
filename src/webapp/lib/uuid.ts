// Plain Math.random()-based UUID v4. Deliberately not `crypto.randomUUID()`:
// that (like `crypto.subtle`) is restricted to secure contexts (HTTPS or
// localhost), and this only needs a locally-unique client-side id, not
// cryptographic randomness.
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
