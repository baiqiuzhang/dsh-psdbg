import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_ROOT, TMP_DIR, ensureDirs } from './config.mjs';
import { PsError } from './ps-jsx.mjs';

const SCRIPT = path.join(BRIDGE_ROOT, 'src', 'ps1', 'screenshot.ps1');

export function captureScreenshot(opts = {}) {
  ensureDirs();
  const out = opts.out || path.join(TMP_DIR, `ps-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT,
    '-Out', out,
  ];
  if (opts.pid) args.push('-ProcessId', String(opts.pid));
  if (opts.windowTitle) args.push('-WindowTitle', opts.windowTitle);
  if (opts.windowHandle) args.push('-WindowHandle', String(opts.windowHandle));
  if (opts.fullScreen) args.push('-FullScreen');
  if (opts.screenCrop) args.push('-ScreenCrop');

  const r = spawnSync('powershell.exe', args, {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new PsError(`screenshot failed: ${(r.stderr || '').slice(0, 1000)}`, 'SCREENSHOT_FAILED', {
      exit: r.status,
      stdout: r.stdout,
    });
  }
  try {
    return JSON.parse((r.stdout || '').trim());
  } catch {
    return { ok: true, path: out };
  }
}
