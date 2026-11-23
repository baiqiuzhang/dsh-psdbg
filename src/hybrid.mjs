import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, ensureDirs } from './config.mjs';
import { extractArtifacts, findArtifacts } from './artifacts.mjs';
import { preparePluginCopy } from './plugin-copy.mjs';
import { runMsbuild } from './msbuild.mjs';
import { daemonRequest, ensureDaemon } from './daemon.mjs';
import { PsError } from './ps-jsx.mjs';

export function prepareHybrid(dir, opts = {}) {
  return preparePluginCopy(dir, opts.dest, {
    id: opts.id || 'com.psdbg.hybrid',
    name: opts.name || 'PSDBG Hybrid',
  });
}

export function buildHybrid(project, opts = {}) {
  const projectPath = path.resolve(project);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`project not found: ${projectPath}`);
  }
  const r = runMsbuild({
    project: projectPath,
    configuration: opts.configuration || 'Debug',
    platform: opts.platform || 'x64',
    cwd: opts.cwd || path.dirname(projectPath),
    properties: {
      PlatformToolset: opts.toolset || 'v143',
      ...(opts.properties || {}),
    },
    timeoutMs: opts.timeoutMs,
  });
  const fromOutput = extractArtifacts(r.output, '.uxpaddon');
  const fromDisk = opts.searchDir ? findArtifacts(opts.searchDir, '.uxpaddon') : [];
  const artifacts = [...new Map([...fromOutput, ...fromDisk].map((a) => [a.path, a])).values()];
  return { ...r, project: projectPath, artifacts };
}

export function deployHybrid(opts = {}) {
  ensureDirs();
  const pluginDir = path.resolve(opts.pluginDir || '');
  const addon = path.resolve(opts.addon || '');
  if (!fs.existsSync(path.join(pluginDir, 'manifest.json'))) {
    throw new Error(`manifest.json not found in plugin dir: ${pluginDir}`);
  }
  if (!fs.existsSync(addon)) throw new Error(`addon not found: ${addon}`);
  const platformDir = path.join(pluginDir, opts.platform || 'win/x64');
  fs.mkdirSync(platformDir, { recursive: true });
  const destName = opts.name || path.basename(addon);
  const dest = path.join(platformDir, destName);
  if (fs.existsSync(dest)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dest, path.join(BACKUP_DIR, `${path.basename(dest)}.${stamp}.bak`));
  }
  try {
    fs.copyFileSync(addon, dest);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      throw new Error(`addon is locked by Photoshop; run "psdbg plugin unload" then retry (${dest})`);
    }
    throw e;
  }
  const manifestPath = path.join(pluginDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const previous = manifest.addon?.name;
  manifest.addon = { ...(manifest.addon || {}), name: destName };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { pluginDir, addon, dest, previousAddon: previous ?? null, manifestAddon: manifest.addon };
}

export async function testHybrid(opts = {}) {
  const pluginDir = path.resolve(opts.pluginDir || '');
  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest.json not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const addonName = manifest.addon?.name;
  if (!addonName) throw new Error('manifest.addon.name is missing');
  const expression =
    opts.expression ||
    `(async()=>{const a=await require(${JSON.stringify(addonName)});const out={keys:JSON.stringify(Object.keys(a))};if(typeof a.my_function==='function')out.f=a.my_function();if(typeof a.my_echo==='function')out.e=a.my_echo(10);if(typeof a.my_echo_async==='function')out.ae=await a.my_echo_async(10);return out})()`;
  await ensureDaemon();
  // Unloading a hybrid addon can deadlock the Adobe helper. If the same plugin
  // is already loaded, just evaluate it. If a different plugin is loaded,
  // require a PS restart or a fresh plugin id instead of risking a hang.
  const health = await daemonRequest('GET', '/health');
  if (health.loaded) {
    if (path.resolve(health.pluginPath) === pluginDir) {
      const info = await daemonRequest('POST', '/info', {});
      const value = await daemonRequest('POST', '/eval', { expression, awaitPromise: true });
      return { pluginDir, reused: true, load: info.data, value: value.data };
    }
    throw new PsError(
      `a UXP plugin is already loaded (${health.pluginPath}); restart Photoshop or use a fresh plugin id before testing ${pluginDir}`,
      'UXP_BUSY',
      { loadedPlugin: health.pluginPath, requested: pluginDir },
    );
  }
  const load = await daemonRequest('POST', '/load', { pluginPath: pluginDir });
  const value = await daemonRequest('POST', '/eval', { expression, awaitPromise: true });
  return { pluginDir, reused: false, load: load.data, value: value.data };
}
