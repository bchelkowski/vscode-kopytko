import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://bchelkowski.github.io',
  base: '/vscode-kopytko',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@brs-grammar': fileURLToPath(
          new URL('../syntaxes/brightscript.tmLanguage.json', import.meta.url)
        ),
        // Use local TypeScript sources so the site always reflects the
        // latest changes without waiting for an npm publish.
        'kopytko-brightscript-parser': fileURLToPath(
          new URL('../packages/brightscript-parser/src/index.ts', import.meta.url)
        ),
        'kopytko-formatter': fileURLToPath(
          new URL('../packages/formatter/src/index.ts', import.meta.url)
        ),
        'kopytko-linter': fileURLToPath(
          new URL('./src/stubs/linter-browser.ts', import.meta.url)
        ),
        // Browser stubs for Node.js built-ins used by the linter (config loading
        // and filesystem scanning — neither of which runs in the playground).
        'fs':        fileURLToPath(new URL('./src/stubs/fs.ts',   import.meta.url)),
        'node:fs':   fileURLToPath(new URL('./src/stubs/fs.ts',   import.meta.url)),
        'path':      fileURLToPath(new URL('./src/stubs/path.ts', import.meta.url)),
        'node:path': fileURLToPath(new URL('./src/stubs/path.ts', import.meta.url)),
      },
    },
    server: {
      fs: { allow: ['..'] },
    },
  },
});
