// Static Astro site (D-055). Output goes outside the public repository: the build script sets
// RIFQ_SITE_OUT to a folder in private-data, or to .out/ for synthetic test data.
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  srcDir: './src/site',
  publicDir: './public',
  outDir: process.env.RIFQ_SITE_OUT ?? './.out/site',
  trailingSlash: 'always',
  integrations: [react()],
  build: { inlineStylesheets: 'never', format: 'directory' },
  vite: { plugins: [tailwindcss()] },
  devToolbar: { enabled: false },
  prefetch: false,
});
