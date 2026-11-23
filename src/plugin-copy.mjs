import fs from 'node:fs';
import path from 'node:path';

export function preparePluginCopy(src, dest, opts = {}) {
  const source = path.resolve(src);
  const target = path.resolve(dest);
  if (!fs.existsSync(path.join(source, 'manifest.json'))) {
    throw new Error(`manifest.json not found in ${source}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });

  const manifestPath = path.join(target, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (opts.id) m.id = opts.id;
  if (opts.name) m.name = opts.name;
  if (opts.label) {
    const list = m.entrypoints || m.entryPoints || [];
    for (const ep of list) {
      if (ep.label && typeof ep.label === 'object') ep.label.default = opts.label;
      else if (ep.label) ep.label = opts.label;
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf8');
  return { dest: target, id: m.id, name: m.name, manifest: m };
}
