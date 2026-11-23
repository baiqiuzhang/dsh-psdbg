import fs from 'node:fs';
import path from 'node:path';
import { UxpSession } from '../src/uxp-cdp.mjs';
import { runJsx } from '../src/ps-jsx.mjs';
import { BRIDGE_ROOT } from '../src/config.mjs';

const s = new UxpSession();
try {
  await s.load('fixtures/uxp-hello');
  console.log('info before', await s.info());
  const listJsx = fs.readFileSync(path.join(BRIDGE_ROOT, 'src', 'jsx', 'panelList.jsx'), 'utf8');
  const beforeRaw = await runJsx(listJsx);
  console.log('beforeRaw', JSON.stringify(beforeRaw).slice(0, 500));
  const before = beforeRaw.data;
  console.log('has hello', before.filter((p) => p.name.includes('PSDBG')));
  const showJsx = `(function(){var p=${JSON.stringify('PSDBG Hello')};var d=new ActionDescriptor();var r=new ActionReference();r.putName(charIDToTypeID('Mn  '),p);d.putReference(charIDToTypeID('null'),r);d.putBoolean(charIDToTypeID('MkVs'),true);executeAction(charIDToTypeID('slct'),d,DialogModes.NO);return 'ok';})()`;
  console.log('show', (await runJsx(showJsx)).data);
  await new Promise((r) => setTimeout(r, 1000));
  console.log('info after', await s.info());
  console.log('layout', await s.layout());
  console.log('dom', await s.eval('JSON.stringify({body:document.body.getBoundingClientRect(), html:document.documentElement.getBoundingClientRect(), cw:document.documentElement.clientWidth, ch:document.documentElement.clientHeight})'));
} finally {
  await s.unload();
}
