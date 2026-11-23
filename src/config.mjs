import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BRIDGE_ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const WORK_DIR = path.join(BRIDGE_ROOT, '.work');
export const TMP_DIR = path.join(WORK_DIR, 'tmp');
export const EVIDENCE_DIR = path.join(BRIDGE_ROOT, 'evidence');
export const SDK_DIR = path.join(WORK_DIR, 'sdk');
export const BUILD_DIR = path.join(WORK_DIR, 'build');
export const BACKUP_DIR = path.join(WORK_DIR, 'backups');
export const DAEMON_STATE = path.join(TMP_DIR, 'daemon.json');
export const DAEMON_LOG = path.join(TMP_DIR, 'daemon.log');

export const DEFAULT_PHOTOSHOP = 'D:\\Program folders\\Adobe Photoshop 2025\\Photoshop.exe';
// No machine-specific default: set PSDBG_LAUNCHER (or the ~/.psdbg config file)
// to the launcher script on your machine.
export const DEFAULT_LAUNCHER = '';
export const PS_SETTINGS_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Adobe',
  'Adobe Photoshop 2025',
  'Adobe Photoshop 2025 Settings'
);
export const PS_LOG_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Adobe',
  'Adobe Photoshop 2025',
  'Logs'
);
export const PS_ERROR_LOG = path.join(PS_SETTINGS_DIR, 'PSErrorLog.txt');
export const PS_PLUGIN_CACHE = path.join(PS_SETTINGS_DIR, 'PluginCache.psp');
export const PS_PLUGINS_DIR = 'D:\\Program folders\\Adobe Photoshop 2025\\Plug-ins';
export const UXP_STORAGE_ROOT = path.join(
  process.env.TEMP || os.tmpdir(),
  'Adobe',
  'UXP',
  'PluginsStorage',
  'PHSP',
  '26',
  'External'
);

export function ensureDirs() {
  for (const dir of [WORK_DIR, TMP_DIR, EVIDENCE_DIR, SDK_DIR, BUILD_DIR, BACKUP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function configPath() {
  return process.env.PSDBG_CONFIG || path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'ps-debug-bridge',
    'config.json',
  );
}

export function readUserConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function saveUserConfig(next) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const current = readUserConfig();
  const merged = { ...current, ...next };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  return { path: p, config: merged };
}

export function photoshopExe() {
  return process.env.PSDBG_PHOTOSHOP || readUserConfig().photoshopExe || DEFAULT_PHOTOSHOP;
}

export function launcherPath() {
  return process.env.PSDBG_LAUNCHER || readUserConfig().launcher || DEFAULT_LAUNCHER;
}

export function pluginsDir() {
  return process.env.PSDBG_PLUGINS_DIR || readUserConfig().pluginsDir || PS_PLUGINS_DIR;
}

export function effectiveConfig() {
  return {
    path: configPath(),
    file: readUserConfig(),
    env: {
      PSDBG_CONFIG: process.env.PSDBG_CONFIG || null,
      PSDBG_PHOTOSHOP: process.env.PSDBG_PHOTOSHOP || null,
      PSDBG_LAUNCHER: process.env.PSDBG_LAUNCHER || null,
      PSDBG_PLUGINS_DIR: process.env.PSDBG_PLUGINS_DIR || null,
    },
    effective: {
      photoshopExe: photoshopExe(),
      launcher: launcherPath(),
      pluginsDir: pluginsDir(),
    },
  };
}
