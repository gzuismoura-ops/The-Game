// Static verification of the offline shell: every asset the SW precaches must exist,
// and the built index.html must reference files that are actually in dist/.
import { readFileSync, existsSync } from 'node:fs';
const dist = '/home/user/The-Game/dist';
let fail = 0;
const check = (label, ok, extra='') => { console.log(`${ok?'PASS':'FAIL'} ${label}${extra?' — '+extra:''}`); if(!ok) fail++; };

const sw = readFileSync(`${dist}/sw.js`, 'utf8');
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
check('sw precache list parsed', assets.length >= 5, assets.length + ' entries');
for (const a of assets) {
  const p = a === '' ? `${dist}/index.html` : `${dist}/${a}`;
  check(`precached: ${a||'(root)'}`, existsSync(p));
}

const html = readFileSync(`${dist}/index.html`, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m => m[1]);
const unique = [...new Set(refs)];
let missing = 0;
for (const r of unique) {
  if (!existsSync(`${dist}/${r}`)) { missing++; console.log(`  MISSING referenced asset: ${r}`); }
}
check('all index.html asset references exist in dist', missing === 0, `${unique.length} refs checked`);
check('manifest declares icons', JSON.parse(readFileSync(`${dist}/manifest.webmanifest`,'utf8')).icons.length === 10);
check('service worker file is present', existsSync(`${dist}/sw.js`));
console.log(fail === 0 ? '\nOFFLINE SHELL OK' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
