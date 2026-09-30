import { describe, expect, it } from 'vitest';
import { findLeaks } from '../scripts/leak-rules';

describe('findLeaks', () => {
  it('allows the public packages', () => {
    expect(
      findLeaks('a.ts', "import { VectorPlease } from '@vectorplease/sdk';\n'@vectorplease/mcp'"),
    ).toEqual([]);
  });

  it.each([
    '@vectorplease/core',
    '@vectorplease/ai',
    '@vectorplease/contracts',
    '@vectorplease/some-new-thing',
  ])('flags %s with its line', (name) => {
    expect(findLeaks('src/x.ts', `ok\nimport x from '${name}';`)).toEqual([
      { file: 'src/x.ts', line: 2, match: name },
    ]);
  });

  it('flags the private repository', () => {
    expect(findLeaks('README.md', 'see github.com/vectorplease/vectorplease')).toHaveLength(1);
    expect(findLeaks('README.md', 'see github.com/vectorplease/sdk-js')).toEqual([]);
  });

  it('does not treat @vectorplease/sdk-extras as the public sdk', () => {
    expect(findLeaks('a.ts', '@vectorplease/sdk-extras')).toHaveLength(1);
  });
});
