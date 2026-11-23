import fs from 'node:fs';
import path from 'node:path';
import { PS_ERROR_LOG, PS_LOG_DIR, UXP_STORAGE_ROOT } from './config.mjs';

export function readTail(file, lines = 80) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const arr = text.split(/\r?\n/);
    return arr.slice(Math.max(0, arr.length - lines)).join('\n');
  } catch (e) {
    return `<<unreadable: ${e.message}>>`;
  }
}

export function newestFiles(dir, predicate, limit = 3) {
  try {
    return fs.readdirSync(dir)
      .map((name) => {
        const p = path.join(dir, name);
        try {
          const st = fs.statSync(p);
          return { name, path: p, mtime: st.mtimeMs, size: st.size };
        } catch { return null; }
      })
      .filter(Boolean)
      .filter((f) => predicate(f.name))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function collectLogSnapshot(lines = 60) {
  const pslogs = newestFiles(PS_LOG_DIR, (n) => /^pslog_.*\.log$/i.test(n), 2);
  const uxplogs = newestFiles(PS_LOG_DIR, (n) => /^UXPLogs_.*\.log$/i.test(n), 2);
  return {
    psErrorLog: { path: PS_ERROR_LOG, tail: readTail(PS_ERROR_LOG, lines) },
    pslogs: pslogs.map((f) => ({ ...f, tail: readTail(f.path, lines) })),
    uxplogs: uxplogs.map((f) => ({ ...f, tail: readTail(f.path, lines) })),
  };
}

export function pluginStorageFiles(pluginId) {
  const dir = path.join(UXP_STORAGE_ROOT, pluginId, 'PluginData');
  try {
    return fs.readdirSync(dir).map((name) => {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      return { name, path: p, mtime: st.mtimeMs, size: st.size };
    }).sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}
