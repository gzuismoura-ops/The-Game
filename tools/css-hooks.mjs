// Node module hook: make `import './style.css'` a no-op for headless testing.
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
`));
