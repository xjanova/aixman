// ============================================================
// Core Types for AIXMAN AI Generation Platform
// ============================================================

export type GenerationType = 'image' | 'video' | 'edit';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type CreditTransactionType = 'purchase' | 'usage' | 'refund' | 'bonus' | 'admin_adjust';
export type PoolRotationMode = 'round_robin' | 'balanced' | 'quota_first';
export type ProviderSlug = 'byteplus' | 'openai' | 'replicate' | 'fal' | 'stability' | 'runway' | 'kling' | 'luma' | 'leonardo';

export interface GenerationRequest {
  modelId: number;
  type: GenerationType;
  prompt: string;
  negativePrompt?: string;
  params?: GenerationParams;
  inputImage?: string; // base64 or URL
  styleId?: number;
}

export interface GenerationParams {
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  duration?: number; // video duration in seconds
  fps?: number;
  aspectRatio?: string;
  numOutputs?: number;
  [key: string]: unknown;
}

export interface GenerationResult {
  id: number;
  status: GenerationStatus;
  resultUrl?: string;
  resultUrls?: string[];
  thumbnailUrl?: string;
  processingMs?: number;
  creditsUsed: number;
  error?: string;
}

export interface ProviderAccount {
  id: number;
  providerId: number;
  label: string;
  apiKey: string;
  apiSecret?: string;
  apiEndpoint?: string;
  isActive: boolean;
  priority: number;
  rateLimitPerMinute: number;
  dailyQuota: number;
  monthlyQuota: number;
  usageToday: number;
  usageThisMonth: number;
  totalUsage: number;
  cooldownUntil?: Date;
  consecutiveErrors: number;
}

export interface ProviderResponse {
  success: boolean;
  jobId?: string;
  resultUrl?: string;
  resultUrls?: string[];
  error?: string;
  costUsd?: number;
  processingMs?: number;
}

// Provider adapter interface — all providers must implement this
export interface AIProviderAdapter {
  readonly slug: ProviderSlug;

  generateImage(params: ProviderGenerateParams): Promise<ProviderResponse>;
  generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse>;
  editImage?(params: ProviderGenerateParams): Promise<ProviderResponse>;
  checkJobStatus?(jobId: string, apiKey: string, apiEndpoint?: string): Promise<ProviderResponse>;
}

export interface ProviderGenerateParams {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  duration?: number;
  fps?: number;
  aspectRatio?: string;
  numOutputs?: number;
  inputImage?: string;
  apiKey: string;
  apiSecret?: string;
  apiEndpoint?: string;
  extraParams?: Record<string, unknown>;
}

// Admin types
export interface DashboardStats {
  totalGenerations: number;
  totalRevenue: number;
  totalCreditsUsed: number;
  activeUsers: number;
  generationsToday: number;
  revenueToday: number;
  providerCosts: number;
  profitMargin: number;
}

export interface PoolStatus {
  id: number;
  label: string;
  provider: string;
  isActive: boolean;
  usageToday: number;
  dailyQuota: number;
  consecutiveErrors: number;
  cooldownUntil?: string;
  lastUsedAt?: string;
}
