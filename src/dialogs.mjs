import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BRIDGE_ROOT } from './config.mjs';
import { PsError } from './ps-jsx.mjs';

const SCRIPT = path.join(BRIDGE_ROOT, 'src', 'ps1', 'dialogs.ps1');

function run(args) {
  const p = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  const raw = (p.stdout || '').trim();
  if (!raw) {
    throw new PsError(`dialog helper failed: ${p.error?.message || p.stderr || 'no output'}`, 'DIALOG_HELPER');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new PsError(`dialog helper returned non-JSON: ${raw.slice(0, 500)}`, 'DIALOG_HELPER');
  }
}

export function listDialogs() {
  return run(['-List']);
}

export function dismissDialog(handle) {
  if (!Number.isFinite(Number(handle)) || Number(handle) === 0) {
    throw new PsError('dismissDialog requires a window handle', 'USAGE');
  }
  return run(['-Handle', String(handle)]);
}

export function dismissAllDialogs() {
  return run(['-All']);
}
