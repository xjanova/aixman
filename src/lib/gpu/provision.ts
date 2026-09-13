/**
 * Container provisioning for a rented GPU.
 *
 * No model in the catalogue ships a ready-made serving image, and building one
 * per model would put a Docker registry between the operator and a working
 * system. Instead a stock PyTorch image is booted and everything is installed
 * by the start script: ComfyUI, its dependencies, the weights the chosen model
 * needs, and a token-gated proxy.
 *
 * The trade-off is cold start. Weights range from ~10 GB (ACE-Step) to ~42 GB
 * (MiniMax H3), so a first render on a fresh machine takes tens of minutes.
 * That is why workers are kept warm and why `gpu_warmup_timeout_minutes` is
 * generous — and why the cheap audio model is worth offering: it is the one
 * that boots fast.
 */

/**
 * Stock PyTorch image, built for CUDA 13.0.
 *
 * Not 12.8, although 12.8 was the first release with Blackwell support: ComfyUI
 * turns off comfy-kitchen's CUDA kernels on anything below cu130
 * (`comfy/quant_ops.py`), and those kernels are what run the int8_convrot and
 * nvfp4 weights the catalogue uses — Comfy-Org's MiniMax H3 README says to use
 * int8_convrot only "if you are able to use pytorch with cu130". On cu128 the
 * same files load, then crawl through the pure-PyTorch fallback.
 *
 * The cost is hosts with drivers older than CUDA 13. Measured on SimplePod
 * (2026-09-11), every card able to hold these models reported 13.0+; the
 * 12.7 hosts were 4090s and 3060s.
 *
 * 2.13 rather than the newest 2.14: ComfyUI recommends a torch at least two
 * weeks old, and 2.14 was nine days old when this was chosen.
 */
export const DEFAULT_BASE_IMAGE = 'pytorch/pytorch';
export const DEFAULT_BASE_TAG = '2.13.0-cuda13.0-cudnn9-runtime';
/** Minimum host CUDA version the image above can run on. */
export const DEFAULT_MIN_CUDA = '13.0';

/**
 * ComfyUI release the workers install. Pinned, because templates are converted
 * against node signatures and those change between releases — the catalogue's
 * three graphs were checked against this exact tag by submitting them to its
 * own `/prompt` validator. Bump it only after repeating that check.
 */
export const COMFYUI_REPO = 'https://github.com/Comfy-Org/ComfyUI.git';
export const COMFYUI_REF = 'v0.35.1';

/** Where ComfyUI is installed inside the container. */
const ROOT = '/workspace/aixman';

/**
 * Proxy path that answers whether the worker can take a job. Served by the
 * proxy itself, so it works before ComfyUI is up and can report a boot failure.
 */
export const READY_PATH = '/aixman/ready';

/** Proxy path returning the tail of the boot, ComfyUI and proxy logs, for diagnosis. */
export const LOG_PATH = '/aixman/log';

/**
 * Proxy path reporting how far the running render is — which node, sampler
 * step N of M — as read from ComfyUI's websocket. ComfyUI has no HTTP
 * endpoint for this; only websocket clients hear it.
 */
export const PROGRESS_PATH = '/aixman/progress';

export interface ProvisionOptions {
  /** Port the token-gated proxy listens on — the one published publicly. */
  publicPort: number;
  /** Extra bash the operator wants appended, run before ComfyUI starts. */
  extraScript?: string;
  /** Hugging Face token, needed if the weights repo is gated. */
  hfToken?: string;
  /** Environment for the container, exported at the top of the script. */
  env?: Record<string, string>;
  /** Weight files this model needs, from the catalogue entry. */
  downloads?: { repo: string; file: string; dest: string; as?: string }[];
  /** Community node packs the model's template depends on. */
  customNodes?: { repo: string; ref?: string }[];
  /**
   * The vendor gives only a bare IP and port (GpuExposure 'tunnel'): fetch
   * cloudflared, keep the proxy on loopback, and let it open an HTTPS tunnel
   * and report the URL to `AIXMAN_CALLBACK_URL` (passed in `env`).
   */
  tunnel?: boolean;
}

/**
 * cloudflared, for workers that open their own tunnel. `latest` rather than a
 * pinned release: the quick-tunnel command line has been stable for years,
 * and a pinned URL that 404s would fail every boot.
 */
export const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';

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
 *
 * It also listens to ComfyUI's websocket to report render progress at
 * `PROGRESS_PATH`. ComfyUI sends a prompt's events only to the client id the
 * prompt was submitted under, so `/prompt` bodies are relabelled with the
 * proxy's own id on the way through — the node list read off the same body is
 * what tells a sampler step from a loader. None of this may break a render: a
 * body that will not parse is forwarded untouched, and the listener lives on
 * its own thread, reconnecting until ComfyUI is up.
 */
function proxySource(): string {
  return String.raw`
import os, sys, json, re, time, socket, base64, struct, threading, subprocess, http.server, socketserver, urllib.request, urllib.error, hmac

TOKEN = os.environ.get("AIXMAN_WORKER_TOKEN", "")
UPSTREAM = "http://127.0.0.1:8188"
PORT = int(os.environ.get("AIXMAN_PROXY_PORT", "8189"))
# Loopback when a tunnel is the way in; the port is then never published.
BIND = os.environ.get("AIXMAN_PROXY_BIND", "0.0.0.0")
ROOT = os.environ.get("AIXMAN_ROOT", "/workspace/aixman")
CALLBACK_URL = os.environ.get("AIXMAN_CALLBACK_URL", "")
READY_PATH = "${READY_PATH}"
LOG_PATH = "${LOG_PATH}"
PROGRESS_PATH = "${PROGRESS_PATH}"
PROGRESS_CLIENT = "aixman-progress"
HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization"}

# Node classes whose "progress" events are denoising steps. KSamplerSelect
# and the Sampler* scheduler pickers only configure one, so they must not match.
SAMPLER = re.compile(r"^(KSampler(Advanced)?|SamplerCustom(Advanced)?)$|Sampler$")
LOCK = threading.Lock()
GRAPHS = {}  # prompt_id -> {node_id: class_type}, the last few submitted
STATE = {}   # the prompt ComfyUI is executing now
LISTENING = [False]

def is_sampler(graph, node):
    return bool(node) and bool(SAMPLER.search(graph.get(node) or ""))

def note_graph(prompt_id, graph):
    with LOCK:
        GRAPHS[prompt_id] = graph
        while len(GRAPHS) > 8:
            GRAPHS.pop(next(iter(GRAPHS)))

def on_event(kind, data):
    pid = data.get("prompt_id")
    now = time.time()
    with LOCK:
        if kind == "execution_start":
            STATE.clear()
            STATE.update(prompt_id=pid, started=now, node=None, pnode=None, value=0, max=0,
                         nodes_done=0, samplers_done=0, sampler_end=None, done=False, failed=False)
            return
        if not STATE or pid != STATE.get("prompt_id"):
            return
        # Looked up per event: execution can start before /prompt's reply has
        # come back through here with the id the graph is filed under.
        graph = GRAPHS.get(pid, {})
        if kind == "execution_cached":
            for node in data.get("nodes") or []:
                STATE["nodes_done"] += 1
                if is_sampler(graph, node):
                    STATE["samplers_done"] += 1
        elif kind == "executing":
            prev = STATE.get("node")
            if prev is not None:
                STATE["nodes_done"] += 1
                if is_sampler(graph, prev):
                    STATE["samplers_done"] += 1
                    STATE["sampler_end"] = now
            STATE.update(node=data.get("node"), pnode=None, value=0, max=0)
            if data.get("node") is None:
                STATE["done"] = True
        elif kind == "progress":
            STATE.update(pnode=data.get("node"), value=data.get("value") or 0, max=data.get("max") or 0)
        elif kind == "execution_success":
            STATE["done"] = True
        elif kind in ("execution_error", "execution_interrupted"):
            STATE.update(done=True, failed=True)

def progress_snapshot():
    now = time.time()
    with LOCK:
        if not STATE:
            return {"prompt_id": None, "listening": LISTENING[0]}
        graph = GRAPHS.get(STATE["prompt_id"], {})
        return {
            "prompt_id": STATE["prompt_id"],
            "listening": LISTENING[0],
            "elapsed": round(now - STATE["started"], 1),
            "value": STATE["value"],
            "max": STATE["max"],
            "progress_is_sampler": is_sampler(graph, STATE["pnode"]),
            "nodes_total": len(graph),
            "nodes_done": STATE["nodes_done"],
            "samplers_total": sum(1 for c in graph.values() if SAMPLER.search(c or "")),
            "samplers_done": STATE["samplers_done"],
            "since_sampling": round(now - STATE["sampler_end"], 1) if STATE["sampler_end"] else None,
            "done": STATE["done"],
            "failed": STATE["failed"],
        }

def ws_send(sock, op, data=b""):
    # Client frames must be masked. Only pongs are sent, and a ping carries
    # at most 125 bytes, so the short length form always fits.
    mask = os.urandom(4)
    sock.sendall(bytes([0x80 | op, 0x80 | len(data)]) + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data)))

def ws_messages(sock, buf):
    def take(n):
        while len(buf) < n:
            chunk = sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed")
            buf.extend(chunk)
        out = bytes(buf[:n])
        del buf[:n]
        return out
    parts, kind = [], None
    while True:
        b1, b2 = take(2)
        op, n = b1 & 0x0F, b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", take(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", take(8))[0]
        mask = take(4) if b2 & 0x80 else None
        data = take(n)
        if mask:
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
        if op == 8:
            raise ConnectionError("websocket closed by ComfyUI")
        if op == 9:
            ws_send(sock, 10, data)
            continue
        if op in (1, 2):
            kind, parts = op, ([data] if op == 1 else [])
        elif op == 0 and kind == 1:
            parts.append(data)
        if b1 & 0x80 and op in (0, 1, 2):
            if kind == 1:
                yield b"".join(parts).decode("utf-8", "replace")
            kind, parts = None, []

def ws_listen():
    while True:
        sock = None
        try:
            sock = socket.create_connection(("127.0.0.1", 8188), timeout=10)
            key = base64.b64encode(os.urandom(16)).decode()
            sock.sendall(("GET /ws?clientId=%s HTTP/1.1\r\nHost: 127.0.0.1:8188\r\nUpgrade: websocket\r\n"
                          "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
                          % (PROGRESS_CLIENT, key)).encode())
            buf = bytearray()
            while b"\r\n\r\n" not in buf:
                chunk = sock.recv(4096)
                if not chunk:
                    raise ConnectionError("closed during handshake")
                buf.extend(chunk)
            head, _, rest = bytes(buf).partition(b"\r\n\r\n")
            if b" 101 " not in head.split(b"\r\n", 1)[0]:
                raise ConnectionError("websocket upgrade refused")
            # Idle can last as long as the machine does; only a closed
            # socket (ComfyUI restarting) should end this read.
            sock.settimeout(None)
            LISTENING[0] = True
            sys.stderr.write("[proxy] listening for render progress\n")
            for text in ws_messages(sock, bytearray(rest)):
                try:
                    msg = json.loads(text)
                    on_event(msg.get("type"), msg.get("data") or {})
                except Exception:
                    pass
        except Exception:
            pass
        if LISTENING[0]:
            sys.stderr.write("[proxy] progress listener disconnected\n")
        LISTENING[0] = False
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
        time.sleep(3)

# --- Own HTTPS tunnel, for vendors that give only a bare IP and port ---
# The platform must not send this worker's token or anyone's prompt over plain
# HTTP, so the proxy opens a Cloudflare quick tunnel to itself and reports the
# https URL. A restarted tunnel has a new URL, which is reported again.
TUNNEL_BIN = os.environ.get("AIXMAN_TUNNEL_BIN") or os.path.join(ROOT, "cloudflared")
TUNNEL_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
CURRENT_TUNNEL = [None]

def report_tunnel(url):
    body = json.dumps({"url": url}).encode()
    for _ in range(180):
        if CURRENT_TUNNEL[0] != url:
            return  # superseded by a newer tunnel
        try:
            req = urllib.request.Request(CALLBACK_URL, data=body, method="POST", headers={
                "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as up:
                if up.status == 200:
                    sys.stderr.write("[proxy] reported tunnel %s\n" % url)
                    return
        except urllib.error.HTTPError as e:
            # 404: the platform has not recorded this machine yet — retry.
            # 401/410: not ours, or already released — stop.
            if e.code in (400, 401, 403, 410):
                sys.stderr.write("[proxy] tunnel report refused: HTTP %d\n" % e.code)
                return
        except Exception:
            pass
        time.sleep(10)

def tunnel_loop():
    while not os.access(TUNNEL_BIN, os.X_OK):
        time.sleep(3)
    while True:
        try:
            proc = subprocess.Popen(
                [TUNNEL_BIN, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:%d" % PORT],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            with open(os.path.join(ROOT, "tunnel.log"), "a") as log:
                for line in proc.stdout:
                    log.write(line)
                    log.flush()
                    found = TUNNEL_URL.search(line)
                    if found and CURRENT_TUNNEL[0] != found.group(0):
                        CURRENT_TUNNEL[0] = found.group(0)
                        threading.Thread(target=report_tunnel, args=(found.group(0),), daemon=True).start()
            proc.wait()
        except Exception as e:
            sys.stderr.write("[proxy] tunnel failed: %s\n" % e)
        CURRENT_TUNNEL[0] = None
        time.sleep(5)

def tail(path, limit=64 * 1024):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - limit))
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""

def weights_bytes():
    total = 0
    for base in (os.path.join(ROOT, "models"), os.path.join(ROOT, "dl")):
        for dirpath, _dirs, files in os.walk(base):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
    return total

def readiness():
    # Ready means every weight file is on disk AND ComfyUI answers. ComfyUI
    # comes up long before 40 GB of weights land, so answering on its health
    # alone hands out jobs that can only fail.
    failed = os.path.join(ROOT, "models.failed")
    if os.path.exists(failed):
        with open(failed, errors="replace") as fh:
            return 500, {"ready": False, "failed": fh.read()[:500]}
    if not os.path.exists(os.path.join(ROOT, "models.ready")):
        return 503, {"ready": False, "stage": "downloading", "bytes": weights_bytes()}
    try:
        with urllib.request.urlopen(UPSTREAM + "/system_stats", timeout=5) as up:
            if up.status == 200:
                # "auth" lets the platform notice a worker that booted without
                # its token (the gate fails open) instead of assuming it is shut.
                return 200, {"ready": True, "auth": bool(TOKEN)}
    except Exception:
        pass
    return 503, {"ready": False, "stage": "starting"}

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        route = self.path.split("?", 1)[0]
        if route == READY_PATH:
            code, payload = readiness()
            self._json(code, payload)
            return
        if route == LOG_PATH:
            # The only window into a boot that went wrong: the machine and its
            # disk vanish when it is released. Behind the same token as the rest.
            self._json(200, {name: tail(os.path.join(ROOT, name)) for name in ("boot.log", "comfyui.log", "proxy.log", "tunnel.log")})
            return
        if route == PROGRESS_PATH:
            self._json(200, progress_snapshot())
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        graph = None
        if method == "POST" and route == "/prompt" and body:
            try:
                submitted = json.loads(body)
                graph = {str(k): str((v or {}).get("class_type") or "") for k, v in (submitted.get("prompt") or {}).items()}
                submitted["client_id"] = PROGRESS_CLIENT
                body = json.dumps(submitted).encode()
            except Exception:
                graph = None  # forwarded as it came; progress just goes unreported
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=method)
        skip = {"authorization"} | ({"content-length"} if graph is not None else set())
        for k, v in self.headers.items():
            if k.lower() not in HOP and k.lower() not in skip:
                req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=600) as up:
                self.send_response(up.status)
                for k, v in up.headers.items():
                    if k.lower() not in HOP:
                        self.send_header(k, v)
                # Transfer-Encoding is dropped above, so a body with no length
                # has no framing left — the only honest end marker is closing
                # the connection. Otherwise a keep-alive client waits forever.
                if up.headers.get("Content-Length") is None:
                    self.send_header("Connection", "close")
                    self.close_connection = True
                self.end_headers()
                # Streamed in chunks: renders can be hundreds of megabytes and
                # buffering one whole in memory would exhaust the container.
                reply = bytearray() if graph is not None else None
                while True:
                    chunk = up.read(65536)
                    if not chunk:
                        break
                    if reply is not None and len(reply) < 65536:
                        reply.extend(chunk)
                    self.wfile.write(chunk)
                if reply:
                    try:
                        pid = json.loads(bytes(reply)).get("prompt_id")
                        if pid:
                            note_graph(pid, graph)
                    except Exception:
                        pass
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

threading.Thread(target=ws_listen, daemon=True).start()
if CALLBACK_URL:
    threading.Thread(target=tunnel_loop, daemon=True).start()
Server((BIND, PORT), Handler).serve_forever()
`.trim();
}

/**
 * Build the full start script.
 *
 * Paid time is the budget here, so the slow parts overlap:
 *
 *   proxy up ─┬─ weights download (background, the long pole) ─────────┐
 *             └─ apt/git ─ ComfyUI (pinned) ─ pip ─ start ComfyUI ──────┴─ ready
 *
 * The proxy starts first because it is what reports progress and failure
 * (`READY_PATH`) — a boot that dies early says why within a minute instead of
 * idling until the warmup timeout. "Ready" means every weight file is on disk
 * and ComfyUI answers; ComfyUI alone comes up long before the weights do.
 */
export function buildComfyUiStartScript(opts: ProvisionOptions): string {
  // Repo layouts differ — Comfy-Org/MiniMax-H3 stores files at the same paths
  // ComfyUI expects, while ace_step and Qwen-Image nest everything under
  // `split_files/`. `hf download` preserves the repo path, so each file is
  // fetched then moved to the directory ComfyUI actually loads from.
  const downloads = (opts.downloads ?? []).map(
    (d) =>
      `  fetch_model ${shellQuote(d.repo)} ${shellQuote(d.file)} ${shellQuote(d.dest)} ${shellQuote(d.as ?? '')} || ok=0`
  );

  const customNodes = (opts.customNodes ?? []).map(
    (n) => `install_custom_node ${shellQuote(n.repo)} ${shellQuote(n.ref ?? '')}`
  );

  return `#!/usr/bin/env bash
# Provisioned by AIXMAN. Logs: ${ROOT}/boot.log
# NOTE: -e is deliberately omitted. A failed apt mirror or an optional step must
# not abort the boot and strand a machine that is already being billed.
set -uo pipefail
# The vendor's start-script runner need not carry the image's PATH, and in the
# stock PyTorch image python3, pip and hf live only under /opt/conda/bin.
export PATH="/opt/conda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\${PATH:+:\$PATH}"
mkdir -p ${ROOT}/models ${ROOT}/dl
exec > >(tee -a ${ROOT}/boot.log) 2>&1
echo "[aixman] boot script started $(date -u +%FT%TZ) as $(id -un) with python $(command -v python3 || echo MISSING)"

export DEBIAN_FRONTEND=noninteractive
export AIXMAN_PROXY_PORT=${opts.publicPort}
export AIXMAN_ROOT=${ROOT}
${opts.tunnel ? 'export AIXMAN_PROXY_BIND=127.0.0.1' : '# the vendor publishes the proxy port itself'}
${opts.hfToken ? `export HF_TOKEN=${shellQuote(opts.hfToken)}` : '# no HF token supplied'}
${opts.env ? renderEnvExports(opts.env) : ''}

cd ${ROOT}
rm -f ${ROOT}/models.ready ${ROOT}/models.failed ${ROOT}/failed.list

# Recorded for the proxy, which reports it at ${READY_PATH} so the platform can
# release the machine now rather than after the warmup timeout.
fail_boot() {
  echo "[aixman] BOOT FAILED: $1"
  [ -f ${ROOT}/models.failed ] || printf '%s' "$1" > ${ROOT}/models.failed
}

cat > ${ROOT}/proxy.py <<'AIXMAN_PROXY_EOF'
${proxySource()}
AIXMAN_PROXY_EOF

# The proxy is the sole public entrance; ComfyUI binds to loopback only.
start_proxy() {
  nohup python3 ${ROOT}/proxy.py >> ${ROOT}/proxy.log 2>&1 &
  PROXY_PID=$!
}
echo "[aixman] starting auth proxy on port ${opts.publicPort}"
start_proxy
${opts.tunnel ? tunnelFetch() : ''}
# A host whose driver is older than the image's CUDA boots the container fine
# and only fails at the first tensor — find out now, not 40 minutes in.
if ! python3 -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"; then
  fail_boot "CUDA is unavailable in the container: the host driver is older than the image's CUDA, or no GPU was attached"
fi

# The PyTorch image's Python comes from Ubuntu 24.04's apt, which marks it
# "externally managed" (PEP 668): every plain \`pip install\` is refused. Found on
# the first real rental — nothing installed, ComfyUI died on \`import sqlalchemy\`
# and no weights downloaded. This container exists only to run this job, so
# installing into the system interpreter is exactly what is wanted.
export PIP_BREAK_SYSTEM_PACKAGES=1
export PIP_ROOT_USER_ACTION=ignore
export PIP_DISABLE_PIP_VERSION_CHECK=1

# pip with its error kept: a failed install says why, instead of surfacing
# minutes later as a missing module somewhere else.
pip_install() {
  local label="$1"; shift
  if ! python3 -m pip install --no-cache-dir -q "$@" > ${ROOT}/pip.log 2>&1; then
    cat ${ROOT}/pip.log
    fail_boot "$label failed to install: $(grep -iE 'error|conflict|no matching' ${ROOT}/pip.log | tail -n 3 | tr '\\n' ' ' | cut -c1-400)"
    return 1
  fi
}

# Freeze the image's torch stack. A dependency that asks for a different torch
# would otherwise pull gigabytes of CUDA wheels over a build that works; with
# the constraint it fails loudly instead.
python3 -m pip list --format=freeze 2>/dev/null \\
  | grep -iE '^(torch|torchvision|torchaudio|triton)==' > ${ROOT}/constraints.txt || true
export PIP_CONSTRAINT=${ROOT}/constraints.txt

# hf_xet is the transfer backend HF serves large files through now;
# hf_transfer is deprecated and must not be enabled.
pip_install "huggingface_hub" -U "huggingface_hub>=0.34" hf_xet

fetch_model() {
  local repo="$1" path="$2" dest="$3" rename="$4"
  local base target
  base="$(basename "$path")"
  # A template may hardcode a filename the upstream repo doesn't use.
  [ -n "$rename" ] && base="$rename"
  target="${ROOT}/models/$dest/$base"

  if [ -s "$target" ]; then
    echo "[aixman] already have $base"
    return 0
  fi

  for attempt in 1 2 3; do
    echo "[aixman] downloading $repo :: $path (attempt $attempt)"
    # hf resumes partial files, so a retry after a network drop does not
    # restart tens of gigabytes from zero.
    if hf download "$repo" "$path" --local-dir "${ROOT}/dl" \\
       || huggingface-cli download "$repo" "$path" --local-dir "${ROOT}/dl"; then
      # The downloader keeps the repo path; ComfyUI only looks in the flat
      # models/<dest>/ directories, so move it into place.
      if [ -s "${ROOT}/dl/$path" ]; then
        mkdir -p "$(dirname "$target")"
        mv -f "${ROOT}/dl/$path" "$target"
        echo "[aixman] placed $base -> $dest"
        return 0
      fi
      echo "[aixman] downloader reported success but ${ROOT}/dl/$path is missing"
    fi
    sleep 10
  done
  echo "$path" >> ${ROOT}/failed.list
  echo "[aixman] FAILED to download $path"
  return 1
}

# Only a complete set counts. Marking ready after a failed file would hand the
# worker jobs that cannot load their model.
fetch_all() {
  local ok=1
${downloads.join('\n') || '  :'}
  if [ "$ok" = 1 ]; then
    touch ${ROOT}/models.ready
    echo "[aixman] all weights in place"
  else
    fail_boot "weights failed to download: $(tr '\\n' ' ' < ${ROOT}/failed.list)"
  fi
}
echo "[aixman] downloading weights in the background"
fetch_all &

echo "[aixman] installing system packages"
apt-get update -qq && apt-get install -y -qq git ca-certificates || true

echo "[aixman] installing ComfyUI ${COMFYUI_REF}"
if [ ! -d ${ROOT}/ComfyUI ]; then
  git clone --depth 1 --branch ${shellQuote(COMFYUI_REF)} ${COMFYUI_REPO} ${ROOT}/ComfyUI \\
    || fail_boot "could not clone ComfyUI ${COMFYUI_REF}"
fi
if [ -d ${ROOT}/ComfyUI ]; then
  # Weights land outside the checkout (the download started before it
  # existed); point ComfyUI's model folders at them.
  rm -rf ${ROOT}/ComfyUI/models
  ln -sfn ${ROOT}/models ${ROOT}/ComfyUI/models
  pip_install "ComfyUI requirements" -r ${ROOT}/ComfyUI/requirements.txt
fi

# Community node packs some official templates depend on. Pinned by ref where
# the catalogue supplies one, because an unpinned pack can change its node
# names and break a workflow that worked yesterday.
install_custom_node() {
  local repo="$1" ref="$2" name dir
  name="$(basename "$repo" .git)"
  dir="${ROOT}/ComfyUI/custom_nodes/$name"
  if [ ! -d "$dir" ]; then
    git clone --depth 1 "$repo" "$dir" || { fail_boot "could not clone custom node $repo"; return 1; }
  fi
  if [ -n "$ref" ]; then
    (cd "$dir" && git fetch --depth 1 origin "$ref" && git checkout -q FETCH_HEAD) || true
  fi
  [ -f "$dir/requirements.txt" ] && pip_install "$name requirements" -r "$dir/requirements.txt"
  echo "[aixman] custom node ready: $name"
}
${customNodes.join('\n')}
${opts.extraScript?.trim() ? `\n# operator script\n${opts.extraScript.trim()}\n` : ''}
COMFY_PID=""
start_comfy() {
  nohup python3 ${ROOT}/ComfyUI/main.py --listen 127.0.0.1 --port 8188 \\
    >> ${ROOT}/comfyui.log 2>&1 &
  COMFY_PID=$!
}
if [ -f ${ROOT}/ComfyUI/main.py ]; then
  echo "[aixman] starting ComfyUI on 127.0.0.1:8188"
  start_comfy
fi

# Keep PID 1 alive: if this script exits the container stops and the rental is
# wasted. Services are tracked by PID rather than pgrep, which a runtime image
# is not guaranteed to ship — a missing pgrep reads as "dead" and would respawn
# a CUDA process every 20 seconds.
restarts=0
while true; do
  if [ -n "$COMFY_PID" ] && ! kill -0 "$COMFY_PID" 2>/dev/null; then
    restarts=$((restarts + 1))
    if [ "$restarts" -gt 5 ]; then
      fail_boot "ComfyUI keeps exiting: $(tail -n 5 ${ROOT}/comfyui.log | tr '\\n' ' ' | cut -c1-400)"
      COMFY_PID=""
    else
      echo "[aixman] ComfyUI exited, restarting ($restarts)"
      start_comfy
    fi
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "[aixman] proxy exited, restarting"
    start_proxy
  fi
  sleep 20
done
`;
}

/**
 * Download cloudflared in the background; the proxy starts the tunnel as soon
 * as the binary is in place. Python rather than curl, which a runtime image
 * need not ship. A worker that cannot open its tunnel can never be reached, so
 * the platform releases it after TUNNEL_REPORT_TIMEOUT (gpu-worker.ts) — there
 * is no one to read a boot failure recorded here.
 */
function tunnelFetch(): string {
  return `
echo "[aixman] fetching cloudflared for the HTTPS tunnel"
(
  for attempt in 1 2 3 4 5; do
    if python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' \\
         ${shellQuote(CLOUDFLARED_URL)} ${ROOT}/cloudflared.part \\
       && chmod +x ${ROOT}/cloudflared.part && mv -f ${ROOT}/cloudflared.part ${ROOT}/cloudflared; then
      echo "[aixman] cloudflared ready"
      break
    fi
    echo "[aixman] cloudflared download failed (attempt $attempt)"
    sleep 5
  done
) &
`;
}

/** Single-quote for POSIX sh; the only escape needed is the quote itself. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
