import { raiseAlert } from '@/lib/notify/alerts';

/**
 * Telegram alerts for the LLM API (`llm-upstream`, `no-accounts`). Counts are
 * per process, like rate-limit.ts (`instances: 1`).
 */

/** Failures in a row before anyone is told. A single 5xx is DeepSeek being DeepSeek. */
export const FAILURE_STREAK_ALERT = 5;

const streaks = new Map<string, number>();

/** One request's outcome at a backend (a provider slug, or `gpu:<model key>`). */
export function noteBackendResult(backend: string, modelName: string, ok: boolean, detail = ''): void {
  if (ok) {
    streaks.delete(backend);
    return;
  }
  const n = (streaks.get(backend) ?? 0) + 1;
  streaks.set(backend, n);
  if (n < FAILURE_STREAK_ALERT) return;
  raiseAlert({
    type: 'llm-upstream',
    key: backend,
    level: 'critical',
    title: `API โมเดลภาษา: ${modelName} ล้มติดกัน ${n} ครั้ง — ลูกค้าเรียกใช้ไม่ได้ (ไม่หักเครดิต)`,
    lines: [
      detail.slice(0, 300),
      backend.startsWith('gpu:')
        ? 'ดูเครื่องที่หน้า API โมเดลภาษา → รันเองบน GPU (log อยู่ที่หน้า GPU ที่เช่า)'
        : 'ตรวจคีย์ / ยอดเงินของผู้ให้บริการที่ Account Pools',
    ],
    path: '/admin/llm',
  });
}

/** A request found no usable key in the pool for this provider. */
export function noteNoAccount(providerSlug: string, modelName: string): void {
  raiseAlert({
    type: 'no-accounts',
    key: `llm:${providerSlug}`,
    level: 'critical',
    title: `API โมเดลภาษา: ${modelName} ไม่มีคีย์ที่ใช้ได้ — ลูกค้าเรียกใช้ไม่ได้`,
    lines: [
      `ผู้ให้บริการ ${providerSlug}: ไม่มีคีย์ หรือทุกคีย์ติด cooldown / โควตาหมด`,
      'เพิ่มคีย์ หรือตั้งโควตารายวันเป็น 0 ที่ Account Pools',
    ],
    path: '/admin/pools',
  });
}
