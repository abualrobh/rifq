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
  // RQ-009 v0.3 (kit v43): the first ayah of each Mushaf page (604 numbers, s * 1000 + a; no Quran
  // text), set by scripts/build.ts in development builds, for the browser's page lookups. null in a
  // release build: page mode is left out (AC50).
  vite: { plugins: [tailwindcss()], define: { __RIFQ_PAGE_STARTS__: process.env.RIFQ_PAGE_STARTS ?? 'null' } },
  devToolbar: { enabled: false },
  prefetch: false,
});
