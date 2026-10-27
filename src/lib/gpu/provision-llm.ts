import type { LlmCatalogEntry } from './llm-catalog';
import { VLLM_TORCH_BACKEND, VLLM_VERSION } from './llm-catalog';
import { READY_PATH, proxySource, renderEnvExports, shellQuote, tunnelFetch } from './provision';

/**
 * Start script for a language-model worker: vLLM behind our token-gated proxy.
 *
 * Same machine contract as a ComfyUI worker (provision.ts), so the rental,
 * health and reaping code treats both alike: the proxy is the only public
 * entrance, `READY_PATH` answers 503 while the weights download and the model
 * loads, 500 once the boot failed, 200 when vLLM's `/health` does; tunnel-mode
 * vendors get the same cloudflared tunnel (named when `AIXMAN_TUNNEL_TOKEN` is
 * in env, else quick).
 *
 *   proxy up ─┬─ weights (snapshot_download, background) ───────────┐
 *             └─ uv venv ─ vLLM (cu129 wheels + its torch) ───────────┴─ vllm serve ─ ready
 *
 * vLLM lives in its own venv: its wheels are built for CUDA 12.9 and pin their
 * own torch; installing them over the image's cu130 torch would mix builds.
 * uv resolves the matching torch from the cu129 index.
 */

const ROOT = '/workspace/aixman';
/** vLLM listens here on loopback; the proxy forwards to it. */
const VLLM_PORT = 8188;

export interface LlmProvisionOptions {
  publicPort: number;
  entry: LlmCatalogEntry;
  hfToken?: string;
  env?: Record<string, string>;
  tunnel?: boolean;
}

export function buildVllmStartScript(opts: LlmProvisionOptions): string {
  const { entry } = opts;
  const download = {
    repo: entry.repo,
    dir: `${ROOT}/models/llm`,
    allow: entry.allowPatterns.length > 0 ? entry.allowPatterns : null,
  };
  const serveArgs = ['--served-model-name', entry.key, '--host', '127.0.0.1', '--port', String(VLLM_PORT),
    '--gpu-memory-utilization', '0.90', ...entry.vllmArgs].map(shellQuote).join(' ');

  return `#!/usr/bin/env bash
# Provisioned by AIXMAN (language model ${entry.key}). Logs: ${ROOT}/boot.log
# NOTE: -e is deliberately omitted, as in the ComfyUI script: a failed optional
# step must not strand a machine that is already being billed.
set -uo pipefail
export PATH="/opt/conda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\${PATH:+:\$PATH}"
mkdir -p ${ROOT}/models ${ROOT}/dl
exec > >(tee -a ${ROOT}/boot.log) 2>&1
echo "[aixman] llm boot started $(date -u +%FT%TZ) with python $(command -v python3 || echo MISSING)"

export AIXMAN_PROXY_PORT=${opts.publicPort}
export AIXMAN_ROOT=${ROOT}
export AIXMAN_UPSTREAM=http://127.0.0.1:${VLLM_PORT}
export AIXMAN_HEALTH_PATH=/health
export AIXMAN_PROXY_MODE=llm
# A long answer that is not streamed can be silent for many minutes.
export AIXMAN_UPSTREAM_TIMEOUT=1800
${opts.tunnel ? 'export AIXMAN_PROXY_BIND=127.0.0.1' : '# the vendor publishes the proxy port itself'}
${opts.hfToken ? `export HF_TOKEN=${shellQuote(opts.hfToken)}` : '# no HF token supplied'}
${opts.env ? renderEnvExports(opts.env) : ''}

cd ${ROOT}
rm -f ${ROOT}/models.ready ${ROOT}/models.failed

fail_boot() {
  echo "[aixman] BOOT FAILED: $1"
  [ -f ${ROOT}/models.failed ] || printf '%s' "$1" > ${ROOT}/models.failed
}

cat > ${ROOT}/proxy.py <<'AIXMAN_PROXY_EOF'
${proxySource()}
AIXMAN_PROXY_EOF

start_proxy() {
  nohup python3 ${ROOT}/proxy.py > >(tee -a ${ROOT}/proxy.log) 2>&1 &
  PROXY_PID=$!
}
echo "[aixman] starting auth proxy on port ${opts.publicPort}"
start_proxy
${opts.tunnel ? tunnelFetch() : ''}
if command -v nvidia-smi > /dev/null && ! nvidia-smi > /dev/null 2>&1; then
  fail_boot "No usable GPU: nvidia-smi fails — CUDA is unavailable in the container"
fi

export PIP_BREAK_SYSTEM_PACKAGES=1 PIP_ROOT_USER_ACTION=ignore PIP_DISABLE_PIP_VERSION_CHECK=1
export HF_HUB_DISABLE_PROGRESS_BARS=1 HF_HUB_DISABLE_UPDATE_CHECK=1
if ! python3 -m pip install --no-cache-dir -q -U "huggingface_hub>=0.34" hf_xet uv > ${ROOT}/pip.log 2>&1; then
  cat ${ROOT}/pip.log
  fail_boot "huggingface_hub/uv failed to install: $(grep -iE 'error' ${ROOT}/pip.log | tail -n 2 | tr '\\n' ' ' | cut -c1-300)"
fi
if [ "$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1048576 ))" -ge 48 ]; then export HF_XET_HIGH_PERFORMANCE=1; fi

# The weights, in the background: the long pole. Judged by snapshot_download's
# own completion (it verifies every file), retried for a dropped connection.
cat > ${ROOT}/fetch.json <<'AIXMAN_FETCH_EOF'
${JSON.stringify(download)}
AIXMAN_FETCH_EOF
(
  for attempt in 1 2 3; do
    echo "[aixman] downloading ${entry.repo} (attempt $attempt)"
    if python3 - <<'AIXMAN_PY'
import json
from huggingface_hub import snapshot_download
spec = json.load(open("${ROOT}/fetch.json"))
snapshot_download(repo_id=spec["repo"], local_dir=spec["dir"], allow_patterns=spec["allow"], max_workers=8)
AIXMAN_PY
    then
      touch ${ROOT}/models.ready
      echo "[aixman] weights in place"
      exit 0
    fi
    sleep 15
  done
  fail_boot "weights failed to download from ${entry.repo}"
) &

echo "[aixman] installing vLLM ${VLLM_VERSION} (${VLLM_TORCH_BACKEND})"
if python3 -m uv venv ${ROOT}/venv --python "$(command -v python3)" > ${ROOT}/pip.log 2>&1 \\
   && VIRTUAL_ENV=${ROOT}/venv python3 -m uv pip install ${shellQuote(`vllm==${VLLM_VERSION}`)} \\
        --torch-backend=${VLLM_TORCH_BACKEND} >> ${ROOT}/pip.log 2>&1; then
  echo "[aixman] vLLM installed"
else
  tail -n 20 ${ROOT}/pip.log
  fail_boot "vLLM failed to install: $(grep -iE 'error|conflict|no solution' ${ROOT}/pip.log | tail -n 3 | tr '\\n' ' ' | cut -c1-400)"
fi

# vLLM loads the model when it starts, so it waits for the weights.
while [ ! -f ${ROOT}/models.ready ] && [ ! -f ${ROOT}/models.failed ]; do sleep 10; done

SERVER_PID=""
start_server() {
  nohup ${ROOT}/venv/bin/vllm serve ${ROOT}/models/llm ${serveArgs} >> ${ROOT}/server.log 2>&1 &
  SERVER_PID=$!
}
if [ -f ${ROOT}/models.ready ] && [ -x ${ROOT}/venv/bin/vllm ]; then
  echo "[aixman] starting vLLM on 127.0.0.1:${VLLM_PORT} as ${entry.key}; ready at ${READY_PATH} once it answers /health"
  start_server
fi

# PID 1 stays up: if this script exits the container stops and the rental is wasted.
restarts=0
while true; do
  if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
    restarts=$((restarts + 1))
    if [ "$restarts" -gt 3 ]; then
      fail_boot "vLLM keeps exiting: $(grep -iE 'error|out of memory' ${ROOT}/server.log | tail -n 3 | tr '\\n' ' ' | cut -c1-400)"
      SERVER_PID=""
    else
      echo "[aixman] vLLM exited, restarting ($restarts)"
      start_server
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
