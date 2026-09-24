/**
 * Resolves the project's `@/…` alias for `node --test`.
 *
 * The codebase imports through `@/lib/...` everywhere, and tsconfig maps that
 * to `src/`. Node knows nothing about tsconfig, so a plain `node --test` on a
 * file that uses the alias fails to resolve it. Writing the tests with
 * relative `.ts` paths instead made Node happy and broke `tsc`, which rejects
 * an explicit `.ts` extension — so the alias stays, and this teaches Node
 * about it in nine lines rather than pulling in a test framework.
 *
 * Usage: npm test  (every .test.mts in a __tests__ folder under src; needs
 *        Node 22.7+ for --experimental-transform-types, since WorkerClient
 *        uses parameter properties)
 *    or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test <file>
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./alias-resolver.mjs', pathToFileURL(import.meta.filename));
