// Static import/export verification across the whole source tree.
// Catches the class of bug that only shows up as a blank screen in the browser.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const SRC = 'src';
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((f) => relative(process.cwd(), f));
const keys = new Set(files);
const exportsOf = new Map();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((x) => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); });
  }
  if (/export\s+default/.test(s)) names.add('default');
  exportsOf.set(f, names);
}

let errors = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /import\s+(?:([\w*\s{},$]+?)\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;      // three, etc.
    const target = relative(process.cwd(), resolve(dirname(f), spec));
    const targetFile = keys.has(target) ? target : `${target}.js`;
    if (!keys.has(targetFile)) {
      // CSS imports are fine
      if (!/\.(css|png|jpg|json|webmanifest)$/.test(spec)) {
        console.log(`MISSING FILE  ${f} -> ${spec}`);
        errors++;
      }
      continue;
    }
    const clause = (m[1] || '').trim();
    const braced = clause.match(/\{([^}]*)\}/);
    if (!braced) continue;
    for (const raw of braced[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const [orig, alias] = part.split(/\s+as\s+/).map((x) => x.trim());
      const avail = exportsOf.get(targetFile);
      if (!avail.has(orig)) {
        console.log(`MISSING EXPORT  ${f}: "${orig}" not exported by ${spec}`);
        errors++;
      }
    }
  }
}
console.log(errors === 0 ? `OK — ${files.length} modules, all imports resolve` : `${errors} import problem(s)`);
process.exit(errors ? 1 : 0);
