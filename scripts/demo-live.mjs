/**
 * `npm run demo:live [-- --speed=16]` (docs/lv3/10-agent-demo-channel.md §5).
 *
 * A thin launcher rather than a plain `vitest` script, for one reason: the demonstration needs to know
 * the **simulation speed**, and vitest rejects unknown command-line options — so `--speed=16` cannot be
 * read inside the test file. This reads it, validates it, and hands it over as an environment variable,
 * which also avoids the Windows problem where `VAR=value cmd` is not a thing.
 *
 * The speed matters because of `KNOWN_ISSUES.md` `C-36`: a decision is dropped when the world has moved
 * too far between the observation and the drain, and how far that is in real time depends entirely on
 * the speed. Running the demo at 16× is the only way to see whether that is actually true in practice
 * rather than only in a unit test.
 */
import { spawn } from 'node:child_process';

const SPEEDS = ['1', '4', '16'];
const arg = process.argv.slice(2).find((value) => value.startsWith('--speed='));
const speed = arg ? arg.slice('--speed='.length) : '1';

if (!SPEEDS.includes(speed)) {
  console.error('--speed 只能是 ' + SPEEDS.join(' / ') + '（收到 ' + JSON.stringify(speed) + '）');
  process.exit(2);
}

console.log('[demo:live] 仿真速度 ' + speed + '×' + (speed === '1' ? '' : '（用于检验 C-36 的缩放）'));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(
  npm,
  ['exec', 'vitest', '--', 'run', '--config', 'vitest.live.config.ts', '--reporter=verbose', '--silent=false'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DEMO_SPEED: speed },
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
