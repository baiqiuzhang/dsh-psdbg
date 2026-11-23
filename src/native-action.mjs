import { runJsx, PsError } from './ps-jsx.mjs';
import { classifyPlugin } from './capabilities.mjs';

function pickPlugin(classification, opts = {}) {
  const plugins = classification.plugins || [];
  if (plugins.length === 0) throw new PsError('no PiPL entries found', 'PIPL_INVALID');
  if (opts.index !== undefined) {
    const p = plugins[Number(opts.index)];
    if (!p) throw new PsError(`PiPL index out of range: ${opts.index}`, 'PIPL_INVALID');
    return p;
  }
  const p = plugins.find((x) => x.eventID) || plugins[0];
  return p;
}

function descriptorSource(params = []) {
  const lines = ['var __desc = new ActionDescriptor();'];
  for (const raw of params) {
    const m = /^([^:=]+)(?::([a-zA-Z]+))?=(.*)$/s.exec(String(raw));
    if (!m) throw new PsError(`bad --param (expected key=value or key:type=value): ${raw}`, 'USAGE');
    const key = m[1];
    const type = (m[2] || 'auto').toLowerCase();
    const value = m[3];
    const keyExpr = `stringIDToTypeID(${JSON.stringify(key)})`;
    let put;
    if (type === 'string' || (type === 'auto' && !/^-?\d+(\.\d+)?$/.test(value) && value !== 'true' && value !== 'false')) {
      put = `__desc.putString(${keyExpr}, ${JSON.stringify(value)});`;
    } else if (type === 'integer' || (type === 'auto' && /^-?\d+$/.test(value))) {
      put = `__desc.putInteger(${keyExpr}, ${Number(value)});`;
    } else if (type === 'double' || type === 'float' || (type === 'auto' && /^-?\d+\.\d+$/.test(value))) {
      put = `__desc.putDouble(${keyExpr}, ${Number(value)});`;
    } else if (type === 'boolean' || (type === 'auto' && (value === 'true' || value === 'false'))) {
      put = `__desc.putBoolean(${keyExpr}, ${value === 'true'});`;
    } else {
      throw new PsError(`unsupported --param type: ${type}`, 'USAGE');
    }
    lines.push(put);
  }
  return lines.join('\n');
}

function actionJsx({ eventID, params, docMode, allowActive, closeScratch }) {
  const docSetup = docMode === 'active'
    ? `if (${allowActive ? 'false' : 'true'}) throw new Error('active-document execution requires --allow-active');\nvar __doc = app.activeDocument; var __created = false;`
    : `var __doc = app.documents.add(64, 64, 72, 'psdbg-probe', NewDocumentMode.RGB, DocumentFill.WHITE);\nvar __created = true;`;
  return `
var __oldDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __doc = null;
var __created = false;
try {
  ${docSetup}
  var __before = { name: __doc.name, history: __doc.historyStates.length };
  ${descriptorSource(params)}
  var __error = null;
  try {
    executeAction(stringIDToTypeID(${JSON.stringify(eventID)}), __desc, DialogModes.NO);
  } catch (e) {
    __error = (e && e.message) ? e.message : String(e);
  }
  var __after = { name: __doc.name, history: __doc.historyStates.length };
  var __result = { eventID: ${JSON.stringify(eventID)}, before: __before, after: __after, error: __error, created: __created };
  if (__created && ${closeScratch ? 'true' : 'false'}) {
    __doc.close(SaveOptions.DONOTSAVECHANGES);
  }
  return __result;
} finally {
  app.displayDialogs = __oldDialogs;
}`;
}

export function probeNative(input, opts = {}) {
  const classification = classifyPlugin(input);
  const plugin = pickPlugin(classification, opts);
  const execute = Boolean(opts.execute);
  if (!classification.noUi || !plugin.eventID) {
    return {
      ok: true,
      lane: 'native',
      code: 'UI_REQUIRED',
      data: {
        input: classification.input,
        classification,
        plugin,
        executed: false,
        effectiveLane: plugin.lane,
        reasons: classification.reasons,
      },
    };
  }
  if (!execute) {
    return {
      ok: true,
      lane: 'native',
      code: 'ACTION_CANDIDATE',
      data: {
        input: classification.input,
        classification,
        plugin,
        executed: false,
        effectiveLane: 'CLASSIC_ACTION',
        reasons: [
          ...classification.reasons,
          'static probe only; pass --execute to run on a scratch document',
        ],
      },
    };
  }
  const eventID = opts.event || plugin.eventID;
  const docMode = opts.doc === 'active' ? 'active' : 'scratch';
  const jsx = actionJsx({
    eventID,
    params: opts.params || [],
    docMode,
    allowActive: Boolean(opts.allowActive),
    closeScratch: opts.closeScratch !== false,
  });
  try {
    const r = runJsx(jsx, { timeoutMs: opts.timeoutMs || 25000 });
    const result = r.data || {};
    const isInvoke = Boolean(opts.yes);
    if (result.error) {
      return {
        ok: !isInvoke,
        lane: 'native',
        code: 'UI_REQUIRED',
        message: `Photoshop did not accept the ${eventID} action: ${result.error}`,
        data: { input: classification.input, classification, plugin, executed: true, effectiveLane: 'UI_REQUIRED', eventID, result, elapsed: r.elapsed },
      };
    }
    const changed = result.before?.history !== result.after?.history;
    return {
      ok: true,
      lane: 'native',
      code: changed ? 'NO_UI_OK' : 'INCONCLUSIVE',
      data: {
        input: classification.input,
        classification,
        plugin,
        executed: true,
        effectiveLane: changed ? 'NO_UI_OK' : 'INCONCLUSIVE',
        eventID,
        result,
        elapsed: r.elapsed,
      },
    };
  } catch (e) {
    const code = e.code === 'COM_SPAWN_FAILED' ? 'PROBE_TIMEOUT' : e.code === 'JSX_ERROR' ? 'NOT_SCRIPTABLE' : 'PROBE_FAILED';
    return {
      ok: false,
      lane: 'native',
      code,
      message: e.message,
      detail: {
        input: classification.input,
        classification,
        plugin,
        executed: true,
        eventID,
        hint: code === 'PROBE_TIMEOUT'
          ? 'A modal Photoshop dialog may be blocking COM. Run: psdbg dialogs list; dismiss only the error dialog, not a save prompt.'
          : 'The plug-in did not accept the event descriptor; it likely requires its native UI.',
      },
    };
  }
}

export function invokeNative(input, opts = {}) {
  if (!opts.yes) {
    throw new PsError('native invoke is state-changing; pass --yes after reviewing probe output', 'CONFIRM_REQUIRED');
  }
  return probeNative(input, { ...opts, execute: true });
}
