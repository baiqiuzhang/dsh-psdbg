import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { BRIDGE_ROOT } from './config.mjs';
import { PsError } from './ps-jsx.mjs';
import { photoshopProcesses } from './process.mjs';

const SCRIPT = path.join(BRIDGE_ROOT, 'src', 'ps1', 'uia.ps1');

function runUia(args) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = (r.stdout || '').trim();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PsError(`UIA returned non-JSON: ${(r.stderr || text).slice(0, 1000)}`, 'UIA_ERROR', { exit: r.status });
  }
  if (!json.ok) {
    throw new PsError(json.message || json.code || 'UIA failed', json.code || 'UIA_ERROR', json);
  }
  return json;
}

function defaultHandle(handle) {
  if (handle) return Number(handle);
  const procs = photoshopProcesses();
  const h = procs[0]?.MainWindowHandle;
  if (!h) throw new PsError('Photoshop main window not found', 'PS_NOT_RUNNING');
  return Number(h);
}

export function listControls(opts = {}) {
  const args = ['-Action', 'list', '-Handle', String(defaultHandle(opts.handle)), '-MaxNodes', String(opts.maxNodes || 300)];
  if (opts.name) args.push('-Name', opts.name);
  if (opts.className) args.push('-Class', opts.className);
  return runUia(args);
}

export function invokeControl(opts = {}) {
  if (!opts.yes) throw new PsError('UIA invoke is state-changing; pass --yes', 'CONFIRM_REQUIRED');
  if (!opts.handle) throw new PsError('window handle is required', 'USAGE');
  if (!opts.name) throw new PsError('--name is required', 'USAGE');
  return runUia(['-Action', 'invoke', '-Handle', String(opts.handle), '-Name', opts.name]);
}

export function setControl(opts = {}) {
  if (!opts.yes) throw new PsError('UIA set is state-changing; pass --yes', 'CONFIRM_REQUIRED');
  if (!opts.handle) throw new PsError('window handle is required', 'USAGE');
  if (!opts.name) throw new PsError('--name is required', 'USAGE');
  if (opts.value === undefined) throw new PsError('--value is required', 'USAGE');
  return runUia(['-Action', 'set', '-Handle', String(opts.handle), '-Name', opts.name, '-Value', String(opts.value)]);
}
