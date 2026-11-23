import fs from 'node:fs';
import path from 'node:path';

const NATIVE_EXTENSIONS = new Set(['.8bf', '.8be', '.8li', '.8ba', '.8bx', '.plugin']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function resolveInput(input) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`not found: ${abs}`);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const manifest = path.join(abs, 'manifest.json');
    if (fs.existsSync(manifest)) return { kind: 'uxp-dir', dir: abs, manifest };
    return { kind: 'dir', dir: abs, manifest: null };
  }
  const ext = path.extname(abs).toLowerCase();
  if (path.basename(abs).toLowerCase() === 'manifest.json') return { kind: 'uxp-manifest', file: abs, dir: path.dirname(abs) };
  if (ext === '.json') return { kind: 'pipl', file: abs, dir: path.dirname(abs) };
  if (NATIVE_EXTENSIONS.has(ext)) return { kind: 'native-binary', file: abs, dir: path.dirname(abs) };
  return { kind: 'unknown', file: abs, dir: path.dirname(abs) };
}

function flattenEvents(terminology) {
  const events = [];
  const suites = terminology?.Suites;
  if (!Array.isArray(suites)) return events;
  for (const suite of suites) {
    const list = Array.isArray(suite?.Events) ? suite.Events : [];
    for (const ev of list) {
      if (typeof ev === 'string') {
        events.push({ name: ev, eventID: null, classID: suite.SuitID ?? null });
      } else if (ev && typeof ev === 'object') {
        events.push({
          name: ev.EventName ?? null,
          eventID: ev.EventType ?? ev.EventID ?? null,
          classID: ev.ClassID ?? suite.SuitID ?? null,
          directParamType: ev.DirectParamType ?? null,
          replyType: ev.ReplyType ?? null,
        });
      }
    }
  }
  return events;
}

export function classifyPipl(data, opts = {}) {
  const list = Array.isArray(data?.PiPLs) ? data.PiPLs : [data];
  return list.filter(Boolean).map((p) => {
    const terminology = p.Terminology || {};
    const events = flattenEvents(terminology);
    const hasTerminology = Boolean(p.HasTerminology);
    const entry = p.CodeEntryPointWin64 || p.CodeEntryPoint || null;
    const classID = p.HasTerminology?.ClassID ?? events[0]?.classID ?? null;
    const eventID = p.HasTerminology?.EventID ?? events[0]?.eventID ?? null;
    const isAutomation = entry === 'AutoPluginMain' || String(p.Kind).toLowerCase() === 'actions';
    const hasActionableTerminology = hasTerminology && Boolean(eventID) && (isAutomation || events.length > 0);
    // Only AutoPluginMain can be treated as no-UI by static inspection. A
    // regular Filter with HasTerminology is a candidate, but Photoshop may
    // still reject the action (Nik CE4: event sdk1 is "not available").
    const noUi = hasActionableTerminology && isAutomation;
    const reasons = [];
    if (!hasTerminology) reasons.push('PiPL has no HasTerminology; Photoshop cannot drive it through Action Manager');
    if (hasTerminology && !eventID) reasons.push('HasTerminology has no EventID');
    if (isAutomation) reasons.push('entry point is AutoPluginMain');
    if (events.length > 0) reasons.push(`Terminology events: ${events.map((e) => e.name || e.eventID).join(', ')}`);
    if (hasTerminology && events.length === 0) reasons.push('HasTerminology is present but Terminology has no event descriptors');
    if (hasActionableTerminology && !isAutomation) {
      reasons.push('Terminology event exists but entry point is not AutoPluginMain; verify with native probe --execute');
    }
    return {
      name: p.Name ?? null,
      kind: p.Kind ?? null,
      category: p.Category ?? null,
      componentName: p.ComponentName ?? null,
      entryPoint: entry,
      hasTerminology,
      classID,
      eventID,
      scopeString: p.HasTerminology?.ScopeString ?? null,
      events,
      lane: noUi ? 'CLASSIC_ACTION' : 'UI_REQUIRED',
      noUi,
      requiresUi: !noUi,
      candidate: hasActionableTerminology && !isAutomation,
      confidence: noUi ? 'high' : hasActionableTerminology ? 'medium' : 'high',
      reasons,
    };
  });
}

export function classifyPlugin(input) {
  const target = resolveInput(input);
  if (target.kind === 'uxp-dir' || target.kind === 'uxp-manifest') {
    const manifest = readJson(target.manifest);
    const addon = manifest.addon?.name || manifest.requiredPermissions?.enableAddon;
    const entrypoints = manifest.entrypoints || manifest.entryPoints || [];
    const hybrid = Boolean(addon);
    return {
      input: path.resolve(input),
      lane: hybrid ? 'HYBRID_ADDON' : 'UXP_CDP',
      noUi: true,
      requiresUi: false,
      confidence: 'high',
      manifest: {
        id: manifest.id ?? null,
        name: manifest.name ?? null,
        version: manifest.version ?? null,
        manifestVersion: manifest.manifestVersion ?? null,
        host: manifest.host ?? null,
        addon: manifest.addon ?? null,
        entrypoints,
      },
      reasons: [
        hybrid ? 'manifest declares a native addon (UXP Hybrid)' : 'manifest is a UXP plugin',
        'loaded through UXP DevTools/CDP; no OS mouse needed',
      ],
    };
  }
  if (target.kind === 'pipl') {
    const data = readJson(target.file);
    const plugins = classifyPipl(data);
    return {
      input: target.file,
      lane: plugins.every((p) => p.noUi) ? 'CLASSIC_ACTION' : 'UI_REQUIRED',
      noUi: plugins.every((p) => p.noUi),
      requiresUi: plugins.some((p) => p.requiresUi),
      confidence: plugins.every((p) => p.confidence === 'high') ? 'high' : 'medium',
      plugins,
      reasons: plugins.flatMap((p) => p.reasons),
    };
  }
  if (target.kind === 'native-binary') {
    return {
      input: target.file,
      lane: 'UNKNOWN',
      noUi: false,
      requiresUi: true,
      confidence: 'low',
      reasons: [
        'binary has no inline PiPL JSON; pass the matching PiPLs.json to classify its scripting capability',
        'a .8bf/.8li is not a UXP plugin and cannot be driven through the UXP CDP lane',
      ],
    };
  }
  return {
    input: path.resolve(input),
    lane: 'UNKNOWN',
    noUi: false,
    requiresUi: true,
    confidence: 'low',
    reasons: ['unrecognized plugin input'],
  };
}

export function capabilitiesSummary() {
  return {
    lanes: [
      { lane: 'ES_COM', noUi: true, description: 'ExtendScript/COM; Action Manager and runMenuItem' },
      { lane: 'UXP_CDP', noUi: true, description: 'UXP plugin DOM via DevTools/CDP; synthetic events' },
      { lane: 'HYBRID_ADDON', noUi: true, description: 'UXP Hybrid .uxpaddon functions via require()' },
      { lane: 'CLASSIC_ACTION', noUi: true, description: 'scripting-aware classic plug-in via executeAction' },
      { lane: 'UI_REQUIRED', noUi: false, description: 'native filter UI; no generic headless path' },
    ],
    notes: [
      'Native menu bars are not exposed through GetMenu or UIA on PS 26.0; arbitrary menu automation is not supported.',
      'Non-scripting classic filters require their own UI; the bridge will report UI_REQUIRED instead of clicking pixels.',
    ],
  };
}
