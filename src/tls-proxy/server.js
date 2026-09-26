// Minimal, dependency-free TLS-terminating reverse proxy.
//
// Why this exists: the app is reachable only at a bare IP (no domain), so
// there's no path to a CA-trusted certificate. But the confidential-inference
// UI's whole point is a REAL, independent, client-side signature check via
// Web Crypto (`crypto.subtle`) — and browsers restrict `crypto.subtle` (and
// `crypto.randomUUID`) to "secure contexts" (HTTPS, or localhost). Plain
// HTTP to an IP address does not qualify, so without TLS the verification
// feature would silently be unavailable in every browser.
//
// A self-signed cert plus this tiny proxy is the smallest fix that actually
// satisfies that browser requirement: the page is treated as a secure
// context once the visitor accepts the (expected, since there's no CA-issued
// cert for a bare IP) certificate warning. No nginx: this is ~40 lines of
// Node core modules, transparently streaming (including SSE, unbuffered) to
// the Next.js app on 127.0.0.1:3000.
const https = require("node:https");
const http = require("node:http");
const fs = require("node:fs");

const TLS_DIR = process.env.TLS_DIR || "/opt/cci/tls";
const BACKEND_HOST = process.env.BACKEND_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);

const tlsOptions = {
  key: fs.readFileSync(`${TLS_DIR}/key.pem`),
  cert: fs.readFileSync(`${TLS_DIR}/cert.pem`),
};

function proxy(req, res) {
  const proxyReq = http.request(
    { host: BACKEND_HOST, port: BACKEND_PORT, path: req.url, method: req.method, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Bad gateway: ${err.message}`);
  });
  req.pipe(proxyReq, { end: true });
}

https.createServer(tlsOptions, proxy).listen(HTTPS_PORT, "0.0.0.0", () => {
  console.log(`TLS proxy listening on :${HTTPS_PORT} -> ${BACKEND_HOST}:${BACKEND_PORT}`);
});

// Plain HTTP just redirects to HTTPS so http://<ip> still gets somewhere
// useful instead of hanging or connection-refusing.
http
  .createServer((req, res) => {
    const host = (req.headers.host || "").split(":")[0];
    res.writeHead(301, { Location: `https://${host}${req.url || "/"}` });
    res.end();
  })
  .listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`HTTP -> HTTPS redirect listening on :${HTTP_PORT}`);
  });
