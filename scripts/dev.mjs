import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const compile = spawn(npm, ['exec', 'tsc', '--', '-p', 'tsconfig.electron.json'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
compile.on('exit', async (code) => {
  if (code) process.exit(code);
  const server = await createServer();
  await server.listen();
  // ELECTRON_RUN_AS_NODE (set by VS Code's extension host, among others) makes the
  // electron binary boot as plain Node, so `require('electron')` returns the npm
  // package instead of the runtime and the app crashes on `protocol`.
  const env = { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['.'], { stdio: 'inherit', env });
  child.on('exit', async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });
});
