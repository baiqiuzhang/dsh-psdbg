import { UxpSession } from '../src/uxp-cdp.mjs';
import { runJsx } from '../src/ps-jsx.mjs';

const name = 'PSDBG Hello';
const jsx = (makeVisible) => `(function(){
  var d=new ActionDescriptor();
  var r=new ActionReference();
  r.putName(charIDToTypeID('Mn  '), ${JSON.stringify(name)});
  d.putReference(charIDToTypeID('null'), r);
  d.putBoolean(charIDToTypeID('MkVs'), ${makeVisible});
  executeAction(charIDToTypeID('slct'), d, DialogModes.NO);
  return 'ok';
})()`;

const s = new UxpSession();
try {
  await s.load('fixtures/uxp-hello');
  for (const mv of [false, true]) {
    try {
      console.log('select makeVisible=' + mv, (await runJsx(jsx(mv))).data);
    } catch (e) {
      console.log('select makeVisible=' + mv, 'ERR', e.message);
    }
    await new Promise((r) => setTimeout(r, 800));
    console.log('viewport', await s.eval('JSON.stringify({cw:document.documentElement.clientWidth,ch:document.documentElement.clientHeight})'));
    console.log('out rect', await s.eval('JSON.stringify(document.querySelector("#out").getBoundingClientRect())'));
  }
} finally {
  await s.unload();
}
