import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { BRIDGE_ROOT, DAEMON_LOG, DAEMON_STATE, ensureDirs } from './config.mjs';
import { UxpSession } from './uxp-cdp.mjs';
import { PsError } from './ps-jsx.mjs';
import { captureScreenshot } from './screenshot.mjs';
import { listPanels, setPanel, togglePanel } from './panels.mjs';

const HOST = '127.0.0.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readState() {
  try {
    return JSON.parse(fs.readFileSync(DAEMON_STATE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(DAEMON_STATE, JSON.stringify(state, null, 2), 'utf8');
}

function removeState() {
  try {
    fs.unlinkSync(DAEMON_STATE);
  } catch {
    // ignore
  }
}

function logLine(text) {
  try {
    fs.appendFileSync(DAEMON_LOG, `${new Date().toISOString()} ${text}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    Connection: 'close',
  });
  res.end(body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) throw new PsError('request body too large', 'BAD_REQUEST');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PsError('invalid JSON body', 'BAD_REQUEST');
  }
}

async function daemonHealth(state, timeoutMs = 3000) {
  try {
    const res = await fetch(`http://${HOST}:${state.port}/health`, {
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json?.ok);
  } catch {
    return false;
  }
}

export async function daemonStatus() {
  const state = readState();
  if (!state) return { running: false, state: null };
  return { running: await daemonHealth(state), state };
}

export async function ensureDaemon() {
  ensureDirs();
  const existing = readState();
  if (existing && (await daemonHealth(existing))) return existing;
  if (existing) removeState();
  const child = spawn(process.execPath, [path.join(BRIDGE_ROOT, 'bin', 'psdbg.mjs'), 'daemon', 'run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: BRIDGE_ROOT,
    env: { ...process.env, PSDBG_DAEMON: '1' },
  });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await sleep(250);
    const state = readState();
    if (state && (await daemonHealth(state, 1000))) return state;
  }
  let tail = '';
  try {
    tail = fs.readFileSync(DAEMON_LOG, 'utf8').split(/\r?\n/).slice(-20).join('\n');
  } catch {
    // ignore
  }
  throw new PsError('daemon did not start', 'DAEMON_START', { log: tail });
}

export async function daemonRequest(method, urlPath, body = null, state = null) {
  const st = state || readState();
  if (!st) throw new PsError('daemon is not running', 'DAEMON_DOWN', { hint: 'run: psdbg daemon start' });
  const res = await fetch(`http://${HOST}:${st.port}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${st.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PsError(`daemon returned non-JSON (${res.status}): ${text.slice(0, 500)}`, 'DAEMON_BAD_RESPONSE');
  }
  if (!res.ok || json?.ok === false) {
    throw new PsError(json?.message || `daemon HTTP ${res.status}`, json?.code || 'DAEMON_ERROR', json?.detail);
  }
  return json;
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await sleep(100);
  }
  return false;
}

export async function stopDaemon() {
  const state = readState();
  if (!state) return { stopped: false, reason: 'no state file' };
  let graceful = false;
  try {
    const res = await fetch(`http://${HOST}:${state.port}/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(3000),
    });
    graceful = res.ok;
  } catch {
    // fall through to kill
  }
  if (graceful) {
    // /shutdown unloads the UXP plugin asynchronously. Returning before that
    // finishes lets watch start a second daemon and race the helper unload.
    await waitForExit(state.pid, 8000);
  }
  try {
    process.kill(state.pid, 0);
    process.kill(state.pid);
    await waitForExit(state.pid, 2000);
  } catch {
    // already gone
  }
  removeState();
  return { stopped: true, graceful, pid: state.pid };
}

export async function daemonRun() {
  ensureDirs();
  const existing = readState();
  if (existing && (await daemonHealth(existing, 1000))) {
    throw new PsError('daemon already running', 'DAEMON_RUNNING', { pid: existing.pid, port: existing.port });
  }
  removeState();
  const session = new UxpSession();
  const token = crypto.randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${HOST}`);
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${token}`) {
        send(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'bad token' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, {
          ok: true,
          loaded: session.loaded,
          pluginPath: session.pluginPath,
          pid: process.pid,
          startedAt,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/shutdown') {
        send(res, 200, { ok: true, stopping: true });
        setImmediate(async () => {
          try {
            await session.unload();
          } catch (e) {
            logLine(`unload: ${e.message}`);
          }
          try {
            await new Promise((r) => server.close(r));
          } catch {
            // ignore
          }
          removeState();
          process.exit(0);
        });
        return;
      }

      const body = await readBody(req);
      if (req.method === 'POST' && url.pathname === '/load') {
        const info = await session.load(body.pluginPath);
        send(res, 200, { ok: true, data: info });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/unload') {
        send(res, 200, { ok: true, data: await session.unload() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/info') {
        send(res, 200, { ok: true, data: await session.info() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/eval') {
        const value = await session.eval(body.expression, body.awaitPromise !== false);
        send(res, 200, { ok: true, data: value });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/ui') {
        let data;
        if (body.action === 'click') data = await session.click(body.selector);
        else if (body.action === 'set') data = await session.set(body.selector, body.value);
        else if (body.action === 'text') data = await session.text(body.selector);
        else if (body.action === 'layout') data = await session.layout(body.selector);
        else if (body.action === 'wait') data = await session.wait(body.expression, body.timeoutMs || 5000, body.intervalMs || 100);
        else throw new PsError(`unknown ui action: ${body.action}`, 'USAGE');
        send(res, 200, { ok: true, data });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/logs') {
        send(res, 200, { ok: true, data: session.tailLogs(body.tail || 50) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/panels') {
        let data;
        if (body.action === 'list') data = await listPanels();
        else if (body.action === 'show') data = await setPanel(body.name, true);
        else if (body.action === 'hide') data = await setPanel(body.name, false);
        else if (body.action === 'toggle') data = await togglePanel(body.name);
        else throw new PsError(`unknown panels action: ${body.action}`, 'USAGE');
        send(res, 200, { ok: true, data });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/shot') {
        const out = body.out || path.join(BRIDGE_ROOT, 'out', `ps-${Date.now()}.png`);
        const data = captureScreenshot({ out, fullScreen: Boolean(body.fullScreen), pid: body.pid });
        send(res, 200, { ok: true, data });
        return;
      }
      send(res, 404, { ok: false, code: 'NOT_FOUND', message: `no route ${req.method} ${url.pathname}` });
    } catch (e) {
      logLine(`request error: ${e.stack || e.message}`);
      const code = e instanceof PsError ? e.code : 'DAEMON_ERROR';
      send(res, e instanceof PsError ? 400 : 500, {
        ok: false,
        code,
        message: e.message,
        detail: e instanceof PsError ? e.detail : null,
      });
    }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 60000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  const state = { pid: process.pid, port: address.port, token, startedAt, root: BRIDGE_ROOT };
  writeState(state);
  logLine(`daemon started pid=${process.pid} port=${address.port}`);

  const shutdown = async () => {
    try {
      await session.unload();
    } catch {
      // ignore
    }
    removeState();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return state;
}
