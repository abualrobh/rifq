// RQ-006 v1.3: mounts the mini-player once per tab into the layout's persisted container.
// Not an Astro island on purpose: a persisted island that the router moves before its first
// hydration has finished is hydrated a second time, which React reports as an error (#424, seen in
// the tests on quick page changes). The container is carried into every page (transition:persist)
// with the React root inside it, so the bar never flickers; it renders nothing before the first
// play, so there is nothing to hydrate.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import MiniPlayer from '../islands/MiniPlayer.tsx';

function mount() {
  const el = document.querySelector<HTMLElement>('[data-mini-root]');
  if (!el || el.dataset.mounted === '1') return;
  el.dataset.mounted = '1';
  createRoot(el).render(createElement(MiniPlayer, { lang: document.documentElement.lang === 'en' ? 'en' : 'ar', dev: el.dataset.dev === '1' }));
}
mount();
document.addEventListener('astro:page-load', mount);
