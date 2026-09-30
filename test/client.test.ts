import { describe, expect, it, vi } from 'vitest';
import { VectorPlease, VectorPleaseError, type Conversion } from '../src/index';

const conversion: Conversion = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'succeeded',
  svg: '<svg/>',
  metrics: {
    width: 1,
    height: 1,
    ssim: 0.97,
    pathCount: 1,
    nodeCount: 4,
    outerContourCount: 1,
    bytes: 6,
  },
  failures: [],
};
const pending = { id: conversion.id, status: 'pending' };
const presets = {
  presets: [
    { name: 'logo', description: 'Logos', params: { paletteSize: 6, cornerThreshold: 60 } },
  ],
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** A fetch that answers from a script and records every request. */
function scripted(...replies: Reply[]) {
  const requests: Array<{ method: string; url: string; headers: Headers; body: unknown }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      method: init?.method ?? 'GET',
      url: String(url),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

const client = (fetch: typeof globalThis.fetch, extra = {}) =>
  new VectorPlease({
    apiKey: 'vp_test_key',
    baseUrl: 'https://api.test/',
    fetch,
    sleep: async () => {},
    ...extra,
  });

describe('VectorPlease', () => {
  it('needs an API key', () => {
    const saved = process.env['VECTORPLEASE_API_KEY'];
    delete process.env['VECTORPLEASE_API_KEY'];
    expect(() => new VectorPlease()).toThrow(/VECTORPLEASE_API_KEY/);
    process.env['VECTORPLEASE_API_KEY'] = 'vp_test_env';
    expect(() => new VectorPlease()).not.toThrow();
    if (saved === undefined) delete process.env['VECTORPLEASE_API_KEY'];
    else process.env['VECTORPLEASE_API_KEY'] = saved;
  });

  it('converts bytes: base64 body, bearer key, trailing slash removed', async () => {
    const { fetch, requests } = scripted({ status: 200, body: conversion });

    const result = await client(fetch).convert({
      image: new Uint8Array([1, 2, 3]),
      params: { borderWidth: 4 },
    });

    expect(result).toEqual(conversion);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.test/v1/conversions',
      body: { image: { base64: 'AQID' }, params: { borderWidth: 4 } },
    });
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer vp_test_key');
  });

  it('accepts a base64 string or an ArrayBuffer', async () => {
    const { fetch, requests } = scripted(
      { status: 200, body: conversion },
      { status: 200, body: conversion },
    );
    await client(fetch).convert({ image: 'AQID' });
    await client(fetch).convert({ image: new Uint8Array([1, 2, 3]).buffer });
    expect(requests.map((r) => (r.body as { image: { base64: string } }).image.base64)).toEqual([
      'AQID',
      'AQID',
    ]);
    expect(requests[0]?.body).not.toHaveProperty('params');
  });

  it('polls a 202 until the conversion is finished', async () => {
    const { fetch, requests } = scripted(
      { status: 202, body: pending },
      { status: 202, body: pending },
      { status: 200, body: conversion },
    );
    expect(await client(fetch).convert({ image: 'AQID' })).toEqual(conversion);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST https://api.test/v1/conversions',
      `GET https://api.test/v1/conversions/${conversion.id}`,
      `GET https://api.test/v1/conversions/${conversion.id}`,
    ]);
  });

  it('gives up polling after the timeout', async () => {
    const { fetch } = scripted({ status: 202, body: pending }, { status: 202, body: pending });
    await expect(
      client(fetch, { timeoutMs: 10, pollIntervalMs: 50 }).convert({ image: 'AQID' }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('merges a preset under explicit params, fetching presets once', async () => {
    const { fetch, requests } = scripted(
      { status: 200, body: presets },
      { status: 200, body: conversion },
      { status: 200, body: conversion },
    );
    const vp = client(fetch);
    await vp.convert({ image: 'AQID', preset: 'logo', params: { paletteSize: 3 } });
    await vp.convert({ image: 'AQID', preset: 'logo' });
    expect(requests.map((r) => r.body)).toEqual([
      undefined,
      { image: { base64: 'AQID' }, params: { paletteSize: 3, cornerThreshold: 60 } },
      { image: { base64: 'AQID' }, params: { paletteSize: 6, cornerThreshold: 60 } },
    ]);
  });

  it('rejects an unknown preset', async () => {
    const { fetch } = scripted({ status: 200, body: presets });
    await expect(client(fetch).convert({ image: 'AQID', preset: 'nope' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('retries GETs on server errors and network failures', async () => {
    const { fetch, requests } = scripted(
      new TypeError('socket hang up'),
      { status: 503 },
      { status: 200, body: conversion },
    );
    expect(await client(fetch).getConversion(conversion.id)).toEqual(conversion);
    expect(requests).toHaveLength(3);
  });

  it('retries a POST only on 429, honouring Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    const { fetch } = scripted(
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 200, body: conversion },
    );
    await client(fetch, { sleep }).convert({ image: 'AQID' });
    expect(sleep).toHaveBeenCalledWith(2000);

    const failing = scripted({
      status: 500,
      body: { error: { code: 'internal_error', message: 'boom' } },
    });
    await expect(client(failing.fetch).convert({ image: 'AQID' })).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
    });
    expect(failing.requests).toHaveLength(1);
  });

  it('does not retry a POST after a network failure, which may have created a conversion', async () => {
    const { fetch, requests } = scripted(new TypeError('reset'));
    await expect(client(fetch).convert({ image: 'AQID' })).rejects.toMatchObject({
      code: 'network_error',
    });
    expect(requests).toHaveLength(1);
  });

  it('stops retrying after maxRetries', async () => {
    const { fetch, requests } = scripted({ status: 503 }, { status: 503 }, { status: 503 });
    await expect(client(fetch, { maxRetries: 1 }).getConversion('x')).rejects.toMatchObject({
      status: 503,
    });
    expect(requests).toHaveLength(2);
  });

  it('turns API errors into VectorPleaseError with the API code and message', async () => {
    const { fetch } = scripted({
      status: 422,
      body: { error: { code: 'empty_image', message: 'The image has no visible pixels' } },
    });
    const error = await client(fetch)
      .convert({ image: 'AQID' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VectorPleaseError);
    expect(error).toMatchObject({
      status: 422,
      code: 'empty_image',
      message: 'The image has no visible pixels',
    });
  });
});
