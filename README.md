# @vectorplease/sdk

TypeScript client for the Vector, Please API: bitmap in, sticker-ready SVG out.

Status: pre-release. Not yet published to npm.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { VectorPlease } from '@vectorplease/sdk';

const vp = new VectorPlease(); // reads VECTORPLEASE_API_KEY
const result = await vp.convert({ image: await readFile('logo.png'), preset: 'logo' });

if (result.status === 'failed') console.warn('Missed a quality check:', result.failures);
if (result.svg) await writeFile('logo.svg', result.svg);
```

- `convert({ image, preset?, params? })` waits for the result, polling if the API is still working.
- `getConversion(id)`, `waitForConversion(id)`, `listPresets()`.
- Rate limits and server errors on reads are retried with backoff. A conversion request is retried
  only on `429`, because any other failure may already have started a conversion.
- Failures throw `VectorPleaseError` with `status` and `code`.

Node 22 or newer. The client uses the global `fetch`; pass your own with `fetch`.

## Development

Types are generated from `openapi/openapi.json`, which is updated by an automated PR from the API.
Contract tests run the client against a mock server built from that file.

## License

MIT
