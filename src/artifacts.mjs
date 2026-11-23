import fs from 'node:fs';
import path from 'node:path';

export function extractArtifacts(output, extension) {
  const exts = Array.isArray(extension) ? extension : [extension];
  const found = new Map();
  const re = /->\s+(.+?\.(?:8bf|8be|8li|plugin|uxpaddon))\s*$/gim;
  let m;
  while ((m = re.exec(output || ''))) {
    const file = m[1].trim().replace(/^["']|["']$/g, '');
    if (exts.some((ext) => file.toLowerCase().endsWith(ext))) {
      try {
        const st = fs.statSync(file);
        found.set(file, { path: file, name: path.basename(file), size: st.size, mtime: st.mtime.toISOString() });
      } catch {
        // MSBuild may report a path on another drive; keep the string anyway.
        found.set(file, { path: file, name: path.basename(file), size: null, mtime: null });
      }
    }
  }
  return [...found.values()];
}

export function findArtifacts(root, extension, opts = {}) {
  const start = path.resolve(root);
  const maxDepth = opts.maxDepth ?? 8;
  const out = [];
  const exts = Array.isArray(extension) ? extension : [extension];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'obj', '.vs'].includes(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile() && exts.includes(path.extname(entry.name).toLowerCase())) {
        const st = fs.statSync(full);
        out.push({ path: full, name: entry.name, size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  }
  walk(start, 0);
  out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return out;
}
