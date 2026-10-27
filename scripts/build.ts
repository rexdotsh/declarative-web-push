import { $ } from 'bun';
import { rm } from 'node:fs/promises';
import pkg from '../package.json' with { type: 'json' };

await rm('dist', { recursive: true, force: true });
await Bun.build({
  entrypoints: Object.values(pkg.exports).map((entry) => entry.default.replace(/^\.\/dist\/(.*)\.js$/, 'src/$1.ts')),
  root: 'src',
  outdir: 'dist',
  target: 'browser',
  format: 'esm',
});
await $`tsc -p tsconfig.build.json`;
