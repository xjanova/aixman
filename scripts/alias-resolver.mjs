import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The file tsc would pick for an extensionless path, or null. */
function asTypeScript(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * `@/lib/pricing` → `<root>/src/lib/pricing.ts`, trying the extensions tsc would.
 *
 * Relative imports inside the project's own TypeScript get the same treatment
 * (`./tunables` → `./tunables.ts`, and `./x.js` → `./x.ts` where only the
 * `.ts` exists, as the generated Prisma client writes them): Next's bundler
 * resolves both, Node does not, and without it no module that imports a
 * sibling could be tested with `node --test`.
 */
export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const hit = asTypeScript(path.join(root, 'src', specifier.slice(2)));
    if (hit) return next(pathToFileURL(hit).href, context);
    return next(specifier, context);
  }

  const parent = context.parentURL;
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && parent?.startsWith('file:')) {
    const parentPath = fileURLToPath(parent);
    if (/\.(m?ts|tsx)$/.test(parentPath) && parentPath.startsWith(root)) {
      const base = path.resolve(path.dirname(parentPath), specifier);
      if (!existsSync(base) || statSync(base).isDirectory()) {
        const hit = asTypeScript(base) ?? (base.endsWith('.js') ? asTypeScript(base.slice(0, -3)) : null);
        if (hit) return next(pathToFileURL(hit).href, context);
      }
    }
  }
  return next(specifier, context);
}

/**
 * A JSON import written without `with { type: 'json' }` — how the catalogue
 * imports its workflow templates, which the bundler accepts and Node refuses —
 * is served as an ES module whose default export is the parsed document.
 */
export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json') && context.importAttributes?.type !== 'json') {
    const source = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'module', source: `export default ${source};`, shortCircuit: true };
  }
  return next(url, context);
}
