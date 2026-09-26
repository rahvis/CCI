import base64
import json
import subprocess
import time

import httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

VLLM_URL = "http://127.0.0.1:8000/v1/chat/completions"
ATTESTATION_BIN = "/usr/local/bin/AttestationClient"
MAX_TOKENS = 256

# This CVM has no AVX512, so vLLM runs Gemma in float32 at roughly 4 tok/s.
# A full answer therefore takes minutes - every hop below must stream rather
# than wait for a complete response, and no read timeout may be imposed.
STREAM_TIMEOUT = httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)

app = FastAPI()


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


def _b64url_decode(segment: str) -> dict:
    padded = segment + "=" * (-len(segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/", response_class=HTMLResponse)
def index():
    return HTML_PAGE


@app.get("/health")
async def health():
    """Reports whether the vLLM engine behind this UI is up and which model it serves."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("http://127.0.0.1:8000/v1/models")
        resp.raise_for_status()
        return {"vllm": "up", "models": [m["id"] for m in resp.json().get("data", [])]}
    except Exception as exc:
        return JSONResponse({"vllm": "down", "error": str(exc)}, status_code=503)


@app.post("/chat")
async def chat(req: ChatRequest):
    messages = req.history + [{"role": "user", "content": req.message}]
    payload = {
        "model": "gemma-1b",
        "messages": messages,
        "max_tokens": MAX_TOKENS,
        "stream": True,
    }

    async def token_stream():
        started = time.time()
        tokens = 0
        try:
            async with httpx.AsyncClient(timeout=STREAM_TIMEOUT) as client:
                async with client.stream("POST", VLLM_URL, json=payload) as resp:
                    if resp.status_code != 200:
                        body = (await resp.aread()).decode(errors="replace")
                        yield _sse("error", {"error": f"vLLM returned {resp.status_code}: {body[:500]}"})
                        return
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        chunk = line[6:].strip()
                        if chunk == "[DONE]":
                            break
                        delta = json.loads(chunk)["choices"][0].get("delta", {})
                        piece = delta.get("content")
                        if piece:
                            tokens += 1
                            yield _sse("token", {"t": piece})
        except Exception as exc:
            yield _sse("error", {"error": f"{type(exc).__name__}: {exc}"})
            return
        elapsed = time.time() - started
        yield _sse("done", {
            "tokens": tokens,
            "elapsed_seconds": round(elapsed, 1),
            "tokens_per_second": round(tokens / elapsed, 2) if elapsed else None,
        })

    return StreamingResponse(
        token_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/attestation")
def attestation():
    """Runs the Azure guest-attestation client fresh on every call and returns
    the Microsoft Azure Attestation (MAA) signed JWT proving this process is
    executing inside an AMD SEV-SNP confidential VM, plus its decoded claims."""
    started = time.time()
    try:
        result = subprocess.run(
            [ATTESTATION_BIN, "-o", "token"],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)

    token = result.stdout.strip()
    parts = token.split(".")
    if len(parts) != 3:
        return JSONResponse({"error": "unexpected attestation output", "raw": token}, status_code=500)

    header = _b64url_decode(parts[0])
    payload = _b64url_decode(parts[1])
    tee = payload.get("x-ms-isolation-tee", {})

    return {
        "jwt": token,
        "issuer": payload.get("iss"),
        "header": header,
        "confidential_computing_proof": {
            "attestation_type": tee.get("x-ms-attestation-type"),
            "compliance_status": tee.get("x-ms-compliance-status"),
            "launch_measurement": tee.get("x-ms-sevsnpvm-launchmeasurement"),
            "idkeydigest": tee.get("x-ms-sevsnpvm-idkeydigest"),
            "vm_is_debuggable": tee.get("x-ms-sevsnpvm-is-debuggable"),
            "secure_boot": payload.get("secureboot"),
            "vm_id": payload.get("x-ms-azurevm-vmid"),
        },
        "full_payload": payload,
        "elapsed_seconds": round(time.time() - started, 2),
    }


HTML_PAGE = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Gemma-1B on Azure Confidential VM</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 760px; margin: 40px auto; background:#0b0e14; color:#e6e6e6; }
  h1 { font-size: 20px; }
  #log { border: 1px solid #333; border-radius: 8px; padding: 16px; height: 420px; overflow-y: auto; background:#11151c; }
  .msg { margin: 8px 0; padding: 8px 12px; border-radius: 8px; white-space: pre-wrap; }
  .user { background:#1f2b3d; text-align:right; }
  .bot { background:#1a2418; }
  .err { background:#3d1f1f; }
  .meta { font-size: 11px; color:#8a8a8a; margin: 2px 0 10px 12px; }
  #row { display:flex; gap:8px; margin-top: 12px; }
  #input { flex:1; padding:10px; border-radius:6px; border:1px solid #333; background:#11151c; color:#eee; }
  button { padding:10px 16px; border-radius:6px; border:none; background:#3b6; color:#000; cursor:pointer; }
  button:disabled { background:#2a3a30; color:#777; cursor:not-allowed; }
  #attest { margin-top:20px; font-size: 13px; }
  a { color: #6cf; }
  pre { background:#11151c; padding:10px; border-radius:6px; overflow-x:auto; font-size:12px; }
  .note { font-size:12px; color:#8a8a8a; margin-top:6px; }
</style>
</head>
<body>
  <h1>Gemma-1B &mdash; served via vLLM inside an Azure Confidential VM (AMD SEV-SNP)</h1>
  <div id="log"></div>
  <div id="row">
    <input id="input" placeholder="Ask Gemma something..." />
    <button id="sendBtn" onclick="send()">Send</button>
  </div>
  <div class="note">CPU-only inference inside the enclave (no AVX512, float32) runs at ~4 tokens/sec, so replies stream in slowly. That is the cost of keeping the model in encrypted memory.</div>
  <div id="attest">
    <button onclick="checkAttestation()">Verify confidential inference (fetch MAA attestation)</button>
    <pre id="attestOut"></pre>
  </div>
<script>
let history = [];
const log = document.getElementById('log');

function append(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function send() {
  const input = document.getElementById('input');
  const btn = document.getElementById('sendBtn');
  const text = input.value.trim();
  if (!text || btn.disabled) return;
  append('user', text);
  input.value = '';
  btn.disabled = true;

  const bubble = append('bot', '');
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = 'generating...';
  log.appendChild(meta);

  let reply = '';
  let failed = false;
  try {
    const resp = await fetch('/chat', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: text, history: history})
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    // Parse the SSE stream by hand so tokens render the moment they arrive.
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += decoder.decode(value, {stream: true});
      const frames = buf.split('\\n\\n');
      buf = frames.pop();
      for (const frame of frames) {
        const evLine = frame.split('\\n').find(l => l.startsWith('event: '));
        const dataLine = frame.split('\\n').find(l => l.startsWith('data: '));
        if (!evLine || !dataLine) continue;
        const ev = evLine.slice(7);
        const data = JSON.parse(dataLine.slice(6));
        if (ev === 'token') {
          reply += data.t;
          bubble.textContent = reply;
          log.scrollTop = log.scrollHeight;
        } else if (ev === 'done') {
          meta.textContent = data.tokens + ' tokens in ' + data.elapsed_seconds + 's (' + data.tokens_per_second + ' tok/s)';
        } else if (ev === 'error') {
          failed = true;
          bubble.className = 'msg err';
          bubble.textContent = 'Error: ' + data.error;
          meta.textContent = '';
        }
      }
    }
  } catch (e) {
    failed = true;
    bubble.className = 'msg err';
    bubble.textContent = 'Request failed: ' + e.message;
    meta.textContent = '';
  }

  if (!failed && reply) {
    history.push({role:'user', content:text});
    history.push({role:'assistant', content:reply});
  }
  btn.disabled = false;
  document.getElementById('input').focus();
}
document.getElementById('input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

async function checkAttestation() {
  const out = document.getElementById('attestOut');
  out.textContent = 'Fetching fresh attestation from Microsoft Azure Attestation...';
  const resp = await fetch('/attestation');
  const data = await resp.json();
  out.textContent = JSON.stringify(data.confidential_computing_proof, null, 2)
    + '\\n\\nFull signed JWT (verifiable at jwt.ms or via jwks at ' + data.issuer + '/certs):\\n' + data.jwt;
}
</script>
</body>
</html>
"""
