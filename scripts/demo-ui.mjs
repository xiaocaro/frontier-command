/**
 * `npm run demo:ui [-- --pace=2]` (docs/lv3/10-agent-demo-channel.md §6).
 *
 * A thin launcher rather than a one-line npm script, for the same reason `demo-live.mjs` is one:
 * Playwright **rejects unknown command-line options**, so the spec cannot read `--pace` from `argv`.
 * This validates it and hands it over as an environment variable, which also sidesteps the Windows
 * problem that `VAR=value cmd` is not a thing.
 *
 * The pace exists because a demo has an audience. The default reads well on one screen; a room, a
 * projector or a first-time viewer needs it slower, and someone re-recording a short clip wants it
 * faster. It scales every deliberate pause — before an action is issued, and after a result lands
 * before the next step begins — and leaves the *polling* timeouts alone, because those are ceilings
 * on how long a model may take, not beats in the performance.
 */
import { spawn } from 'node:child_process';

const arg = process.argv.slice(2).find((value) => value.startsWith('--pace='));
const DEFAULT_PACE = '10';
const pace = arg ? arg.slice('--pace='.length) : DEFAULT_PACE;
const value = Number(pace);

if (!Number.isFinite(value) || value < 0.25 || value > 10) {
  console.error('--pace 需要一个 0.25 到 10 之间的数（收到 ' + JSON.stringify(pace) + '）');
  console.error('  10（默认，也是上限）适合有观众的演示；1 适合一个人快速看；0.5 适合反复重跑');
  process.exit(2);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';
const env = { ...process.env, DEMO_PACE: String(value) };

console.log('[demo:ui] 演示节奏 ×' + value + '（每一步的停顿按这个倍率缩放）');
if (!process.env.DEEPSEEK_API_KEY)
  console.log('[demo:ui] 未检测到 DEEPSEEK_API_KEY —— 应用会走确定性模式；要看真模型请先设置它');

const build = spawn(npm, ['run', 'build'], { stdio: 'inherit', shell, env });
build.on('exit', (code) => {
  if (code) process.exit(code);
  const demo = spawn(
    npm,
    ['exec', 'playwright', '--', 'test', '--config', 'playwright.demo.config.ts'],
    { stdio: 'inherit', shell, env },
  );
  demo.on('exit', (demoCode) => process.exit(demoCode ?? 1));
});
