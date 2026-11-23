#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_ROOT, configPath, effectiveConfig, ensureDirs, saveUserConfig } from '../src/config.mjs';
import { runDoctor } from '../src/doctor.mjs';
import { PsError, runJsx } from '../src/ps-jsx.mjs';
import { listPanels, setPanel, togglePanel } from '../src/panels.mjs';
import { photoshopProcesses } from '../src/process.mjs';
import { captureScreenshot } from '../src/screenshot.mjs';
import { collectLogSnapshot } from '../src/logs.mjs';
import { createEvidence } from '../src/evidence.mjs';
import { startPhotoshop } from '../src/start.mjs';
import { restartPhotoshop, stopPhotoshop } from '../src/restart.mjs';
import { daemonRequest, daemonRun, daemonStatus, ensureDaemon, stopDaemon } from '../src/daemon.mjs';
import { dismissAllDialogs, dismissDialog, listDialogs } from '../src/dialogs.mjs';
import { findPluginPanelWindow } from '../src/windows.mjs';
import { capabilitiesSummary, classifyPlugin } from '../src/capabilities.mjs';
import { invokeNative, probeNative } from '../src/native-action.mjs';
import { invokeControl, listControls, setControl } from '../src/native-ui.mjs';
import { watchPlugin } from '../src/watch.mjs';
import { buildHybrid, deployHybrid, prepareHybrid, testHybrid } from '../src/hybrid.mjs';
import { buildNative, deployNative, inspectNative, listNativePlugins, piplSummary } from '../src/native.mjs';

const STATUS_JSX = fs.readFileSync(path.join(BRIDGE_ROOT, 'src', 'jsx', 'status.jsx'), 'utf8');

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

function repeated(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] !== undefined) out.push(argv[++i]);
  }
  return out;
}

function print(value, pretty = true) {
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + '\n');
}

function readInput(file) {
  if (!file || file === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(file, 'utf8');
}

function expressionFrom(arg) {
  if (!arg) throw new PsError('missing expression or file', 'USAGE');
  if (arg === '-') return readInput('-');
  try {
    if (fs.statSync(arg).isFile()) return readInput(arg);
  } catch {
    // not a file: treat as an expression
  }
  return arg;
}

function publicDaemonState(state) {
  if (!state) return null;
  const { token, ...rest } = state;
  return rest;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  ensureDirs();
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);
  const params = repeated(argv, 'param');
  const cmd = flags._[0];
  if (!cmd || cmd === 'help' || flags.help) {
    print({
      ok: true,
      commands: [
        'doctor',
        'status',
        'start',
        'restart',
        'stop',
        'jsx',
        'capabilities',
        'capability',
        'panels',
        'shot',
        'logs',
        'evidence',
        'dialogs',
        'daemon',
        'plugin',
        'eval',
        'ui',
        'native',
        'hybrid',
        'watch',
        'config',
        'version',
      ],
      examples: [
        'psdbg doctor',
        'psdbg status',
        'psdbg capabilities fixtures\\native\\automationfilter-pipl.json',
        'psdbg panels list',
        'psdbg panels show 通道',
        'psdbg jsx .\\script.jsx',
        'psdbg shot --out .\\out\\ps.png',
        'psdbg evidence --name channels-open',
        'psdbg plugin load <plugin-dir>/uxp',
        `psdbg eval "document.querySelector('#generateBtn').textContent"`,
        'psdbg ui click "#generateBtn"',
        'psdbg native probe fixtures\\native\\automationfilter-pipl.json',
        'psdbg native window list --max-nodes 40',
        'psdbg hybrid test .work\\hybrid-plugin',
        'psdbg watch .work\\target-copy',
        'psdbg ui layout',
        'psdbg native build .work/sdk/classic/pluginsdk/samplecode/filter/dissolve/win/Dissolve.vcxproj',
        'psdbg hybrid test .work/hybrid-plugin',
      ],
    });
    return 0;
  }

  if (cmd === 'version') {
    print({ ok: true, version: '0.2.0', root: BRIDGE_ROOT });
    return 0;
  }

  if (cmd === 'doctor') {
    const r = await runDoctor();
    print(r);
    return r.ok ? 0 : 1;
  }

  if (cmd === 'start') {
    const p = await startPhotoshop({ file: flags.file, launcher: flags.launcher, noLauncher: Boolean(flags['no-launcher']) });
    print({ ok: true, ...p });
    return 0;
  }

  if (cmd === 'restart') {
    const r = await restartPhotoshop({
      file: flags.file,
      launcher: flags.launcher,
      noSave: Boolean(flags['no-save']),
      force: Boolean(flags.force),
      timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
    });
    print({ ok: true, ...r });
    return 0;
  }

  if (cmd === 'stop') {
    const r = await stopPhotoshop({ noSave: Boolean(flags['no-save']), force: Boolean(flags.force) });
    print({ ok: true, ...r });
    return 0;
  }

  if (cmd === 'status') {
    const r = await runJsx(STATUS_JSX);
    print({ ok: true, lane: 'es', data: r.data, processes: photoshopProcesses() });
    return 0;
  }

  if (cmd === 'capabilities') {
    const target = flags._[1];
    print({ ok: true, lane: 'capabilities', data: target ? classifyPlugin(target) : capabilitiesSummary() });
    return 0;
  }

  if (cmd === 'capability') {
    const target = flags._[1];
    if (!target) throw new PsError('usage: psdbg capability <plugin-dir|manifest.json|pipl.json>', 'USAGE');
    print({ ok: true, lane: 'capabilities', data: classifyPlugin(target) });
    return 0;
  }

  if (cmd === 'jsx') {
    const file = flags._[1];
    if (!file && process.stdin.isTTY) throw new PsError('usage: psdbg jsx <file|->', 'USAGE');
    const code = readInput(file);
    const timeoutMs = flags.timeout ? Number(flags.timeout) * 1000 : 90000;
    const r = await runJsx(code, { timeoutMs });
    print({ ok: true, lane: 'es', data: r.data, elapsed: r.elapsed });
    return 0;
  }

  if (cmd === 'panels') {
    const action = flags._[1] || 'list';
    if (action === 'list') {
      print({ ok: true, lane: 'es', data: await listPanels() });
      return 0;
    }
    const name = flags._[2];
    if (!name) throw new PsError('usage: psdbg panels show|hide|toggle <name>', 'USAGE');
    if (action === 'show') {
      print({ ok: true, lane: 'es', data: await setPanel(name, true) });
      return 0;
    }
    if (action === 'hide') {
      print({ ok: true, lane: 'es', data: await setPanel(name, false) });
      return 0;
    }
    if (action === 'toggle') {
      print({ ok: true, lane: 'es', data: await togglePanel(name) });
      return 0;
    }
    throw new PsError(`unknown panels action: ${action}`, 'USAGE');
  }

  if (cmd === 'shot') {
    const out = flags.out || path.join(BRIDGE_ROOT, 'out', `ps-${stamp()}.png`);
    if (flags.plugin) {
      await ensureDaemon();
      const r = await daemonRequest('POST', '/shot', { out });
      print({ ok: true, lane: 'uxp', data: r.data });
      return 0;
    }
    if (flags.panel) {
      const titleMatch = typeof flags.panel === 'string' ? flags.panel : undefined;
      const found = findPluginPanelWindow(titleMatch);
      const r = captureScreenshot({
        out,
        pid: found.processId,
        windowHandle: found.window.handle,
        screenCrop: true,
      });
      print({ ok: true, lane: 'uia', data: { ...r, panel: found.window } });
      return 0;
    }
    const r = captureScreenshot({ out, fullScreen: Boolean(flags.full), pid: flags.pid ? Number(flags.pid) : undefined });
    print({ ok: true, lane: 'uia', data: r });
    return 0;
  }

  if (cmd === 'logs') {
    const tail = flags.tail ? Number(flags.tail) : 60;
    if (flags.daemon || flags.live) {
      await ensureDaemon();
      const r = await daemonRequest('POST', '/logs', { tail });
      print({ ok: true, lane: 'uxp', data: r.data });
      return 0;
    }
    const kind = flags.kind || 'all';
    const snapshot = collectLogSnapshot(tail);
    let data = snapshot;
    if (kind === 'ps') data = { psErrorLog: snapshot.psErrorLog, pslogs: snapshot.pslogs };
    if (kind === 'uxp') data = { uxplogs: snapshot.uxplogs };
    print({ ok: true, lane: 'logs', data });
    return 0;
  }

  if (cmd === 'daemon') {
    const action = flags._[1] || 'status';
    if (action === 'start') {
      const state = await ensureDaemon();
      print({ ok: true, running: true, state: publicDaemonState(state) });
      return 0;
    }
    if (action === 'stop') {
      print({ ok: true, ...(await stopDaemon()) });
      return 0;
    }
    if (action === 'status') {
      const s = await daemonStatus();
      print({ ok: true, ...s, state: publicDaemonState(s.state) });
      return 0;
    }
    if (action === 'run') {
      const state = await daemonRun();
      print({ ok: true, running: true, state });
      return null;
    }
    throw new PsError(`unknown daemon action: ${action}`, 'USAGE');
  }

  if (cmd === 'dialogs') {
    const action = flags._[1] || 'list';
    if (action === 'list') {
      print({ ok: true, lane: 'uia', data: listDialogs() });
      return 0;
    }
    if (action === 'dismiss') {
      if (flags.all) {
        print({ ok: true, lane: 'uia', data: dismissAllDialogs() });
        return 0;
      }
      const handle = flags.handle || flags._[2];
      print({ ok: true, lane: 'uia', data: dismissDialog(handle) });
      return 0;
    }
    throw new PsError(`unknown dialogs action: ${action}`, 'USAGE');
  }

  if (cmd === 'plugin') {
    const action = flags._[1] || 'status';
    if (action === 'load') {
      const pluginPath = flags._[2];
      if (!pluginPath) throw new PsError('usage: psdbg plugin load <plugin-dir>', 'USAGE');
      await ensureDaemon();
      const r = await daemonRequest('POST', '/load', { pluginPath });
      print({ ok: true, lane: 'uxp', data: r.data });
      return 0;
    }
    if (action === 'unload') {
      const r = await daemonRequest('POST', '/unload', {});
      print({ ok: true, lane: 'uxp', data: r.data });
      return 0;
    }
    if (action === 'status') {
      const s = await daemonStatus();
      if (s.running) {
        const h = await daemonRequest('GET', '/health', null, s.state);
        print({ ok: true, lane: 'uxp', running: true, loaded: h.loaded, pluginPath: h.pluginPath, state: publicDaemonState(s.state) });
      } else {
        print({ ok: true, lane: 'uxp', running: false, state: null });
      }
      return 0;
    }
    if (action === 'info') {
      const r = await daemonRequest('POST', '/info', {});
      print({ ok: true, lane: 'uxp', data: r.data });
      return 0;
    }
    throw new PsError(`unknown plugin action: ${action}`, 'USAGE');
  }

  if (cmd === 'eval') {
    const expression = expressionFrom(flags._[1] || flags.expression);
    await ensureDaemon();
    const r = await daemonRequest('POST', '/eval', {
      expression,
      awaitPromise: flags['no-await'] ? false : true,
    });
    print({ ok: true, lane: 'uxp', data: r.data });
    return 0;
  }

  if (cmd === 'ui') {
    const action = flags._[1];
    if (!['click', 'set', 'text', 'layout', 'wait'].includes(action)) {
      throw new PsError('usage: psdbg ui click|set|text|layout|wait ...', 'USAGE');
    }
    await ensureDaemon();
    const body = { action };
    if (action === 'click' || action === 'text' || action === 'layout') body.selector = flags._[2];
    if (action === 'set') {
      body.selector = flags._[2];
      const raw = flags._[3];
      body.value = flags.json ? JSON.parse(raw) : raw;
    }
    if (action === 'wait') {
      body.expression = flags._[2];
      body.timeoutMs = flags.timeout ? Number(flags.timeout) * 1000 : undefined;
    }
    const r = await daemonRequest('POST', '/ui', body);
    print({ ok: true, lane: 'uxp', data: r.data });
    return 0;
  }

  if (cmd === 'config') {
    const action = flags._[1] || 'show';
    if (action === 'path') {
      print({ ok: true, lane: 'config', data: { path: configPath() } });
      return 0;
    }
    if (action === 'show') {
      print({ ok: true, lane: 'config', data: effectiveConfig() });
      return 0;
    }
    if (action === 'init') {
      const next = {};
      if (flags.photoshop) next.photoshopExe = flags.photoshop;
      if (flags.launcher) next.launcher = flags.launcher;
      if (flags['plugins-dir']) next.pluginsDir = flags['plugins-dir'];
      const r = saveUserConfig(next);
      print({ ok: true, lane: 'config', data: { saved: r.path, config: r.config } });
      return 0;
    }
    if (action === 'set') {
      const pair = flags._[2];
      if (!pair || !pair.includes('=')) throw new PsError('usage: psdbg config set key=value', 'USAGE');
      const [key, ...rest] = pair.split('=');
      const value = rest.join('=');
      const allowed = new Set(['photoshopExe', 'launcher', 'pluginsDir']);
      if (!allowed.has(key)) throw new PsError(`unknown config key: ${key}`, 'USAGE', { allowed: [...allowed] });
      const r = saveUserConfig({ [key]: value });
      print({ ok: true, lane: 'config', data: { saved: r.path, config: r.config } });
      return 0;
    }
    throw new PsError(`unknown config action: ${action}`, 'USAGE');
  }

  if (cmd === 'watch') {
    const pluginDir = flags._[1];
    if (!pluginDir) throw new PsError('usage: psdbg watch <plugin-dir>', 'USAGE');
    await watchPlugin(pluginDir, { debounceMs: flags.debounce ? Number(flags.debounce) : undefined });
    return 0;
  }

  if (cmd === 'evidence') {
    const r = await createEvidence({ name: flags.name, project: flags.project, notes: flags.notes });
    print({ ok: true, lane: 'evidence', data: r });
    return 0;
  }

  if (cmd === 'native') {
    const action = flags._[1] || 'list';
    if (action === 'list') {
      print({ ok: true, lane: 'native', data: listNativePlugins() });
      return 0;
    }
    if (action === 'inspect') {
      const file = flags._[2];
      if (!file) throw new PsError('usage: psdbg native inspect <file.8bf>', 'USAGE');
      print({ ok: true, lane: 'native', data: inspectNative(file) });
      return 0;
    }
    if (action === 'pipl') {
      const file = flags._[2];
      if (!file) throw new PsError('usage: psdbg native pipl <PiPLs.json>', 'USAGE');
      print({ ok: true, lane: 'native', data: piplSummary(file) });
      return 0;
    }
    if (action === 'build') {
      const project = flags._[2];
      if (!project) throw new PsError('usage: psdbg native build <vcxproj>', 'USAGE');
      const data = buildNative(project, {
        configuration: flags.config,
        platform: flags.platform,
        toolset: flags.toolset,
        searchDir: flags.search,
        timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
      });
      print({ ok: data.ok, lane: 'native', data });
      return data.ok ? 0 : 1;
    }
    if (action === 'deploy') {
      const source = flags._[2];
      if (!source) throw new PsError('usage: psdbg native deploy <file.8bf> [--plugin-dir <dir>]', 'USAGE');
      print({ ok: true, lane: 'native', data: deployNative({ source, pluginDir: flags['plugin-dir'], name: flags.name }) });
      return 0;
    }
    if (action === 'window') {
      const sub = flags._[2] || 'list';
      if (sub === 'list' || sub === 'find') {
        print({
          ok: true,
          lane: 'uia',
          data: listControls({
            handle: flags.handle,
            name: flags.name || (sub === 'find' ? flags._[3] : undefined),
            className: flags.class,
            maxNodes: flags['max-nodes'] ? Number(flags['max-nodes']) : undefined,
          }),
        });
        return 0;
      }
      if (sub === 'invoke') {
        const handle = flags.handle || flags._[3];
        print({ ok: true, lane: 'uia', data: invokeControl({ handle, name: flags.name, yes: Boolean(flags.yes) }) });
        return 0;
      }
      if (sub === 'set') {
        const handle = flags.handle || flags._[3];
        print({ ok: true, lane: 'uia', data: setControl({ handle, name: flags.name, value: flags.value, yes: Boolean(flags.yes) }) });
        return 0;
      }
      throw new PsError(`unknown native window action: ${sub}`, 'USAGE');
    }
    if (action === 'probe' || action === 'invoke') {
      const target = flags._[2];
      if (!target) throw new PsError(`usage: psdbg native ${action} <plugin|pipl.json> [options]`, 'USAGE');
      const common = {
        execute: action === 'invoke' || Boolean(flags.execute),
        yes: Boolean(flags.yes),
        event: flags.event,
        doc: flags.doc,
        allowActive: Boolean(flags['allow-active']),
        params,
        timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
      };
      const r = action === 'invoke' ? invokeNative(target, common) : probeNative(target, common);
      print(r);
      return r.ok ? 0 : 1;
    }
    throw new PsError(`unknown native action: ${action}`, 'USAGE');
  }

  if (cmd === 'hybrid') {
    const action = flags._[1];
    if (action === 'prepare') {
      const src = flags._[2] || flags.src;
      const dest = flags.dest || flags._[3];
      if (!src) throw new PsError('usage: psdbg hybrid prepare <template-dir> <dest-dir>', 'USAGE');
      if (!dest) throw new PsError('missing dest dir', 'USAGE');
      print({ ok: true, lane: 'hybrid', data: prepareHybrid(src, { dest, id: flags.id, name: flags.name }) });
      return 0;
    }
    if (action === 'build') {
      const project = flags._[2];
      if (!project) throw new PsError('usage: psdbg hybrid build <vcxproj>', 'USAGE');
      const data = buildHybrid(project, {
        configuration: flags.config,
        platform: flags.platform,
        toolset: flags.toolset,
        searchDir: flags.search,
        timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
      });
      print({ ok: data.ok, lane: 'hybrid', data });
      return data.ok ? 0 : 1;
    }
    if (action === 'deploy') {
      const pluginDir = flags._[2] || flags['plugin-dir'];
      const addon = flags._[3] || flags.addon || flags.file;
      if (!pluginDir || !addon) {
        throw new PsError('usage: psdbg hybrid deploy <plugin-dir> <addon.uxpaddon>', 'USAGE');
      }
      print({ ok: true, lane: 'hybrid', data: deployHybrid({ pluginDir, addon, platform: flags.platform, name: flags.name }) });
      return 0;
    }
    if (action === 'test') {
      const pluginDir = flags._[2] || flags['plugin-dir'];
      if (!pluginDir) throw new PsError('usage: psdbg hybrid test <plugin-dir>', 'USAGE');
      const data = await testHybrid({ pluginDir, expression: flags.expression });
      print({ ok: true, lane: 'hybrid', data });
      return 0;
    }
    throw new PsError(`unknown hybrid action: ${action}`, 'USAGE');
  }

  throw new PsError(`unknown command: ${cmd}`, 'USAGE');
}

main()
  .then((code) => {
    if (code !== null) process.exit(code ?? 0);
  })
  .catch((e) => {
    print({
      ok: false,
      code: e.code || 'ERROR',
      message: e.message,
      detail: e.detail || null,
    });
    process.exit(1);
  });
