/**
 * An order refused before any credit moved, with Thai the customer can act
 * on. The routes pass `message` through unchanged, with `httpStatus`; any
 * other error from GenerationService stays a generic failure, because its
 * text is technical.
 */
export class OrderRefusedError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = 'OrderRefusedError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isOrderRefused(error: unknown): error is OrderRefusedError {
  return error instanceof OrderRefusedError || (error as { name?: unknown } | null)?.name === 'OrderRefusedError';
}
