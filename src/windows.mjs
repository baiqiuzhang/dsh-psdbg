import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { BRIDGE_ROOT } from './config.mjs';
import { PsError } from './ps-jsx.mjs';

const SCRIPT = path.join(BRIDGE_ROOT, 'src', 'ps1', 'windows.ps1');

export function findPsWindows(opts = {}) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];
  if (opts.titleMatch) args.push('-TitleMatch', opts.titleMatch);
  if (opts.all) args.push('-All');
  const r = spawnSync('powershell.exe', args, {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const text = (r.stdout || '').trim();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PsError(`window enumeration failed: ${(r.stderr || text).slice(0, 1000)}`, 'WINDOW_ENUM_FAILED', {
      exit: r.status,
      stdout: text,
    });
  }
  if (!json.ok) {
    throw new PsError(json.error || 'window enumeration failed', 'WINDOW_ENUM_FAILED', json);
  }
  return json;
}

export function findPluginPanelWindow(titleMatch) {
  const r = findPsWindows({ titleMatch });
  const windows = r.windows || [];
  if (windows.length === 0) {
    throw new PsError('no floating Photoshop panel window found', 'PANEL_WINDOW_NOT_FOUND', {
      hint: 'Open the UXP panel first (psdbg panels list), or pass --full for the whole screen.',
    });
  }
  return { ...r, window: windows[0] };
}
