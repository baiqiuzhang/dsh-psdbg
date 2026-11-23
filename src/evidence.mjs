import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_ROOT, EVIDENCE_DIR } from './config.mjs';
import { listPanels } from './panels.mjs';
import { photoshopProcesses } from './process.mjs';
import { runJsx } from './ps-jsx.mjs';
import { captureScreenshot } from './screenshot.mjs';
import { collectLogSnapshot } from './logs.mjs';
import { findPluginPanelWindow } from './windows.mjs';

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function slugify(s) {
  return String(s || 'evidence').replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'evidence';
}

export function evidenceDir(name, project) {
  const base = project ? path.join(project, '.dsh', 'ps-debug', 'evidence') : EVIDENCE_DIR;
  const dir = path.join(base, `${stamp()}-${slugify(name)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function captureSnapshot() {
  const out = { ok: true, errors: [] };
  try {
    out.processes = photoshopProcesses();
  } catch (e) { out.errors.push({ step: 'processes', message: e.message }); }
  try {
    out.status = (await runJsx(fs.readFileSync(path.join(BRIDGE_ROOT, 'src', 'jsx', 'status.jsx'), 'utf8'))).data;
  } catch (e) { out.errors.push({ step: 'status', message: e.message, code: e.code }); }
  try {
    out.panels = await listPanels();
  } catch (e) { out.errors.push({ step: 'panels', message: e.message, code: e.code }); }
  return out;
}

export async function createEvidence({ name, project, notes, screenshot = true } = {}) {
  const dir = evidenceDir(name, project);
  const manifest = {
    tool: 'ps-debug-bridge',
    version: '0.2.0',
    createdAt: new Date().toISOString(),
    cwd: process.cwd(),
    name: name || null,
    project: project || null,
    notes: notes || null,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const snapshot = await captureSnapshot();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'logs.json'), JSON.stringify(collectLogSnapshot(80), null, 2), 'utf8');

  if (screenshot) {
    try {
      const shot = captureScreenshot({ out: path.join(dir, 'screen.png') });
      fs.writeFileSync(path.join(dir, 'screenshot.json'), JSON.stringify(shot, null, 2), 'utf8');
    } catch (e) {
      fs.writeFileSync(path.join(dir, 'screenshot-error.txt'), e.message, 'utf8');
    }
    try {
      const found = findPluginPanelWindow();
      const shot = captureScreenshot({
        out: path.join(dir, 'panel.png'),
        pid: found.processId,
        windowHandle: found.window.handle,
        screenCrop: true,
      });
      fs.writeFileSync(path.join(dir, 'panel.json'), JSON.stringify({ ...shot, panel: found.window }, null, 2), 'utf8');
    } catch (e) {
      // No floating panel is a normal state for native/classic plug-ins; keep it
      // as a note rather than an error artifact.
      fs.writeFileSync(path.join(dir, 'panel-skip.txt'), e.message, 'utf8');
    }
  }

  return {
    dir,
    files: fs.readdirSync(dir).sort(),
    snapshot,
  };
}

export function writeEvidenceResult(dir, result) {
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
}
