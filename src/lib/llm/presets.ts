import type { LlmModelConfig } from './pricing';

/**
 * Starting rows for the admin's "เพิ่ม DeepSeek" button. Costs are DeepSeek's
 * peak rates as published around 2026-10 (off-peak is half); the upstream ids
 * are what its API answered to then. Both are the admin's to correct on
 * /admin/llm — DeepSeek renames models between releases.
 */
export interface LlmPreset {
  modelId: string;
  name: string;
  description: string;
  cfg: Omit<LlmModelConfig, 'inputCreditsPerMTok' | 'outputCreditsPerMTok'>;
}

export const DEEPSEEK_PROVIDER = {
  slug: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  website: 'https://platform.deepseek.com',
};

export const DEEPSEEK_PRESETS: LlmPreset[] = [
  {
    modelId: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    description: 'โมเดลเร็วและถูกของ DeepSeek • เขียนโค้ดและงานทั่วไป',
    cfg: {
      backend: 'upstream',
      upstreamModel: 'deepseek-flash',
      inputUsdPerMTok: 0.3,
      outputUsdPerMTok: 1.2,
      contextLength: 131_072,
      maxOutputTokens: 32_768,
    },
  },
  {
    modelId: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'โมเดลใหญ่ที่สุดของ DeepSeek • งานโค้ดยากและการให้เหตุผลยาว',
    cfg: {
      backend: 'upstream',
      upstreamModel: 'deepseek-v4-pro',
      inputUsdPerMTok: 1.32,
      outputUsdPerMTok: 3.96,
      contextLength: 131_072,
      maxOutputTokens: 32_768,
    },
  },
];

/** Default markup over cost for a new row's sale price. */
export const DEFAULT_MARKUP = 2;

/**
 * A sale price in credits per million tokens for a USD cost: the markup, at
 * what a credit is worth (gpu-stats pricingBasis), rounded up to 0.1.
 */
export function salePrice(usdPerMTok: number, usdToThb: number, thbPerCredit: number, markup = DEFAULT_MARKUP): number {
  const perCredit = thbPerCredit > 0 ? thbPerCredit : 1;
  return Math.ceil(((usdPerMTok * markup * usdToThb) / perCredit) * 10) / 10;
}
