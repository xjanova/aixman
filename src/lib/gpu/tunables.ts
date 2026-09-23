/**
 * Knobs an admin may turn on a catalogue workflow from /admin/workflows,
 * without a deploy.
 *
 * Each catalogue entry declares its own list. The entry's `bind`/`inject`
 * reads the resolved value through `tunableReader`, so the entry stays the one
 * place that knows what a knob *means* — "quality steps" on Qwen-Image is a
 * switch, a step count and a cfg together, which no generic node-input writer
 * could express. Values arrive here from the database, so every read goes
 * through `coerceTunable`: a value that is the wrong type or out of range falls
 * back to the default instead of reaching ComfyUI.
 *
 * Client-safe: no server imports, so the admin page can share the types.
 */

export type TunableValue = number | string | boolean;

export type TunableGroup = 'quality' | 'prompt' | 'sampler' | 'advanced';

export interface WorkflowTunable {
  id: string;
  /** Thai label shown in the admin form. */
  label: string;
  /** What it changes, and what a sensible value is. Thai. */
  help: string;
  type: 'int' | 'float' | 'bool' | 'choice' | 'text';
  /** What the catalogue uses when nobody has changed it. */
  default: TunableValue;
  min?: number;
  max?: number;
  step?: number;
  /** For `choice`. */
  options?: { value: string; label: string }[];
  /** Longest `text` value accepted. */
  maxLength?: number;
  group?: TunableGroup;
  /**
   * Moving it off the default leaves what the weights were distilled or tuned
   * for — a turbo LoRA's step count, its sigma shift. Allowed, but the admin
   * page says so beside the field.
   */
  risky?: boolean;
}

/**
 * One of a model's quality modes. The customer picks it in the studio; the
 * entry's `bind` renders it; the price is the base price times the multiplier.
 */
export interface QualityMode {
  id: string;
  label: string;
  description: string;
  creditsMultiplier: number;
  isDefault?: boolean;
  /**
   * Admins only until switched on for everyone in /admin/workflows — how an
   * unproven mode gets a real render before a customer can pay for one. A mode
   * that fails three times in a row would pull the whole model from sale
   * (model-readiness.ts), so a new one starts here.
   */
  adminOnly?: boolean;
}

/** Longest free-text tunable, whatever a definition says. */
const TEXT_CEILING = 4000;

/**
 * The value to use for `def`, given whatever was stored. Null when `raw` is
 * absent or unusable — the caller then uses the default.
 */
export function coerceTunable(def: WorkflowTunable, raw: unknown): TunableValue | null {
  if (raw === undefined || raw === null) return null;
  switch (def.type) {
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      return null;
    case 'int':
    case 'float': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return null;
      if (def.min !== undefined && n < def.min) return null;
      if (def.max !== undefined && n > def.max) return null;
      return def.type === 'int' ? Math.round(n) : n;
    }
    case 'choice': {
      if (typeof raw !== 'string') return null;
      return def.options?.some((o) => o.value === raw) ? raw : null;
    }
    case 'text': {
      if (typeof raw !== 'string') return null;
      return raw.slice(0, Math.min(def.maxLength ?? TEXT_CEILING, TEXT_CEILING));
    }
  }
}

/** Every tunable of an entry, resolved: stored value where valid, else the default. */
export function resolveTunables(
  defs: WorkflowTunable[] | undefined,
  stored: Record<string, unknown> | null | undefined
): Record<string, TunableValue> {
  const out: Record<string, TunableValue> = {};
  for (const def of defs ?? []) {
    out[def.id] = coerceTunable(def, stored?.[def.id]) ?? def.default;
  }
  return out;
}

/**
 * Why `raw` is not an acceptable value for `def`, in Thai, or null when it is.
 * The admin API uses this to refuse a save instead of silently storing a value
 * that every job would then ignore.
 */
export function tunableError(def: WorkflowTunable, raw: unknown): string | null {
  if (coerceTunable(def, raw) !== null) return null;
  switch (def.type) {
    case 'bool':
      return `${def.label}: ต้องเป็นเปิดหรือปิด`;
    case 'int':
    case 'float': {
      const range =
        def.min !== undefined && def.max !== undefined
          ? ` ระหว่าง ${def.min}–${def.max}`
          : def.min !== undefined
            ? ` ตั้งแต่ ${def.min}`
            : def.max !== undefined
              ? ` ไม่เกิน ${def.max}`
              : '';
      return `${def.label}: ต้องเป็นตัวเลข${range}`;
    }
    case 'choice':
      return `${def.label}: ต้องเลือกจากตัวเลือกที่มี`;
    case 'text':
      return `${def.label}: ต้องเป็นข้อความ`;
  }
}

/**
 * Typed reads of a job's resolved tunables, for an entry's bind/inject.
 *
 * `tuning` on the job carries only what the queue resolved; anything missing
 * (an older payload, a unit test) falls back to the definition's default, so a
 * bind function never has to repeat a default the definition already states.
 */
export function tunableReader(defs: WorkflowTunable[]) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const read = (tuning: Record<string, unknown> | undefined, id: string): TunableValue => {
    const def = byId.get(id);
    if (!def) throw new Error(`Unknown tunable "${id}"`);
    return coerceTunable(def, tuning?.[id]) ?? def.default;
  };
  return {
    num: (tuning: Record<string, unknown> | undefined, id: string): number => Number(read(tuning, id)),
    str: (tuning: Record<string, unknown> | undefined, id: string): string => String(read(tuning, id)),
    bool: (tuning: Record<string, unknown> | undefined, id: string): boolean => read(tuning, id) === true,
  };
}

/** A value different from the default for every tunable, to see what each one moves. */
export function alternativeTunables(defs: WorkflowTunable[] | undefined): Record<string, TunableValue> {
  const out: Record<string, TunableValue> = {};
  for (const def of defs ?? []) {
    switch (def.type) {
      case 'bool':
        out[def.id] = def.default !== true;
        break;
      case 'int':
      case 'float': {
        const step = def.step ?? 1;
        const up = Number(def.default) + step;
        const candidate = def.max !== undefined && up > def.max ? Number(def.default) - step : up;
        out[def.id] = coerceTunable(def, candidate) ?? def.default;
        break;
      }
      case 'choice':
        out[def.id] = def.options?.find((o) => o.value !== def.default)?.value ?? def.default;
        break;
      case 'text':
        out[def.id] = `${String(def.default)} (x)`;
        break;
    }
  }
  return out;
}

/** Samplers ComfyUI's KSampler / KSamplerSelect offer that make sense to switch between. */
export const SAMPLER_OPTIONS = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_3m_sde',
  'dpmpp_sde',
  'uni_pc',
  'lcm',
  'res_multistep',
  'er_sde',
].map((value) => ({ value, label: value }));

export const SCHEDULER_OPTIONS = [
  'simple',
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'beta',
  'linear_quadratic',
  'kl_optimal',
].map((value) => ({ value, label: value }));
