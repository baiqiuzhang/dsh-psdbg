import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  BRIDGE_ROOT, PS_ERROR_LOG, SDK_DIR,
  launcherPath, photoshopExe, pluginsDir,
} from './config.mjs';
import { photoshopProcesses } from './process.mjs';
import { runJsx } from './ps-jsx.mjs';

const MSBUILD = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe';
const DUMPBIN = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\dumpbin.exe';
const SDK_ZIPS = [
  'adobe_photoshop_sdk_2026_win_v2.zip',
  'adobe_photoshop_sdk_2026_mac_v2.zip',
  'uxp-hybrid-plugin-sdk-v6.5.0.zip',
].map((name) => path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads', name));

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function check(name, ok, detail = null, critical = true) {
  return { name, ok, critical, detail };
}

export async function runDoctor() {
  const checks = [];
  checks.push(check('node', Number(process.versions.node.split('.')[0]) >= 20, process.version));
  checks.push(check('photoshopExe', exists(photoshopExe()), photoshopExe()));
  checks.push(check('launcher', exists(launcherPath()), launcherPath(), false));
  checks.push(check('screenshotScript', exists(path.join(BRIDGE_ROOT, 'src', 'ps1', 'screenshot.ps1')), null));
  checks.push(check('comRunner', exists(path.join(BRIDGE_ROOT, 'src', 'ps1', 'com-run.ps1')), null));
  checks.push(check('msbuild', exists(MSBUILD), MSBUILD, false));
  checks.push(check('dumpbin', exists(DUMPBIN), DUMPBIN, false));
  checks.push(check('sdkDir', exists(SDK_DIR), SDK_DIR, false));
  for (const zip of SDK_ZIPS) checks.push(check(`sdkZip:${path.basename(zip)}`, exists(zip), zip, false));
  checks.push(check('psErrorLog', exists(PS_ERROR_LOG), PS_ERROR_LOG, false));
  checks.push(check('pluginsDir', exists(pluginsDir()), pluginsDir(), false));
  checks.push(check('uxpDevtoolsDeps', exists(path.join(BRIDGE_ROOT, 'node_modules', '@bubblydoo', 'uxp-devtools-common', 'package.json')), null, false));

  const psVersion = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  checks.push(check('powershell', psVersion.status === 0, (psVersion.stdout || '').trim()));
  checks.push(check('powershellSta', true, 'com-run.ps1 uses -STA'));

  const procs = photoshopProcesses();
  checks.push(check('photoshopProcess', procs.length > 0, procs, false));

  let comVersion = null;
  try {
    const r = await runJsx('return { version: app.version, name: app.name, docs: app.documents.length };');
    comVersion = r.data;
    checks.push(check('com', true, comVersion));
  } catch (e) {
    checks.push(check('com', false, { code: e.code, message: e.message }, false));
  }

  const criticalFailed = checks.filter((c) => c.critical && !c.ok).map((c) => c.name);
  return {
    ok: criticalFailed.length === 0,
    checks,
    criticalFailed,
    photoshop: { processes: procs, com: comVersion },
  };
}
