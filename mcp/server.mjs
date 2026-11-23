#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { BRIDGE_ROOT } from '../src/config.mjs';

const CLI = path.join(BRIDGE_ROOT, 'bin', 'psdbg.mjs');

function runCli(args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: BRIDGE_ROOT,
    encoding: 'utf8',
    input,
    timeout: 120000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const text = (r.stdout || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      code: 'CLI_OUTPUT_INVALID',
      message: (r.stderr || text).slice(0, 2000) || 'psdbg returned no JSON',
      detail: { exit: r.status, args },
    };
  }
}

const tools = [
  {
    name: 'ps_status',
    description: 'Call FIRST for any Photoshop task: returns Photoshop version, open documents, active document and process state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ps_panels',
    description: 'List, show, hide or toggle native Photoshop panels (Layers, Channels, History, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'show', 'hide', 'toggle'], default: 'list' },
        name: { type: 'string', description: 'Panel name or id, required for show/hide/toggle' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ps_jsx',
    description: 'Run ExtendScript in Photoshop (COM); returns JSON-serializable data. Scratch document only when the script creates one.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'ExtendScript source; takes precedence over file' },
        file: { type: 'string', description: 'Path to a .jsx file' },
        timeoutMs: { type: 'number', default: 30000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ps_plugin_load',
    description: 'Load a UXP plugin into Photoshop through Adobe DevTools/CDP and return its CDP URL and viewport.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute UXP plugin directory' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'ps_eval',
    description: 'Evaluate JavaScript inside a UXP plugin loaded in Photoshop (pair with ps_plugin_load).',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
        awaitPromise: { type: 'boolean', default: true },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'ps_ui',
    description: 'Drive a UXP plugin DOM inside Photoshop: click, set value, read text, layout rectangles, or wait for expression.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'set', 'text', 'layout', 'wait'] },
        selector: { type: 'string' },
        value: { type: ['string', 'number', 'boolean'] },
        expression: { type: 'string', description: 'For wait: JS expression that must become truthy' },
        timeoutMs: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'ps_screenshot',
    description: 'Capture the Photoshop main window, the virtual desktop, or the first floating UXP panel.',
    inputSchema: {
      type: 'object',
      properties: {
        out: { type: 'string' },
        full: { type: 'boolean', default: false },
        panel: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ps_native_probe',
    description: 'Classify a Photoshop classic plug-in / PiPL and optionally probe its Action Manager event on a scratch document. Does not click pixels.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'PiPL JSON, .8bf/.8li, UXP manifest, or plugin directory' },
        execute: { type: 'boolean', default: false },
        index: { type: 'number' },
        event: { type: 'string' },
        doc: { type: 'string', enum: ['scratch', 'active'], default: 'scratch' },
        allowActive: { type: 'boolean', default: false },
      },
      required: ['input'],
      additionalProperties: false,
    },
  },
  {
    name: 'ps_evidence',
    description: 'Create a Photoshop debug evidence bundle: manifest, state, panels, logs, screen.png, optional panel.png.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        project: { type: 'string' },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

function callTool(name, args = {}) {
  if (name === 'ps_status') return runCli(['status']);
  if (name === 'ps_panels') {
    const action = args.action || 'list';
    const rest = action === 'list' ? [] : [args.name || ''];
    return runCli(['panels', action, ...rest]);
  }
  if (name === 'ps_jsx') {
    if (args.code) return runCli(['jsx', '-'], args.code);
    if (args.file) return runCli(['jsx', args.file]);
    return { ok: false, code: 'USAGE', message: 'ps_jsx requires code or file' };
  }
  if (name === 'ps_plugin_load') return runCli(['plugin', 'load', args.path]);
  if (name === 'ps_eval') {
    const cliArgs = ['eval', args.expression];
    if (args.awaitPromise === false) cliArgs.push('--no-await');
    return runCli(cliArgs);
  }
  if (name === 'ps_ui') {
    const action = args.action;
    if (action === 'click' || action === 'text' || action === 'layout') return runCli(['ui', action, args.selector]);
    if (action === 'set') return runCli(['ui', 'set', args.selector, String(args.value ?? '')]);
    if (action === 'wait') {
      const cliArgs = ['ui', 'wait', args.expression];
      if (args.timeoutMs) cliArgs.push('--timeout', String(Math.round(args.timeoutMs / 1000)));
      return runCli(cliArgs);
    }
    return { ok: false, code: 'USAGE', message: `unknown ps_ui action: ${action}` };
  }
  if (name === 'ps_screenshot') {
    const cliArgs = ['shot'];
    if (args.out) cliArgs.push('--out', args.out);
    if (args.full) cliArgs.push('--full');
    if (args.panel) cliArgs.push('--panel');
    return runCli(cliArgs);
  }
  if (name === 'ps_native_probe') {
    const cliArgs = ['native', 'probe', args.input];
    if (args.execute) cliArgs.push('--execute');
    if (args.index !== undefined) cliArgs.push('--index', String(args.index));
    if (args.event) cliArgs.push('--event', args.event);
    if (args.doc) cliArgs.push('--doc', args.doc);
    if (args.allowActive) cliArgs.push('--allow-active');
    return runCli(cliArgs);
  }
  if (name === 'ps_evidence') {
    const cliArgs = ['evidence'];
    if (args.name) cliArgs.push('--name', args.name);
    if (args.project) cliArgs.push('--project', args.project);
    if (args.notes) cliArgs.push('--notes', args.notes);
    return runCli(cliArgs);
  }
  return { ok: false, code: 'UNKNOWN_TOOL', message: `unknown tool: ${name}` };
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try {
    req = JSON.parse(text);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ps-debug-bridge', version: '0.2.0' },
          // Folded into every request's tool block by dsh-mcp-client
          // (`### MCP server: psdbg`). Kept short on purpose: it costs tokens
          // in every turn. Without it the model tends to reach for tasklist /
          // screenshots and never discovers these tools.
          instructions:
            'Photoshop live-debug bridge on this Windows machine. Use these tools for ANY Photoshop work: ' +
            'inspect documents (ps_status), run ExtendScript (ps_jsx), load and drive a UXP plugin ' +
            '(ps_plugin_load, ps_ui, ps_eval), capture the window/panel (ps_screenshot), manage panels, ' +
            'classify PiPL/classic plug-ins, or build an evidence bundle. Call ps_status FIRST. ' +
            'Do not substitute tasklist, PowerShell window queries, or raw screenshots for these tools.',
        },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools } });
      return;
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      const data = callTool(name, args);
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          isError: data?.ok === false,
        },
      });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
  }
});
