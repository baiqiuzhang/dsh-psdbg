import path from 'node:path';
import {
  setupDevtoolsConnection,
  setupCdpSession,
  setupCdpSessionWithUxpDefaults,
  waitForExecutionContextCreated,
  evaluateInUxp,
} from '@bubblydoo/uxp-devtools-common';

const pluginPath = path.resolve(process.argv[2]);
let devtools;
let cdpSession;
try {
  console.log('phase1 devtools');
  devtools = await setupDevtoolsConnection(pluginPath);
  console.log('phase1 ok', devtools.url);
  console.log('phase2 cdp');
  cdpSession = await setupCdpSession(devtools.url);
  console.log('phase2 ok');
  console.log('phase3 context');
  const ctx = await waitForExecutionContextCreated(cdpSession.cdp, async () => {
    await setupCdpSessionWithUxpDefaults(cdpSession.cdp);
  });
  console.log('phase3 ok', ctx.id, ctx.name);
  const conn = { cdpSession, executionContext: ctx, devtoolsConnection: devtools, disconnect: async () => {} };
  for (const expr of ['navigator.userAgent', 'document.querySelector("#generateBtn")?.textContent', 'document.querySelector("#status")?.textContent']) {
    console.log('eval', expr, JSON.stringify(await evaluateInUxp(conn, expr, true)));
  }
} catch (e) {
  console.error('FAILED', e?.stack || e);
} finally {
  try { await cdpSession?.cdp?.close(); } catch {}
  try { await devtools?.teardown(); } catch {}
}
