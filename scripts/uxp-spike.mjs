import fs from 'node:fs';
import path from 'node:path';
import { createUxpConnection, evaluateInUxp } from '@bubblydoo/uxp-devtools-common';

const pluginPath = path.resolve(process.argv[2] || 'fixtures/uxp-hello');
console.log('pluginPath', pluginPath);
let conn;
try {
  conn = await createUxpConnection(pluginPath);
  console.log('connected', conn.devtoolsConnection.url);
  const expressions = [
    'document.title',
    'document.querySelector("#out").textContent',
    'window.__psdbg.ping("ok")',
    'window.__psdbg.add(2, 3)',
    'document.querySelector("#hello").click(), document.querySelector("#out").textContent',
    'JSON.stringify(window.__events)',
    'document.querySelector("#hello").dispatchEvent(new Event("click", {bubbles:true})), document.querySelector("#out").textContent',
    'JSON.stringify(window.__events)',
    '({width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, html: document.documentElement.outerHTML.length})',
    'navigator.userAgent',
  ];
  for (const expression of expressions) {
    const r = await evaluateInUxp(conn, expression, true);
    console.log(JSON.stringify({ expression, r }));
  }
  try {
    const metrics = await conn.cdpSession.cdp.Page.getLayoutMetrics();
    console.log('layoutMetrics', JSON.stringify(metrics));
  } catch (e) {
    console.log('layoutMetrics failed', e.message);
  }
  try {
    const shot = await conn.cdpSession.cdp.Page.captureScreenshot({ format: 'png', fromSurface: true });
    fs.mkdirSync('out', { recursive: true });
    fs.writeFileSync(path.join('out', 'plugin.png'), Buffer.from(shot.data, 'base64'));
    console.log('screenshot bytes', shot.data.length);
  } catch (e) {
    console.log('captureScreenshot failed', e.message);
  }
} finally {
  if (conn) await conn.disconnect();
}
