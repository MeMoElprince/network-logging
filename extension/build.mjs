import { build, context } from 'esbuild';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';
await mkdir(outdir, { recursive: true });

const entryPoints = {
  inject: 'src/inject.ts',
  content: 'src/content.ts',
  background: 'src/background.ts',
  popup: 'src/popup.ts',
};

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
  legalComments: 'none',
};

async function copyStatic() {
  await copyFile('manifest.json', join(outdir, 'manifest.json'));
  await copyFile('src/popup.html', join(outdir, 'popup.html'));
}

if (watch) {
  const ctxs = await Promise.all(
    Object.entries(entryPoints).map(([name, entry]) =>
      context({ ...common, entryPoints: [entry], outfile: `${outdir}/${name}.js` }),
    ),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatic();
  console.log('[ext] watching...');
} else {
  await Promise.all(
    Object.entries(entryPoints).map(([name, entry]) =>
      build({ ...common, entryPoints: [entry], outfile: `${outdir}/${name}.js` }),
    ),
  );
  await copyStatic();
  console.log('[ext] built ->', outdir);
}
