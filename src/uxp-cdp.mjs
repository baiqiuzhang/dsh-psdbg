import fs from 'node:fs';
import path from 'node:path';
import { createUxpConnection, evaluateInUxp } from '@bubblydoo/uxp-devtools-common';
import { PsError } from './ps-jsx.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'type') && Object.prototype.hasOwnProperty.call(value, 'value')) {
      return normalize(value.value);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}

function js(value) {
  return JSON.stringify(value);
}

export class UxpSession {
  constructor() {
    this.conn = null;
    this.pluginPath = null;
    this.logs = [];
    this.loadedAt = null;
  }

  get loaded() {
    return Boolean(this.conn);
  }

  async load(pluginPath) {
    const abs = path.resolve(pluginPath);
    if (!fs.existsSync(path.join(abs, 'manifest.json'))) {
      throw new PsError(`manifest.json not found: ${abs}`, 'UXP_MANIFEST');
    }
    if (this.conn) await this.unload();
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.conn = await withTimeout(
          createUxpConnection(abs),
          25000,
          () => new PsError('UXP helper did not finish load in 25s', 'UXP_LOAD_TIMEOUT', {
            pluginPath: abs,
            hint: 'A hybrid addon may already be loaded. Restart Photoshop, or use a fresh plugin id.',
          }),
        );
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        this.conn = null;
        await sleep(1200 * attempt);
      }
    }
    if (!this.conn) {
      throw new PsError(`UXP load failed after 3 attempts: ${lastError?.message || lastError}`, 'UXP_LOAD', {
        pluginPath: abs,
      });
    }
    this.pluginPath = abs;
    this.loadedAt = new Date().toISOString();
    this.attachLogs();
    try {
      await this.wait('document.documentElement.clientWidth > 0', 5000);
    } catch {
      // A panel may stay headless if Photoshop has not laid it out yet.
    }
    return await this.info();
  }

  attachLogs() {
    const cdp = this.conn.cdpSession.cdp;
    const push = (kind, text) => {
      this.logs.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 4000) });
      if (this.logs.length > 500) this.logs.shift();
    };
    cdp.Runtime.on('consoleAPICalled', (ev) => {
      const text = (ev.args || [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type)
        .join(' ');
      push(`console.${ev.type || 'log'}`, text);
    });
    cdp.Runtime.on('exceptionThrown', (ev) => {
      const d = ev.exceptionDetails || {};
      push('exception', d.exception?.description || d.text || JSON.stringify(d));
    });
    cdp.Log.on('entryAdded', (ev) => {
      const e = ev.entry || {};
      push(`log.${e.level || 'info'}`, e.text || JSON.stringify(e));
    });
  }

  async eval(expression, awaitPromise = true) {
    if (!this.conn) throw new PsError('no UXP plugin loaded', 'UXP_NOT_LOADED');
    const r = await withTimeout(
      evaluateInUxp(this.conn, expression, awaitPromise),
      20000,
      () => new PsError('UXP eval timed out after 20s', 'EVAL_TIMEOUT', { expression }),
    );
    if (!r.success) {
      throw new PsError(r.error, 'UXP_EVAL', { step: r.errorStep, expression });
    }
    return normalize(r.result?.value);
  }

  async info() {
    if (!this.conn) throw new PsError('no UXP plugin loaded', 'UXP_NOT_LOADED');
    const userAgent = await this.eval('navigator.userAgent');
    const size = await this.eval(
      'JSON.stringify({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight})'
    );
    return {
      pluginPath: this.pluginPath,
      loadedAt: this.loadedAt,
      cdpUrl: this.conn.devtoolsConnection.url,
      userAgent,
      viewport: JSON.parse(size || '{}'),
    };
  }

  async click(selector) {
    return this.eval(
      `(function(){var el=document.querySelector(${js(selector)});if(!el)throw new Error(${js(
        `selector not found: ${selector}`
      )});el.dispatchEvent(new Event('click',{bubbles:true,cancelable:true}));return true;})()`
    );
  }

  async set(selector, value) {
    return this.eval(
      `(function(){var el=document.querySelector(${js(selector)});if(!el)throw new Error(${js(
        `selector not found: ${selector}`
      )});var v=${js(value)};if(el.type==='checkbox'||el.type==='radio'){el.checked=!!v;}else{var p=Object.getPrototypeOf(el);var d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set){d.set.call(el,String(v));}else{el.value=String(v);}}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return (el.type==='checkbox'||el.type==='radio')?el.checked:el.value;})()`
    );
  }

  async text(selector) {
    return this.eval(
      `(function(){var el=document.querySelector(${js(selector)});return el?el.textContent:null;})()`
    );
  }

  async layout(selector) {
    const expr = `(function(){var all=${selector ? `Array.prototype.slice.call(document.querySelectorAll(${js(selector)}))` : `Array.prototype.slice.call(document.querySelectorAll('[id]'))`};return JSON.stringify(all.map(function(el){var r=el.getBoundingClientRect();return {id:el.id,tag:el.tagName,text:(el.textContent||'').trim().slice(0,80),x:r.x,y:r.y,w:r.width,h:r.height,clientW:el.clientWidth,clientH:el.clientHeight,scrollW:el.scrollWidth,scrollH:el.scrollHeight};}));})()`;
    const s = await this.eval(expr);
    return JSON.parse(s || '[]');
  }

  async wait(expression, timeoutMs = 5000, intervalMs = 100) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      try {
        last = await this.eval(`Boolean(${expression})`);
        if (last) return { ok: true, elapsed: Date.now() - started, value: last };
      } catch (e) {
        last = e.message;
      }
      await sleep(intervalMs);
    }
    return { ok: false, elapsed: Date.now() - started, value: last };
  }

  tailLogs(n = 50) {
    return this.logs.slice(-n);
  }

  async unload() {
    if (!this.conn) return { unloaded: false };
    const conn = this.conn;
    this.conn = null;
    this.pluginPath = null;
    try {
      await withTimeout(conn.disconnect(), 5000, () => new Error('disconnect timed out'));
    } catch (e) {
      return { unloaded: true, warning: e.message };
    }
    return { unloaded: true };
  }
}
