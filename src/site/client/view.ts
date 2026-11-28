// RQ-009 v0.3 (D-286, kit v43): the reading view (scroll or Mushaf pages) and page lookups in the
// browser. The view choice is kept on the device only, in rifq.settings next to size, theme and
// reciter (AC4); it is never sent anywhere. With page mode the stored view, reader links (the Read
// tab, the continue card, recently read, bookmark cards, Go to results, juz items, ayah links) open
// the Mushaf page holding their ayah, with that ayah in view (AC5, AC24 to AC26): they are
// rewritten here, in the capture phase, before the in-place router reads them.
import { MUSHAF_PATH, mushafHash, mushafPath, pageOf } from '../../core/mushaf.ts';
import { t, type Lang } from '../../core/strings.ts';
import { topRow } from './place.ts';

declare const __RIFQ_PAGE_STARTS__: number[] | null;
export const STARTS: number[] | null = typeof __RIFQ_PAGE_STARTS__ === 'undefined' ? null : __RIFQ_PAGE_STARTS__;
export const pagesOn = () => !!STARTS && STARTS.length === 605;
export const pageFor = (s: number, a: number) => (STARTS ? pageOf(STARTS, s, a) : 0);

const KEY = 'rifq.settings';
export type View = 'scroll' | 'pages';
export function readView(): View {
  if (!pagesOn()) return 'scroll';
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}')?.view === 'pages' ? 'pages' : 'scroll'; } catch { return 'scroll'; }
}
// For this visit when storage is blocked or full (AC4): the choice still applies until reload.
let visit: View | null = null;
export const currentView = (): View => visit ?? readView();
// Returns false when the choice could not be stored (AC4, settingsNotRemembered); it applies anyway.
export function writeView(v: View): boolean {
  visit = v;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const o = raw && typeof raw === 'object' ? { ...raw } : {};
    if (v === 'pages') o.view = 'pages'; else delete o.view;
    localStorage.setItem(KEY, JSON.stringify(o));
    const back = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return (back.view === 'pages') === (v === 'pages');
  } catch { return false; }
}
// The stored view value, for writers of rifq.settings that rebuild it (Settings: size, theme, reciter).
export function viewField(): { view?: 'pages' } {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}')?.view === 'pages' ? { view: 'pages' } : {}; } catch { return {}; }
}

export const onMushaf = () => typeof document !== 'undefined' && !!document.querySelector('[data-mushaf]');
// The reader row of ayah s:a on the page on screen (both views).
export const rowFor = (s: number, a: number) => document.querySelector<HTMLElement>(`li.ayah-row[data-s="${s}"][data-a="${a}"]`);

// The Mushaf page address of ayah s:a (with the ayah, or its Tafseer panel, in the hash).
export function pageHref(lang: Lang, s: number, a: number, tafseer = false, withHash = true): string {
  const p = pageFor(s, a);
  return p ? mushafPath(lang, p) + (withHash ? mushafHash(s, a, tafseer) : '') : '';
}
// A scroll reader address (/S/, /S/#aN, /S/#aN;tafseer; /en/...) as the same place in page mode,
// or null when it is not one.
const READER = /^\/(en\/)?(\d{1,3})\/(?:#a(\d{1,3})(;tafseer)?)?$/;
export function asPageHref(pathHash: string): string | null {
  const m = READER.exec(pathHash);
  if (!m) return null;
  const s = Number(m[2]), a = m[3] ? Number(m[3]) : 1;
  return pageHref(m[1] ? 'en' : 'ar', s, a, !!m[4], !!m[3]) || null;
}
export const isMushafPath = (p: string) => MUSHAF_PATH.test(p);

// AC5: links to scroll reader pages open the Mushaf page when page mode is the stored view. Links
// marked data-view-keep (the header view switch, the language link) are left as they are.
function rewrite(e: Event) {
  if (!pagesOn() || currentView() !== 'pages') return;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.hasAttribute('data-view-keep') || a.target === '_blank') return;
  let u: URL;
  try { u = new URL(a.href, location.href); } catch { return; }
  if (u.origin !== location.origin) return;
  const to = asPageHref(u.pathname + u.hash);
  if (to) a.setAttribute('href', to);
}
// AC2, AC3, AC119: the header's view switch opens the other view at the reading place (the D-062
// top-most ayah) and stores the choice; with storage blocked it still switches, for this visit, and
// the new page says settingsNotRemembered (AC4).
let notRemembered = false;
function onSwitch(e: Event) {
  const a = (e.target as Element | null)?.closest?.('a[data-view-switch]') as HTMLAnchorElement | null;
  if (!a) return;
  const to: View = a.dataset.viewSwitch === 'pages' ? 'pages' : 'scroll';
  const top = topRow()?.el as HTMLElement | undefined;
  const s = Number(top?.dataset.s), n = Number(top?.dataset.a);
  if (s && n) {
    const l: Lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
    const href = to === 'pages' ? pageHref(l, s, n) : `${l === 'en' ? '/en' : ''}/${s}/#a${n}`;
    if (href) a.setAttribute('href', href);
  }
  if (e.type === 'click') notRemembered = !writeView(to);
}
function onLoad() {
  if (!notRemembered) return;
  notRemembered = false;
  const st = document.querySelector<HTMLElement>('[data-reader-status]');
  const l: Lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
  if (st) window.setTimeout(() => { st.textContent = t(l, 'settingsNotRemembered'); }, 600);
}
const w = (typeof window === 'undefined' ? {} : window) as unknown as { __rifqView?: boolean };
if (typeof document !== 'undefined' && !w.__rifqView) {
  w.__rifqView = true;
  for (const ev of ['pointerdown', 'click', 'focusin', 'contextmenu']) document.addEventListener(ev, rewrite, { capture: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') rewrite(e); }, { capture: true });
  for (const ev of ['pointerdown', 'click']) document.addEventListener(ev, onSwitch, { capture: true });
  document.addEventListener('astro:page-load', onLoad);
}
