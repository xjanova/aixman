/**
 * What we know about a GPU from its marketplace name alone: whether it can
 * run the catalogue at all, and roughly how fast.
 *
 * Eligibility used to be a per-model list of names (A100, RTX 5090, RTX PRO
 * 6000, RTX 4090). Every other card that could run the work — L40S, H100,
 * RTX 6000 Ada, A6000 — was invisible to the picker, so when the one host
 * everything landed on went away, the market looked empty. What a model
 * actually needs is VRAM (the offer filter checks it) and an architecture the
 * worker image can run: Ampere or newer, for bf16 and the comfy-kitchen
 * kernels the int8/nvfp4 weights use. Anything older — V100s are plentiful
 * and cheap on SimplePod — boots fine and then fails at the first tensor.
 *
 * `speed` is diffusion throughput relative to an A100, from public specs and
 * benchmarks. It is only a starting guess for a card this deployment has
 * never rendered on; measured render times replace it (see renderEstimate in
 * offer-picker.ts).
 *
 * Unknown names are refused: a card we cannot place might be one that cannot
 * run CUDA 13 at all. An admin can still allow it by name in the profile.
 */

export type GpuArch = 'blackwell' | 'hopper' | 'ada' | 'ampere' | 'turing' | 'volta' | 'pascal';

export interface GpuSpec {
  /** Matched against the vendor's name, case-insensitively. First match wins. */
  match: RegExp;
  arch: GpuArch;
  /** Rough diffusion throughput, A100 = 1. */
  speed: number;
}

const ARCH_RANK: Record<GpuArch, number> = {
  pascal: 0,
  volta: 1,
  turing: 2,
  ampere: 3,
  ada: 4,
  hopper: 5,
  blackwell: 6,
};

/**
 * The oldest architecture a model runs on unless its catalogue entry says
 * otherwise. The CUDA 13 image has no kernels below Turing at all; the bf16
 * and int8 paths the video and image models use need Ampere.
 */
export const MIN_ARCH: GpuArch = 'ampere';

// Most specific first: "RTX PRO 6000" must not be read as "RTX 6000", nor
// "H100 NVL" as a plain "H100".
const SPECS: GpuSpec[] = [
  { match: /\bB200\b|\bGB200\b/i, arch: 'blackwell', speed: 3.0 },
  { match: /RTX\s*PRO\s*6000/i, arch: 'blackwell', speed: 1.5 },
  { match: /RTX\s*PRO\s*5000/i, arch: 'blackwell', speed: 1.1 },
  { match: /RTX\s*PRO\s*4500/i, arch: 'blackwell', speed: 0.8 },
  { match: /RTX\s*PRO\s*4000/i, arch: 'blackwell', speed: 0.6 },
  { match: /RTX\s*5090/i, arch: 'blackwell', speed: 1.3 },
  { match: /RTX\s*5080/i, arch: 'blackwell', speed: 0.85 },
  { match: /RTX\s*50[67]0/i, arch: 'blackwell', speed: 0.5 },
  { match: /\bGH200\b|\bH200\b/i, arch: 'hopper', speed: 2.0 },
  { match: /\bH100\b.*(SXM|HBM3)|(SXM|HBM3).*\bH100\b/i, arch: 'hopper', speed: 1.9 },
  { match: /\bH100\b|\bH800\b/i, arch: 'hopper', speed: 1.5 },
  { match: /\bL40S\b/i, arch: 'ada', speed: 1.0 },
  { match: /\bL40\b/i, arch: 'ada', speed: 0.85 },
  { match: /RTX\s*6000\s*Ada|RTX\s*6000\b.*Ada/i, arch: 'ada', speed: 1.0 },
  { match: /RTX\s*5000\s*Ada/i, arch: 'ada', speed: 0.7 },
  { match: /RTX\s*4500\s*Ada|RTX\s*4000\s*Ada/i, arch: 'ada', speed: 0.45 },
  { match: /RTX\s*4090/i, arch: 'ada', speed: 0.95 },
  { match: /RTX\s*4080/i, arch: 'ada', speed: 0.65 },
  { match: /RTX\s*40[67]0/i, arch: 'ada', speed: 0.45 },
  { match: /\bL4\b/i, arch: 'ada', speed: 0.3 },
  { match: /\bA100\b|\bA800\b/i, arch: 'ampere', speed: 1.0 },
  { match: /RTX\s*A6000|\bA6000\b/i, arch: 'ampere', speed: 0.6 },
  { match: /\bA40\b/i, arch: 'ampere', speed: 0.6 },
  { match: /RTX\s*A5500|RTX\s*A5000/i, arch: 'ampere', speed: 0.45 },
  { match: /RTX\s*A4500|RTX\s*A4000/i, arch: 'ampere', speed: 0.35 },
  { match: /RTX\s*3090/i, arch: 'ampere', speed: 0.55 },
  { match: /RTX\s*3080/i, arch: 'ampere', speed: 0.45 },
  { match: /RTX\s*30[67]0/i, arch: 'ampere', speed: 0.3 },
  { match: /\bA30\b/i, arch: 'ampere', speed: 0.5 },
  { match: /\bA10G?\b/i, arch: 'ampere', speed: 0.4 },
  { match: /\bA16\b|\bA2\b/i, arch: 'ampere', speed: 0.15 },
  { match: /\bV100\b|TITAN\s*V\b/i, arch: 'volta', speed: 0.4 },
  { match: /\bT4\b|RTX\s*20\d0|TITAN\s*RTX|Quadro\s*RTX/i, arch: 'turing', speed: 0.25 },
  { match: /\bP100\b|\bP40\b|\bP4\b|GTX\s*10\d0|TITAN\s*X/i, arch: 'pascal', speed: 0.15 },
];

export function gpuSpecFor(name: string | null | undefined): GpuSpec | undefined {
  if (!name) return undefined;
  return SPECS.find((s) => s.match.test(name));
}

/**
 * Whether a card can run a model. With an explicit allow-list (an admin's
 * profile override) that list decides; otherwise the card must be one we
 * know, of `minArch` or newer.
 */
export function isEligibleGpu(name: string, allowList: string[] = [], minArch: GpuArch = MIN_ARCH): boolean {
  const allow = allowList.map((m) => m.toLowerCase().trim()).filter(Boolean);
  if (allow.length > 0) return allow.some((m) => name.toLowerCase().includes(m));
  const spec = gpuSpecFor(name);
  return spec !== undefined && ARCH_RANK[spec.arch] >= ARCH_RANK[minArch];
}

/** Rough speed relative to an A100; 1 for a card we cannot place. */
export function priorSpeed(name: string | null | undefined): number {
  return gpuSpecFor(name)?.speed ?? 1;
}

/**
 * One name for a card type however a vendor spells it. The marketplace lists
 * "A100" where the running instance reports "NVIDIA A100-SXM4-40GB"; keyed on
 * the raw string, render history and card penalties recorded against one
 * spelling never applied to the other.
 */
export function cardFamily(name: string | null | undefined): string {
  if (!name) return 'unknown';
  return gpuSpecFor(name)?.match.source ?? name.trim().toLowerCase();
}
