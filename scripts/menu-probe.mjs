import { runJsx } from '../src/ps-jsx.mjs';

const ids = [
  'toggleLayersPalette',
  'toggleChannelsPalette',
  'toggleHistoryPalette',
  'toggleActionsPalette',
  'togglePluginsPanel',
  'toggleDepthMaskPalette',
  'toggleDepthMask',
  'toggleDepth Mask',
  'togglecomzk21depthpro',
  'comzk21depthpro',
  'com.zk21.depthpro',
  'togglecom.zk21.depthpro',
  'depthMaskPanel',
  'toggledepthMaskPanel',
  'togglePSDBGHello',
  'togglePSDBG Hello',
  'psdbgHelloPanel',
  'togglepsdbgHelloPanel',
  'compsdbghello',
  'togglecompsdbghello',
  'toggleSpectrumPanel',
  'toggleSpectrum',
];

const lines = ids.map((id) => {
  const safe = JSON.stringify(id);
  return `try { var r = app.runMenuItem(stringIDToTypeID(${safe})); out.push({id:${safe}, via:'stringIDToTypeID', result:String(r)}); } catch(e) { out.push({id:${safe}, via:'stringIDToTypeID', error:String(e)}); }
try { var r2 = app.runMenuItem(${safe}); out.push({id:${safe}, via:'literal', result:String(r2)}); } catch(e2) { out.push({id:${safe}, via:'literal', error:String(e2)}); }`;
});
const jsx = `(function(){var out=[];${lines.join('\n')}return JSON.stringify(out);})()`;
const r = await runJsx(jsx);
console.log(JSON.stringify(r.data, null, 2));
