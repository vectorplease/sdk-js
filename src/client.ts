import { VectorPleaseError } from './errors';
import type { Conversion, ConversionParams, PendingConversion, Preset } from './types';

export const DEFAULT_BASE_URL = 'https://api.vectorplease.com';

export interface ClientOptions {
  /** Defaults to the VECTORPLEASE_API_KEY environment variable. */
  apiKey?: string;
  baseUrl?: string;
  /** Retries for rate limits, server errors and network failures. Default 2. */
  maxRetries?: number;
  /** How often to poll a pending conversion. Default 1000 ms. */
  pollIntervalMs?: number;
  /** How long `convert` waits for a result in total. Default 120 000 ms. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Replaceable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type ImageInput = Uint8Array | ArrayBuffer | string;

export interface ConvertInput {
  /** The PNG, JPEG or WebP file: bytes, or a base64 string. */
  image: ImageInput;
  /** A preset name from `listPresets()`. Explicit `params` override it. */
  preset?: string;
  params?: ConversionParams;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const toBase64 = (image: ImageInput): string => {
  if (typeof image === 'string') return image;
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
};

const isPending = (body: Conversion | PendingConversion): body is PendingConversion =>
  body.status === 'pending';

export class VectorPlease {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #maxRetries: number;
  readonly #pollIntervalMs: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  #presets: Promise<Preset[]> | undefined;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env['VECTORPLEASE_API_KEY'];
    if (!apiKey) {
      throw new VectorPleaseError('Pass apiKey or set VECTORPLEASE_API_KEY', {
        code: 'unauthorized',
      });
    }
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#maxRetries = options.maxRetries ?? 2;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Converts an image and waits for the result, polling if the API answers 202. */
  async convert(input: ConvertInput): Promise<Conversion> {
    const params = await this.#resolveParams(input);
    const body = { image: { base64: toBase64(input.image) }, ...(params ? { params } : {}) };
    // POST is retried only on 429: any other failure may already have created a conversion.
    const first = await this.#request<Conversion | PendingConversion>('POST', '/v1/conversions', {
      body,
      retryOn: new Set([429]),
    });
    return isPending(first) ? this.waitForConversion(first.id) : first;
  }

  getConversion(id: string): Promise<Conversion | PendingConversion> {
    return this.#request('GET', `/v1/conversions/${encodeURIComponent(id)}`);
  }

  /** Polls until the conversion is finished, or throws a `timeout` error. */
  async waitForConversion(id: string, timeoutMs = this.#timeoutMs): Promise<Conversion> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await this.getConversion(id);
      if (!isPending(current)) return current;
      if (Date.now() + this.#pollIntervalMs > deadline) {
        throw new VectorPleaseError(`Conversion ${id} did not finish within ${timeoutMs} ms`, {
          code: 'timeout',
        });
      }
      await this.#sleep(this.#pollIntervalMs);
    }
  }

  async listPresets(): Promise<Preset[]> {
    const { presets } = await this.#request<{ presets: Preset[] }>('GET', '/v1/presets');
    return presets;
  }

  async #resolveParams(input: ConvertInput): Promise<ConversionParams | undefined> {
    if (!input.preset) return input.params;
    this.#presets ??= this.listPresets();
    const preset = (await this.#presets).find((p) => p.name === input.preset);
    if (!preset) {
      this.#presets = undefined;
      throw new VectorPleaseError(`Unknown preset "${input.preset}"`, { code: 'invalid_request' });
    }
    return { ...preset.params, ...input.params };
  }

  async #request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; retryOn?: Set<number> } = {},
  ): Promise<T> {
    const retryOn = options.retryOn ?? RETRYABLE_STATUS;
    const retryNetwork = method === 'GET';
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(`${this.#baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch (cause) {
        if (retryNetwork && attempt < this.#maxRetries) {
          await this.#sleep(this.#backoff(attempt));
          continue;
        }
        throw new VectorPleaseError(`Could not reach the Vector, Please API`, {
          code: 'network_error',
          cause,
        });
      }

      if (res.ok) return (await res.json()) as T;

      if (retryOn.has(res.status) && attempt < this.#maxRetries) {
        await this.#sleep(this.#retryAfter(res) ?? this.#backoff(attempt));
        continue;
      }
      throw await this.#error(res);
    }
  }

  #backoff(attempt: number): number {
    return Math.min(8000, 500 * 2 ** attempt);
  }

  #retryAfter(res: Response): number | undefined {
    const header = res.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    return Number.isFinite(seconds) ? Math.min(60_000, seconds * 1000) : undefined;
  }

  async #error(res: Response): Promise<VectorPleaseError> {
    const body = (await res.json().catch(() => undefined)) as
      { error?: { code?: VectorPleaseError['code']; message?: string } } | undefined;
    return new VectorPleaseError(body?.error?.message ?? `HTTP ${res.status}`, {
      status: res.status,
      code: body?.error?.code ?? 'unknown',
    });
  }
}
