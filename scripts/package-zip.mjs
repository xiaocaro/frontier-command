import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const filename = `Frontier-Command-${version}-win-x64.zip`;
const archive = resolve('release', filename);
if (!existsSync('release/win-unpacked/Frontier Command.exe'))
  throw Error('Run npm run package first.');
execFileSync('tar.exe', ['-a', '-cf', archive, '-C', resolve('release'), 'win-unpacked'], {
  stdio: 'inherit',
});
const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${hash}  ${filename}\n`);
console.log(`Created ${archive}\nSHA256 ${hash}`);
