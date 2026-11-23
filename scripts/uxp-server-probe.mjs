import DevToolsHelper from '@adobe-fixed-uxp/uxp-devtools-helper';
import Server from '@adobe-fixed-uxp/uxp-devtools-core/core/service/Server';

globalThis.UxpLogger = {
  error: (...a) => console.error('[uxp]', ...a),
  warn: (...a) => console.warn('[uxp]', ...a),
  info: (...a) => console.log('[uxp]', ...a),
  debug: () => {},
  verbose: () => {},
};

const port = Number(process.argv[2] || 14021);
const helper = new DevToolsHelper(true);
const server = new Server(port);
server.run();
helper.setServerDetails(port);
server.on('socketConnection', (_socket, req) => {
  console.log('socketConnection', req?.url);
});
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const clients = [...server.clients.values()];
  console.log(i + 1, 'clients', clients.length, clients.map((c) => c?.constructor?.name));
  if (clients.some((c) => c?.constructor?.name === 'AppClient')) break;
}
try { await server.close(); } catch (e) { console.error('close', e.message); }
try { helper.terminate(); } catch (e) { console.error('term', e.message); }
