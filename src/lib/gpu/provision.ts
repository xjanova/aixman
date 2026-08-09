import { MINIMAX_H3_MODELS } from './workflows/minimax-h3';

/**
 * Container provisioning for a rented GPU.
 *
 * There is no official MiniMax H3 serving image, and building one would put a
 * Docker registry between the operator and a working system. Instead a stock
 * PyTorch image is booted and everything is installed by the start script:
 * ComfyUI, its dependencies, the quantised weights, and a token-gated proxy.
 *
 * The trade-off is cold start: ~42.5 GB of weights means the first render on a
 * fresh machine takes tens of minutes. That is why workers are kept warm and
 * why `gpu_warmup_timeout_minutes` is generous.
 */

/**
 * Stock PyTorch image. CUDA 12.8 is the deliberate choice: it is the first
 * release with Blackwell (RTX 5090, sm_120) support while still running on the
 * widely-deployed 12.8+ host drivers. A 13.x image would need a much newer
 * driver and would exclude most of the marketplace.
 */
export const DEFAULT_BASE_IMAGE = 'pytorch/pytorch';
export const DEFAULT_BASE_TAG = '2.11.0-cuda12.8-cudnn9-runtime';
/** Minimum host CUDA version the image above can run on. */
export const DEFAULT_MIN_CUDA = '12.8';

/** Weights repo the official ComfyUI template points at. */
const WEIGHTS_REPO = 'Comfy-Org/MiniMax-H3';

/** Where ComfyUI is installed inside the container. */
const ROOT = '/workspace/aixman';

export interface ProvisionOptions {
  /** Port the token-gated proxy listens on — the one published publicly. */
  publicPort: number;
  /** Extra bash the operator wants appended, run before ComfyUI starts. */
  extraScript?: string;
  /** Hugging Face token, needed if the weights repo is gated. */
  hfToken?: string;
  /** Environment for the container, exported at the top of the script. */
  env?: Record<string, string>;
}

/**
 * Render environment variables as shell exports.
 *
 * Also appended to /etc/environment: the vendor's own structured env-var
 * payload shape is undocumented, so a variable dropped there would leave the
 * container misconfigured with no error to trace.
 */
export function renderEnvExports(env: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    // Reject shell-unsafe names outright rather than emitting broken syntax.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    lines.push(`export ${key}=${shellQuote(value)}`);
    lines.push(`echo ${shellQuote(`${key}=${value}`)} >> /etc/environment`);
  }
  return lines.join('\n');
}

/**
 * The token-gating proxy.
 *
 * ComfyUI has no authentication and the published port is reachable by anyone
 * who learns the tunnel URL, who could then run arbitrary workflows — and
 * ComfyUI can read and write files and install nodes. This proxy sits in front,
 * requires the shared bearer token, and forwards to ComfyUI bound to loopback.
 *
 * Written with the standard library only so it needs no extra install step.
 */
function proxySource(): string {
  return String.raw`
import os, sys, http.server, socketserver, urllib.request, urllib.error, hmac

TOKEN = os.environ.get("AIXMAN_WORKER_TOKEN", "")
UPSTREAM = "http://127.0.0.1:8188"
PORT = int(os.environ.get("AIXMAN_PROXY_PORT", "8189"))
HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization"}

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")

    def _authorized(self):
        if not TOKEN:
            return True  # no token configured: fail open rather than brick the worker
        header = self.headers.get("Authorization", "")
        supplied = header[7:] if header.lower().startswith("bearer ") else ""
        # Constant-time: a timing oracle here would leak the token byte by byte.
        return hmac.compare_digest(supplied, TOKEN)

    def _deny(self):
        body = b'{"error":"unauthorized"}'
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _forward(self, method):
        if not self._authorized():
            self._deny()
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=method)
        for k, v in self.headers.items():
            if k.lower() not in HOP and k.lower() != "authorization":
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=600) as up:
                self.send_response(up.status)
                for k, v in up.headers.items():
                    if k.lower() not in HOP:
                        self.send_header(k, v)
                self.end_headers()
                # Streamed in chunks: renders can be hundreds of megabytes and
                # buffering one whole in memory would exhaust the container.
                while True:
                    chunk = up.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "text/plain"))
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            payload = str(e).encode()[:500]
            self.send_response(502)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

Server(("0.0.0.0", PORT), Handler).serve_forever()
`.trim();
}

/**
 * Build the full start script.
 *
 * Ordering matters: ComfyUI is started as soon as it is installed, *before* the
 * weights finish downloading, so `/system_stats` answers early and the health
 * check can distinguish "still warming" from "dead". The workflow validator
 * then reports precisely if a model file is still missing when a job arrives.
 */
export function buildComfyUiStartScript(opts: ProvisionOptions): string {
  const files = [
    `diffusion_models/${MINIMAX_H3_MODELS.unet}`,
    `text_encoders/${MINIMAX_H3_MODELS.clip}`,
    `vae/${MINIMAX_H3_MODELS.videoVae}`,
    `vae/${MINIMAX_H3_MODELS.audioVae}`,
  ];

  return `#!/usr/bin/env bash
# Provisioned by AIXMAN. Logs: ${ROOT}/boot.log
# NOTE: -e is deliberately omitted. A failed apt mirror or an optional step must
# not abort the boot and strand a machine that is already being billed.
set -uo pipefail
mkdir -p ${ROOT}
exec > >(tee -a ${ROOT}/boot.log) 2>&1

export DEBIAN_FRONTEND=noninteractive
export AIXMAN_PROXY_PORT=${opts.publicPort}
export HF_HUB_ENABLE_HF_TRANSFER=1
${opts.hfToken ? `export HF_TOKEN=${shellQuote(opts.hfToken)}` : '# no HF token supplied'}
${opts.env ? renderEnvExports(opts.env) : ''}

cd ${ROOT}

echo "[aixman] installing system packages"
apt-get update -qq && apt-get install -y -qq git curl ca-certificates || true

echo "[aixman] installing ComfyUI"
if [ ! -d ${ROOT}/ComfyUI ]; then
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git ${ROOT}/ComfyUI
fi
pip install --no-cache-dir -q -r ${ROOT}/ComfyUI/requirements.txt
pip install --no-cache-dir -q "huggingface_hub[hf_transfer,cli]"

mkdir -p ${ROOT}/ComfyUI/models/diffusion_models \\
         ${ROOT}/ComfyUI/models/text_encoders \\
         ${ROOT}/ComfyUI/models/vae

cat > ${ROOT}/proxy.py <<'AIXMAN_PROXY_EOF'
${proxySource()}
AIXMAN_PROXY_EOF

# ComfyUI binds to loopback only; the proxy is the sole public entrance.
echo "[aixman] starting ComfyUI on 127.0.0.1:8188"
nohup python3 ${ROOT}/ComfyUI/main.py --listen 127.0.0.1 --port 8188 \\
  > ${ROOT}/comfyui.log 2>&1 &

echo "[aixman] starting auth proxy on 0.0.0.0:${opts.publicPort}"
nohup python3 ${ROOT}/proxy.py > ${ROOT}/proxy.log 2>&1 &

# Downloads run last and in the foreground. hf resumes partial files, so a
# retry after a network drop does not restart 42 GB from zero.
download() {
  local path="$1"
  for attempt in 1 2 3; do
    echo "[aixman] downloading $path (attempt $attempt)"
    if hf download ${WEIGHTS_REPO} "$path" --local-dir ${ROOT}/ComfyUI/models; then
      return 0
    fi
    # Older installs still ship the pre-rename CLI.
    if huggingface-cli download ${WEIGHTS_REPO} "$path" --local-dir ${ROOT}/ComfyUI/models; then
      return 0
    fi
    sleep 10
  done
  echo "[aixman] FAILED to download $path"
  return 1
}

${files.map((f) => `download "${f}"`).join('\n')}

echo "[aixman] model download stage complete"
touch ${ROOT}/models.ready
${opts.extraScript?.trim() ? `\n# operator script\n${opts.extraScript.trim()}\n` : ''}
# Keep PID 1 alive: if this script exits the container stops and the rental is
# wasted. Restart either service if it dies so a transient crash self-heals.
while true; do
  if ! pgrep -f "ComfyUI/main.py" > /dev/null; then
    echo "[aixman] ComfyUI died, restarting"
    nohup python3 ${ROOT}/ComfyUI/main.py --listen 127.0.0.1 --port 8188 \\
      > ${ROOT}/comfyui.log 2>&1 &
  fi
  if ! pgrep -f "proxy.py" > /dev/null; then
    echo "[aixman] proxy died, restarting"
    nohup python3 ${ROOT}/proxy.py > ${ROOT}/proxy.log 2>&1 &
  fi
  sleep 20
done
`;
}

/** Single-quote for POSIX sh; the only escape needed is the quote itself. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
