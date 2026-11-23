import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_ROOT } from './config.mjs';
import { PsError, runJsx } from './ps-jsx.mjs';

const PANEL_LIST_JSX = fs.readFileSync(path.join(BRIDGE_ROOT, 'src', 'jsx', 'panelList.jsx'), 'utf8');

// Built-in palette toggles are language-neutral menu IDs. They are the most
// reliable path when the generic `slct`/`setd` action is unavailable.
const PALETTE_TOGGLES = new Map([
  ['图层', 'toggleLayersPalette'],
  ['layers', 'toggleLayersPalette'],
  ['通道', 'toggleChannelsPalette'],
  ['channels', 'toggleChannelsPalette'],
  ['路径', 'togglePathsPalette'],
  ['paths', 'togglePathsPalette'],
  ['历史记录', 'toggleHistoryPalette'],
  ['history', 'toggleHistoryPalette'],
  ['信息', 'toggleInfoPalette'],
  ['info', 'toggleInfoPalette'],
  ['颜色', 'toggleColorPalette'],
  ['color', 'toggleColorPalette'],
  ['色板', 'toggleSwatchesPalette'],
  ['swatches', 'toggleSwatchesPalette'],
  ['画笔', 'toggleBrushesPalette'],
  ['brushes', 'toggleBrushesPalette'],
  ['字符', 'toggleCharacterPalette'],
  ['character', 'toggleCharacterPalette'],
  ['段落', 'toggleParagraphPalette'],
  ['paragraph', 'toggleParagraphPalette'],
  ['动作', 'toggleActionsPalette'],
  ['actions', 'toggleActionsPalette'],
  ['属性', 'togglePropertiesPalette'],
  ['properties', 'togglePropertiesPalette'],
  ['导航器', 'toggleNavigatorPalette'],
  ['navigator', 'toggleNavigatorPalette'],
  ['直方图', 'toggleHistogramPalette'],
  ['histogram', 'toggleHistogramPalette'],
  ['图层复合', 'toggleLayerCompsPalette'],
  ['layer comps', 'toggleLayerCompsPalette'],
  ['调整', 'toggleAdjustmentsPalette'],
  ['adjustments', 'toggleAdjustmentsPalette'],
  ['时间轴', 'toggleAnimationPalette'],
  ['timeline', 'toggleAnimationPalette'],
  ['注释', 'toggleAnnotationPalette'],
  ['annotation', 'toggleAnnotationPalette'],
  ['测量记录', 'toggleMeasurementPalette'],
  ['measurement', 'toggleMeasurementPalette'],
  ['工具预设', 'toggleToolPresetsPalette'],
  ['tool presets', 'toggleToolPresetsPalette'],
]);

const ALIASES = new Map([
  ['layer', '图层'], ['layers', '图层'],
  ['channel', '通道'], ['channels', '通道'],
  ['path', '路径'], ['paths', '路径'],
  ['history', '历史记录'],
  ['info', '信息'],
  ['color', '颜色'], ['colour', '颜色'],
  ['swatches', '色板'],
  ['brush', '画笔'], ['brushes', '画笔'],
  ['character', '字符'],
  ['paragraph', '段落'],
  ['actions', '动作'],
  ['properties', '属性'],
  ['navigator', '导航器'],
  ['histogram', '直方图'],
  ['layer comps', '图层复合'], ['layercomp', '图层复合'],
  ['adjustments', '调整'],
  ['timeline', '时间轴'], ['animation', '时间轴'],
  ['annotation', '注释'],
  ['measurement', '测量记录'],
  ['tool presets', '工具预设'],
]);

function norm(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function listPanels() {
  const r = await runJsx(PANEL_LIST_JSX);
  if (!Array.isArray(r.data)) throw new PsError('panelList did not return an array', 'PANEL_LIST_BAD');
  return r.data;
}

function findPanel(panels, query) {
  const q = norm(query);
  const alias = ALIASES.get(q);
  const candidates = new Set([q, alias ? norm(alias) : null].filter(Boolean));
  return panels.find((p) => {
    const name = norm(p.name);
    const id = norm(p.id);
    if (candidates.has(name) || candidates.has(id)) return true;
    if (id.endsWith('/' + q)) return true;
    if (id.includes(q)) return true;
    return false;
  }) ?? null;
}

function toggleIdFor(panel, query) {
  for (const key of [norm(query), norm(panel?.name), norm(panel?.id)]) {
    if (!key) continue;
    if (PALETTE_TOGGLES.has(key)) return PALETTE_TOGGLES.get(key);
    const alias = ALIASES.get(key);
    if (alias && PALETTE_TOGGLES.has(norm(alias))) return PALETTE_TOGGLES.get(norm(alias));
  }
  return null;
}

async function runMenuToggle(toggleId) {
  return runJsx(`
    app.runMenuItem(stringIDToTypeID(${JSON.stringify(toggleId)}));
    return { ran: ${JSON.stringify(toggleId)} };
  `);
}

async function trySelect(panel, visible) {
  const attempts = [];
  for (const useId of [false, true]) {
    const refExpr = useId
      ? `ref.putIdentifier(charIDToTypeID('ID  '), stringIDToTypeID(${JSON.stringify(panel.id)}));`
      : `ref.putName(charIDToTypeID('NmL '), ${JSON.stringify(panel.name)});`;
    const code = `
      var ref = new ActionReference();
      ref.putClass(stringIDToTypeID('panel'));
      ${refExpr}
      var d = new ActionDescriptor();
      d.putReference(charIDToTypeID('null'), ref);
      d.putBoolean(charIDToTypeID('setd'), ${visible ? 'true' : 'false'});
      executeAction(charIDToTypeID('slct'), d, DialogModes.NO);
      return { selected: ${useId ? "'id'" : "'name'"} };
    `;
    try {
      const r = await runJsx(code);
      attempts.push({ useId, ok: true, data: r.data });
      return attempts;
    } catch (e) {
      attempts.push({ useId, ok: false, error: e.message });
    }
  }
  return attempts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function setPanel(query, visible, opts = {}) {
  const before = await listPanels();
  const target = findPanel(before, query);
  if (!target) {
    const names = before.map((p) => p.name).filter(Boolean);
    throw new PsError(`Panel not found: ${query}`, 'PANEL_NOT_FOUND', { available: names });
  }
  if (target.visible === visible) {
    return { changed: false, panel: target, before: target.visible, after: target.visible };
  }

  const toggleId = toggleIdFor(target, query);
  const attempts = [];
  if (toggleId) {
    attempts.push({ kind: 'runMenuItem', id: toggleId });
    await runMenuToggle(toggleId);
  } else {
    attempts.push({ kind: 'slct', panel: target.name, id: target.id });
    attempts.push(...(await trySelect(target, visible)));
  }

  await sleep(opts.settleMs ?? 350);
  const after = await listPanels();
  const final = findPanel(after, target.id || target.name);
  if (final && final.visible === visible) {
    return { changed: true, panel: final, before: target.visible, after: final.visible, attempts };
  }

  throw new PsError(
    `Panel ${target.name} did not reach visible=${visible}`,
    'PANEL_NOT_CONTROLLABLE',
    {
      panel: final ?? target,
      before: target.visible,
      after: final?.visible ?? null,
      attempts,
      hint: 'Built-in palettes use runMenuItem toggle ids. Dynamic UXP panels may need the UXP CDP or UIA menu path.',
    }
  );
}

export async function togglePanel(query) {
  const before = await listPanels();
  const target = findPanel(before, query);
  if (!target) throw new PsError(`Panel not found: ${query}`, 'PANEL_NOT_FOUND');
  return setPanel(target.id || target.name, !target.visible);
}
