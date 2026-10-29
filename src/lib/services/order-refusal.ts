import type { Msg } from '@/lib/i18n/locale';

/**
 * An order refused before any credit moved, in words the customer can act
 * on — given as a `{ th, en }` pair, so the route answers in the visitor's
 * language (`messageFor(error, locale)`). `message` stays the Thai for logs.
 * A plain string is Thai only (older call sites). Any other error from
 * GenerationService stays a generic failure, because its text is technical.
 */
export class OrderRefusedError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly msg: Msg | null;

  constructor(message: Msg | string, code: string, httpStatus: number) {
    super(typeof message === 'string' ? message : message.th);
    this.name = 'OrderRefusedError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.msg = typeof message === 'string' ? null : message;
  }
}

export function isOrderRefused(error: unknown): error is OrderRefusedError {
  return error instanceof OrderRefusedError || (error as { name?: unknown } | null)?.name === 'OrderRefusedError';
}
