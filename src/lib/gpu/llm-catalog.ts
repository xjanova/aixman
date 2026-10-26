import type { GpuArch } from './gpu-specs';

/**
 * Language models we run ourselves on rented GPUs, served by vLLM and sold
 * through /api/v1.
 *
 * Unlike the ComfyUI catalogue there is no workflow: vLLM serves the
 * OpenAI-compatible API itself, behind the same token-gated proxy
 * (provision-llm.ts). A worker row's `modelKey` is the entry's key, which
 * always starts with `llm-` — that prefix is how the rental code tells an
 * API machine (kept up by its uptime policy, llm-policy.ts) from a render
 * machine (kept up by its queue).
 *
 * Sizes were read from Hugging Face (2026-10-26). vLLM flags were checked
 * against the v0.31.0 source: the parser names and arguments exist there.
 */

export const LLM_KEY_PREFIX = 'llm-';

/** vLLM release the workers install. Pinned: flags and parser names move between releases. */
export const VLLM_VERSION = '0.31.0';
/**
 * The CUDA build of vLLM's wheels (and of the torch it installs alongside).
 * v0.31.0's default binaries are 12.9; a driver for 13.0 runs them.
 */
export const VLLM_TORCH_BACKEND = 'cu129';

export interface LlmCatalogEntry {
  key: string;
  name: string;
  /** Thai, for the admin page. */
  description: string;
  /** Hugging Face repo with the weights. */
  repo: string;
  /** Only these files (glob patterns); everything when empty. */
  allowPatterns: string[];
  /** The weights' total size, for the disk and boot estimate. */
  bytes: number;
  licence: string;
  hardware: { minVramMb: number; diskGb: number; minArch: GpuArch };
  /** Passed to `vllm serve` after the model path. */
  vllmArgs: string[];
  contextLength: number;
  maxOutputTokens: number;
}

const GB = 1_000_000_000;

export const LLM_CATALOG: LlmCatalogEntry[] = [
  {
    key: 'llm-qwen3.8-27b',
    name: 'Qwen3.8 27B',
    description: 'โมเดลเขียนโค้ด/เอเจนต์ของ Qwen (ส.ค. 2026) • SWE-bench Pro 61.7 • การ์ด 48 GB',
    repo: 'Qwen/Qwen3.8-27B-FP8',
    allowPatterns: [],
    // 64 layer shards (24.4 GB) + the vision/embedding file (6.0 GB) + MTP head.
    bytes: 30.9 * GB,
    licence: 'Apache-2.0',
    hardware: { minVramMb: 46_000, diskGb: 80, minArch: 'ampere' },
    vllmArgs: [
      '--max-model-len', '131072',
      // Text-only API: the vision encoder would only take VRAM from the KV cache.
      '--language-model-only',
      '--reasoning-parser', 'qwen3',
      '--enable-auto-tool-choice', '--tool-call-parser', 'qwen3_coder',
    ],
    contextLength: 131_072,
    maxOutputTokens: 32_768,
  },
  {
    key: 'llm-devstral-small-2',
    name: 'Devstral Small 2 24B',
    description: 'โมเดลเขียนโค้ดของ Mistral • SWE-bench Verified 68.0 • เร็วและถูก การ์ด 48 GB',
    repo: 'mistralai/Devstral-Small-2-24B-Instruct-2512',
    // Mistral's own format only: the repo also carries the same weights in HF format.
    allowPatterns: ['consolidated*.safetensors', 'params.json', 'tekken.json'],
    bytes: 25.8 * GB,
    licence: 'Apache-2.0',
    hardware: { minVramMb: 46_000, diskGb: 70, minArch: 'ampere' },
    vllmArgs: [
      '--tokenizer-mode', 'mistral', '--config-format', 'mistral', '--load-format', 'mistral',
      '--max-model-len', '131072',
      '--enable-auto-tool-choice', '--tool-call-parser', 'mistral',
    ],
    contextLength: 131_072,
    maxOutputTokens: 32_768,
  },
  {
    key: 'llm-qwen3-coder-next',
    name: 'Qwen3-Coder-Next 80B',
    description: 'โมเดลเขียนโค้ดตัวใหญ่ของ Qwen (MoE 80B, active 3B) • เร็วมากเมื่อมีผู้ใช้พร้อมกันหลายคน • การ์ด 96 GB',
    repo: 'Qwen/Qwen3-Coder-Next-FP8',
    allowPatterns: [],
    bytes: 80.4 * GB,
    licence: 'Apache-2.0',
    hardware: { minVramMb: 94_000, diskGb: 150, minArch: 'ampere' },
    vllmArgs: [
      '--max-model-len', '131072',
      '--enable-auto-tool-choice', '--tool-call-parser', 'qwen3_coder',
    ],
    contextLength: 131_072,
    maxOutputTokens: 32_768,
  },
];

export function isLlmModelKey(key: string): boolean {
  return key.startsWith(LLM_KEY_PREFIX);
}

export function getLlmEntry(key: string): LlmCatalogEntry | undefined {
  return LLM_CATALOG.find((e) => e.key === key);
}
