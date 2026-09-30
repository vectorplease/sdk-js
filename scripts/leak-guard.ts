// Fails if any tracked file names a private package or the private repository.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findLeaks } from './leak-rules';

const SELF = ['scripts/leak-rules.ts', 'scripts/leak-guard.ts', 'test/leak-rules.test.ts'];
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file && !SELF.includes(file));

const leaks = files.flatMap((file) => {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) return []; // binary
  return findLeaks(file, buffer.toString('utf8'));
});

if (leaks.length > 0) {
  console.error('Private names found in a public repository:');
  for (const leak of leaks) console.error(`  ${leak.file}:${leak.line}  ${leak.match}`);
  process.exit(1);
}
console.log(`Leak guard: ${files.length} files clean.`);
