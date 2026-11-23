import fs from 'node:fs';
import path from 'node:path';
import { daemonRequest, ensureDaemon, stopDaemon } from './daemon.mjs';

/**
 * Watch a UXP plugin directory and reload it through the CDP daemon.
 * This is intentionally explicit: watch mode reloads the plugin, so do not
 * leave it running while editing a hybrid addon (the addon DLL is locked).
 */
export async function watchPlugin(pluginDir, opts = {}) {
  const dir = path.resolve(pluginDir);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error(`not a UXP plugin directory (manifest.json missing): ${dir}`);
  }
  const debounceMs = opts.debounceMs ?? 500;
  await ensureDaemon();
  let timer = null;
  let reloading = false;
  let pending = false;

  const reload = async (reason) => {
    if (reloading) { pending = true; return; }
    reloading = true;
    try {
      // Photoshop's UXP helper does not reliably rebind the same plugin after
      // a session unload. Restart the lightweight bridge daemon between reloads
      // so a save really gets a fresh CDP connection without restarting PS.
      await stopDaemon();
      await ensureDaemon();
      const r = await daemonRequest('POST', '/load', { pluginPath: dir });
      process.stdout.write(JSON.stringify({ event: 'reload', ok: true, reason, at: new Date().toISOString(), data: r.data }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ event: 'reload', ok: false, reason, at: new Date().toISOString(), code: e.code, message: e.message }) + '\n');
    } finally {
      reloading = false;
      if (pending) { pending = false; reload('queued-change'); }
    }
  };

  const onFsEvent = (event, file) => {
    const name = String(file || '');
    if (/(^|[\\/])(node_modules|\.git|\.work|out)([\\/]|$)/.test(name)) return;
    if (/\.(log|png|jpg|jpeg|webp)$/i.test(name)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => reload(`${event}:${name}`), debounceMs);
  };

  const watcher = fs.watch(dir, { recursive: true }, onFsEvent);
  process.stdout.write(JSON.stringify({ event: 'watching', dir, debounceMs }) + '\n');
  await reload('initial');

  await new Promise((resolve) => {
    const stop = () => {
      watcher.close();
      if (timer) clearTimeout(timer);
      process.stdout.write(JSON.stringify({ event: 'stopped', dir }) + '\n');
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
