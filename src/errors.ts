import type { ErrorCode } from './types';

/** Any failure talking to the API. `status` is undefined for network errors and timeouts. */
export class VectorPleaseError extends Error {
  readonly status: number | undefined;
  readonly code: ErrorCode | 'network_error' | 'timeout' | 'unknown';

  constructor(
    message: string,
    options: { status?: number; code: VectorPleaseError['code']; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'VectorPleaseError';
    this.status = options.status;
    this.code = options.code;
  }
}
