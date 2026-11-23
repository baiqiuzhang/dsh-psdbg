import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_ROOT, TMP_DIR, ensureDirs } from './config.mjs';

const COM_RUNNER = path.join(BRIDGE_ROOT, 'src', 'ps1', 'com-run.ps1');

export class PsError extends Error {
  constructor(message, code = 'PS_ERROR', detail = {}) {
    super(message);
    this.name = 'PsError';
    this.code = code;
    this.detail = detail;
  }
}

const JSON_POLYFILL = String.raw`
function __jsonEscape(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    var n = s.charCodeAt(i);
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (n < 32 || n > 126) {
      var h = n.toString(16);
      while (h.length < 4) h = '0' + h;
      out += '\\u' + h;
    } else out += c;
  }
  return out;
}
function __json(v, seen) {
  if (v === null || typeof v === 'undefined') return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return '"' + __jsonEscape(v) + '"';
  if (t === 'function') return '"[function]"';
  if (t !== 'object') return '"' + __jsonEscape(String(v)) + '"';
  if (v instanceof Date) return '"' + __jsonEscape(v.toString()) + '"';
  if (!seen) seen = [];
  for (var i = 0; i < seen.length; i++) if (seen[i] === v) return '"[circular]"';
  seen.push(v);
  var parts = [];
  if (v instanceof Array) {
    for (var j = 0; j < v.length; j++) parts.push(__json(v[j], seen));
    seen.pop();
    return '[' + parts.join(',') + ']';
  }
  for (var k in v) {
    if (!v.hasOwnProperty(k)) continue;
    var val;
    try { val = v[k]; } catch (e) { continue; }
    if (typeof val === 'undefined') continue;
    parts.push('"' + __jsonEscape(String(k)) + '":' + __json(val, seen));
    if (parts.length > 5000) { parts.push('"__truncated__":true'); break; }
  }
  seen.pop();
  return '{' + parts.join(',') + '}';
}
`;

function wrapJsx(code) {
  return `#target photoshop
${JSON_POLYFILL}
(function () {
  try {
    var __result = (function () {
${code}
    })();
    return 'OK:' + __json(__result);
  } catch (e) {
    return 'ERR:' + (e && e.message ? e.message : String(e)) + '|' + (e && e.line ? e.line : '');
  }
})();
`;
}

function readResultFile(p) {
  let raw = fs.readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw;
}

export function runJsx(code, opts = {}) {
  ensureDirs();
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const jsxPath = path.join(TMP_DIR, `jsx-${id}.jsx`);
  const resultPath = path.join(TMP_DIR, `jsx-${id}.result.json`);
  fs.writeFileSync(jsxPath, '\ufeff' + wrapJsx(code), 'utf8');

  const timeoutMs = opts.timeoutMs ?? 90000;
  const runnerArgs = [
    '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
    '-File', COM_RUNNER,
    '-JsxPath', jsxPath,
    '-ResultPath', resultPath,
    '-TimeoutSeconds', String(Math.max(5, Math.round(timeoutMs / 1000))),
  ];
  const t0 = Date.now();
  const proc = spawnSync('powershell.exe', runnerArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const elapsed = Date.now() - t0;

  let envelope = null;
  if (fs.existsSync(resultPath)) {
    const raw = readResultFile(resultPath);
    try { envelope = JSON.parse(raw); } catch { envelope = { ok: false, error: `bad COM result JSON: ${raw.slice(0, 500)}` }; }
  } else if (proc.error) {
    throw new PsError(`PowerShell/COM runner failed: ${proc.error.message}`, 'COM_SPAWN_FAILED', {
      elapsed,
      hint: 'If this timed out, a modal Photoshop dialog may be blocking COM. Run: psdbg dialogs',
    });
  } else {
    throw new PsError(`COM runner produced no result (exit ${proc.status})`, 'COM_NO_RESULT', {
      elapsed,
      stderr: (proc.stderr || '').slice(0, 2000),
      stdout: (proc.stdout || '').slice(0, 2000),
    });
  }

  if (!envelope.ok) {
    throw new PsError(envelope.error || 'Photoshop COM call failed', 'COM_CALL_FAILED', {
      elapsed,
      hresult: envelope.hresult,
      stderr: (proc.stderr || '').slice(0, 2000),
    });
  }

  const result = String(envelope.result ?? '');
  if (result.startsWith('ERR:')) {
    const [message, line] = result.slice(4).split('|');
    throw new PsError(`ExtendScript error: ${message}`, 'JSX_ERROR', { line: line || null, elapsed });
  }
  if (result.startsWith('OK:')) {
    const payload = result.slice(3);
    try {
      return { ok: true, data: JSON.parse(payload), raw: result, elapsed };
    } catch {
      return { ok: true, data: payload, raw: result, elapsed };
    }
  }
  return { ok: true, data: result, raw: result, elapsed };
}

export function runJsxFile(filePath, opts = {}) {
  return runJsx(fs.readFileSync(filePath, 'utf8'), opts);
}
