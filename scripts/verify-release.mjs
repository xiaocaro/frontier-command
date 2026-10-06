import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const target = mkdtempSync(join(tmpdir(), 'frontier-release-'));
execFileSync(
  'tar.exe',
  ['-xf', resolve(`release/Frontier-Command-${version}-win-x64.zip`), '-C', target],
  { stdio: 'inherit' },
);
execFileSync(process.execPath, ['scripts/smoke-package.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FRONTIER_EXECUTABLE: join(target, 'win-unpacked', 'Frontier Command.exe'),
  },
});
console.log('PASS: ZIP extracted to a fresh directory and verified.');
