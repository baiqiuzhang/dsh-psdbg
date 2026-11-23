import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_ROOT } from './config.mjs';
import { photoshopProcesses } from './process.mjs';
import { PsError, runJsx } from './ps-jsx.mjs';
import { startPhotoshop } from './start.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getStatus() {
  return (await runJsx(fs.readFileSync(path.join(BRIDGE_ROOT, 'src', 'jsx', 'status.jsx'), 'utf8'))).data;
}

export function unsavedDocuments(status) {
  return (status?.documents || []).filter((d) => d.saved !== true);
}

export async function closePhotoshop(opts = {}) {
  const procs = photoshopProcesses();
  if (!procs.length) return { closed: false, reason: 'not running' };
  if (!opts.force && !opts.noSave) {
    let status;
    try { status = await getStatus(); } catch { status = null; }
    const unsaved = unsavedDocuments(status);
    if (unsaved.length) {
      throw new PsError(
        `Photoshop has ${unsaved.length} unsaved document(s); refusing to close`,
        'PS_UNSAVED_DOCUMENTS',
        { documents: unsaved.map((d) => d.name), hint: 'Save them, or pass --no-save only if you explicitly accept data loss.' }
      );
    }
  }

  const main = procs.find((p) => Number(p.MainWindowHandle) !== 0) || procs[0];
  const pid = Number(main.Id);
  const r = spawnSync('taskkill.exe', ['/PID', String(pid)], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  const t0 = Date.now();
  while (Date.now() - t0 < (opts.timeoutMs ?? 15000)) {
    if (!photoshopProcesses().some((p) => Number(p.Id) === pid)) return { closed: true, pid };
    await sleep(500);
  }

  if (opts.force) {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/F'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return { closed: true, pid, forced: true };
  }
  throw new PsError(
    'Photoshop did not close; a modal save dialog is probably open',
    'PS_CLOSE_BLOCKED',
    { pid, taskkill: { status: r.status, stdout: r.stdout, stderr: r.stderr }, hint: 'Save manually, or use --force only when data loss is acceptable.' }
  );
}

export async function restartPhotoshop(opts = {}) {
  const closed = await closePhotoshop(opts);
  const started = await startPhotoshop({ file: opts.file, launcher: opts.launcher, timeoutMs: opts.timeoutMs });
  return { closed, started };
}

export async function stopPhotoshop(opts = {}) {
  return closePhotoshop(opts);
}
