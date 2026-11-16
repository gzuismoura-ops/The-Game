import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const libDir = '/tmp/nssfull/dist/Linux6.1_x86_64_cc_glibc_PTH_64_DBG.OBJ/lib';
const env = { ...process.env };
if (existsSync(libDir)) {
  env.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  console.log('using libs from', libDir);
}
const exe = await chromium.executablePath();
const b = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  executablePath: exe, headless: true, env,
});
const p = await b.newPage();
p.on('console', (m) => console.log('[console]', m.type(), m.text()));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.setContent('<canvas id=c width=128 height=128></canvas>');
const info = await p.evaluate(() => {
  const c = document.getElementById('c');
  const gl = c.getContext('webgl2');
  if (!gl) return 'NO WEBGL2';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { ver: gl.getParameter(gl.VERSION), renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a', maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
});
console.log('WEBGL:', JSON.stringify(info));
await b.close();
