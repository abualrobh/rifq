// RQ-008 AC3 (D-180 A, kit v37): the Read tab opens the last reading position (RQ-003) when one is
// saved on this device and is in this build's source; otherwise it keeps its static target, the
// surah index. Nothing is sent anywhere: the position is read from the device on each page and the
// link's address is changed in the page only. Runs on the first load and after every in-place page
// change (astro:page-load), and again when another tab changes the saves (storage event).
import { getStorage, load, refExists } from '../../core/store.ts';
import { ayahPath, indexPath, type Lang } from '../../core/strings.ts';

function update() {
  const navs = document.querySelectorAll<HTMLElement>('nav[data-tabbar]');
  if (!navs.length) return;
  const counts = [0, ...(navs[0].dataset.counts ?? '').split(',').map(Number)];
  const lang: Lang = navs[0].dataset.lang === 'en' ? 'en' : 'ar';
  const last = load(getStorage(window)).saves.l;
  const href = last && refExists(counts, last) ? ayahPath(lang, last[0], last[1]) : indexPath(lang);
  for (const a of document.querySelectorAll<HTMLAnchorElement>('nav[data-tabbar] a[data-tab="read"]')) a.setAttribute('href', href);
}

// AC6, AC7: the phone bar's height (it grows with text zoom and the safe area) as --tabbar-h, so the
// page, the mini-player and the reader's player keep room for it; 0 where it is hidden (52rem up).
let ro: ResizeObserver | null = null;
function measure() {
  ro?.disconnect();
  const bar = document.querySelector<HTMLElement>('nav[data-tabbar="bottom"]');
  const root = document.documentElement;
  if (!bar) { root.style.removeProperty('--tabbar-h'); return; }
  const set = () => root.style.setProperty('--tabbar-h', Math.ceil(bar.getBoundingClientRect().height) + 'px');
  set();
  ro = new ResizeObserver(set);
  ro.observe(bar);
}

const w = (typeof window === 'undefined' ? {} : window) as unknown as { __rifqTabs?: boolean };
if (typeof document !== 'undefined' && !w.__rifqTabs) {
  w.__rifqTabs = true;
  document.addEventListener('astro:page-load', () => { update(); measure(); });
  window.addEventListener('storage', update);
  // The D-062 rule saves the position while the reader reads; refresh the link just before it is
  // followed, so it never points at an older place.
  document.addEventListener('pointerdown', (e) => { if ((e.target as Element | null)?.closest?.('a[data-tab="read"]')) update(); }, { capture: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target as Element | null)?.closest?.('a[data-tab="read"]')) update(); }, { capture: true });
  update();
  measure();
}
