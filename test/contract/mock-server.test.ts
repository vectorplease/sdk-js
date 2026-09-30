import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VectorPlease, VectorPleaseError } from '../../src/index';

// Contract tests: the client against Prism, a mock server built from openapi/openapi.json.
// Prism answers from the spec and rejects any request the spec does not allow.

let prism: ChildProcess;
let baseUrl: string;

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  prism = spawn(
    'pnpm',
    ['exec', 'prism', 'mock', 'openapi/openapi.json', '--port', String(port), '--errors'],
    {
      stdio: 'pipe',
    },
  );
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`${baseUrl}/v1/presets`).then(
      () => true,
      () => false,
    );
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Prism did not start');
}, 30_000);

afterAll(() => {
  prism?.kill();
});

const client = () => new VectorPlease({ apiKey: 'vp_test_contract', baseUrl, maxRetries: 0 });

describe('contract with openapi.json', () => {
  it('converts an image with a request the spec accepts and a response it describes', async () => {
    const result = await client().convert({ image: 'iVBORw0KGgo=', params: { borderWidth: 8 } });
    expect(result).toHaveProperty('metrics.ssim');
    expect(['succeeded', 'failed']).toContain(result.status);
  });

  it('lists presets', async () => {
    const presets = await client().listPresets();
    expect(Array.isArray(presets)).toBe(true);
  });

  it('gets a conversion by id', async () => {
    const result = await client().getConversion('11111111-1111-4111-8111-111111111111');
    expect(result).toHaveProperty('status');
  });

  it('is refused by the spec when a parameter is out of range', async () => {
    const error = await client()
      .convert({ image: 'iVBORw0KGgo=', params: { paletteSize: 999 } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VectorPleaseError);
    expect((error as VectorPleaseError).status).toBe(422);
  });

  it('is refused without an API key', async () => {
    const res = await fetch(`${baseUrl}/v1/presets`);
    expect(res.status).toBe(401);
  });
});
