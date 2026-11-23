import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BACKUP_DIR, BRIDGE_ROOT, ensureDirs, pluginsDir } from './config.mjs';
import { extractArtifacts, findArtifacts } from './artifacts.mjs';
import { cleanEnv, runMsbuild } from './msbuild.mjs';
import { classifyPipl } from './capabilities.mjs';

export const DUMPBIN =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\dumpbin.exe';
export const NATIVE_EXTENSIONS = ['.8bf', '.8be', '.8li', '.plugin'];

export function buildNative(project, opts = {}) {
  const projectPath = path.resolve(project);
  if (!fs.existsSync(projectPath)) throw new Error(`project not found: ${projectPath}`);
  // SDK samples include <afxres.h>; the BuildTools install may not have MFC.
  // Put the MFC-free shim next to the .rc so rc.exe resolves it without
  // touching the SDK's shared include directories.
  let shim = null;
  if (opts.shimMfc !== false) {
    const sourceShim = path.join(BRIDGE_ROOT, 'src', 'native-shims', 'afxres.h');
    const localShim = path.join(path.dirname(projectPath), 'afxres.h');
    if (!fs.existsSync(localShim)) {
      fs.copyFileSync(sourceShim, localShim);
      shim = localShim;
    }
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
    includeDirs: opts.includeDirs || [path.join(BRIDGE_ROOT, 'src', 'native-shims')],
  });
  const fromOutput = extractArtifacts(r.output, NATIVE_EXTENSIONS);
  const fromDisk = opts.searchDir ? findArtifacts(opts.searchDir, NATIVE_EXTENSIONS) : [];
  const artifacts = [...new Map([...fromOutput, ...fromDisk].map((a) => [a.path, a])).values()];
  return { ...r, project: projectPath, artifacts, shim };
}

export function inspectNative(file) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) throw new Error(`native plugin not found: ${target}`);
  const headers = spawnSync(DUMPBIN, ['/nologo', '/headers', target], {
    env: cleanEnv(),
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const exportsResult = spawnSync(DUMPBIN, ['/nologo', '/exports', target], {
    env: cleanEnv(),
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const headerText = `${headers.stdout || ''}\n${headers.stderr || ''}`;
  const exportText = `${exportsResult.stdout || ''}\n${exportsResult.stderr || ''}`;
  const machine = /machine\s*\(([^)]+)\)/i.exec(headerText)?.[1] || null;
  const is64Bit = /machine\s*\(x64\)/i.test(headerText) || /PE32\+/.test(headerText);
  const exportNames = [];
  let inExports = false;
  for (const line of exportText.split(/\r?\n/)) {
    if (/ordinal\s+hint\s+rva\s+name/i.test(line)) {
      inExports = true;
      continue;
    }
    if (inExports) {
      const m = /^\s*\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)/.exec(line);
      if (m) exportNames.push(m[1]);
      if (/summary/i.test(line)) break;
    }
  }
  return {
    file: target,
    size: fs.statSync(target).size,
    machine,
    is64Bit,
    hasPluginMain: exportNames.includes('PluginMain'),
    exports: exportNames.slice(0, 200),
    dumpbinExit: headers.status,
    exportsExit: exportsResult.status,
    rawTail: headerText.slice(-2000),
  };
}

export function deployNative(opts = {}) {
  ensureDirs();
  const source = path.resolve(opts.source || '');
  const pluginDir = path.resolve(opts.pluginDir || pluginsDir());
  if (!fs.existsSync(source)) throw new Error(`source not found: ${source}`);
  fs.mkdirSync(pluginDir, { recursive: true });
  const name = opts.name || path.basename(source);
  const dest = path.join(pluginDir, name);
  let backup = null;
  if (fs.existsSync(dest)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = path.join(BACKUP_DIR, `${name}.${stamp}.bak`);
    fs.copyFileSync(dest, backup);
  }
  try {
    fs.copyFileSync(source, dest);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      throw new Error(`native plugin is locked by Photoshop; restart Photoshop, then retry (${dest})`);
    }
    throw e;
  }
  return { source, dest, backup };
}

export function listNativePlugins() {
  const dir = pluginsDir();
  if (!fs.existsSync(dir)) {
    return { pluginDir: dir, exists: false, plugins: [] };
  }
  return {
    pluginDir: dir,
    exists: true,
    plugins: findArtifacts(dir, NATIVE_EXTENSIONS, { maxDepth: 4 }),
  };
}

export function piplSummary(file) {
  const target = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  const list = Array.isArray(data.PiPLs) ? data.PiPLs : [data];
  return {
    file: target,
    count: list.length,
    plugins: list.map((p) => {
      const terminology = p.Terminology || {};
      const classified = classifyPipl({ PiPLs: [p] })[0];
      return {
        kind: p.Kind ?? null,
        name: p.Name ?? null,
        category: p.Category ?? null,
        componentName: p.ComponentName ?? null,
        codeEntryPointWin64: p.CodeEntryPointWin64 ?? null,
        filterLayerSupport: p.FilterLayerSupport ?? null,
        monitorScalingAware: p.MonitorScalingAware ?? null,
        filterCaseCount: Array.isArray(p.FilterCaseInfo) ? p.FilterCaseInfo.length : 0,
        supportedModes: p.SupportedModes ?? null,
        hasTerminology: Boolean(p.HasTerminology),
        classID: p.HasTerminology?.ClassID ?? null,
        eventID: p.HasTerminology?.EventID ?? null,
        scopeString: p.HasTerminology?.ScopeString ?? null,
        terminology: {
          events: classified.events,
          parameters: terminology.Parameters ?? terminology.parameters ?? null,
        },
        warnings: [
          !p.Kind && 'missing Kind',
          !p.Name && 'missing Name',
          !p.CodeEntryPointWin64 && 'missing CodeEntryPointWin64',
        ].filter(Boolean),
      };
    }),
  };
}
