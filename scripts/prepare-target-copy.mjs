import path from 'node:path';
import { preparePluginCopy } from '../src/plugin-copy.mjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/prepare-target-copy.mjs <source-uxp-dir> [dest] [id] [name]');
  process.exit(2);
}
const dest = process.argv[3] || path.resolve('.work/target-copy');
const id = process.argv[4] || 'com.psdbg.depthpro';
const name = process.argv[5] || 'Depth Mask Debug';
const result = preparePluginCopy(src, dest, { id, name, label: name });
console.log(JSON.stringify(result));
