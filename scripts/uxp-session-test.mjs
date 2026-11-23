import { UxpSession } from '../src/uxp-cdp.mjs';

const s = new UxpSession();
try {
  console.log('load', await s.load('fixtures/uxp-hello'));
  console.log('text', await s.text('#out'));
  console.log('click', await s.click('#hello'));
  console.log('text2', await s.text('#out'));
  console.log('set input', await s.set('#name', 'xyz'));
  console.log('set select', await s.set('#mode', 'b'));
  console.log('layout', await s.layout('#out, #name, #mode'));
  console.log('wait', await s.wait('document.querySelector("#out").textContent.indexOf("clicked")===0', 2000));
  console.log('logs', s.tailLogs(5));
} finally {
  console.log('unload', await s.unload());
}
