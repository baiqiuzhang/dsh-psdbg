import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { launcherPath, photoshopExe } from './config.mjs';
import { photoshopProcesses } from './process.mjs';
import { PsError } from './ps-jsx.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForPhotoshop(timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const p = photoshopProcesses().find((x) => Number(x.MainWindowHandle) !== 0);
    if (p) return p;
    await sleep(500);
  }
  throw new PsError('Photoshop main window did not appear', 'PS_START_TIMEOUT');
}

export async function startPhotoshop(opts = {}) {
  const current = photoshopProcesses().find((x) => Number(x.MainWindowHandle) !== 0);
  if (current) return { started: false, existing: true, process: current };

  const doc = opts.file || '';
  if (doc && !fs.existsSync(doc)) throw new PsError(`file not found: ${doc}`, 'FILE_NOT_FOUND');

  const launcher = opts.launcher || launcherPath();
  const useLauncher = fs.existsSync(launcher) && !opts.noLauncher;
  let child;
  if (useLauncher) {
    const script = doc ? `& '${launcher.replace(/'/g, "''")}' -File '${doc.replace(/'/g, "''")}'` : `& '${launcher.replace(/'/g, "''")}'`;
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    const args = doc ? [doc] : [];
    child = spawn(photoshopExe(), args, { detached: true, stdio: 'ignore', windowsHide: false });
  }
  child.unref();

  const p = await waitForPhotoshop(opts.timeoutMs ?? 120000);
  return { started: true, existing: false, process: p, launcher: useLauncher ? launcher : null };
}
