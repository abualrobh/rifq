// Font size and night mode (RQ-001 AC8). The ayah at the top of the screen stays in place when the
// size or theme changes. Settings stay on the device and are never sent anywhere.
import { useEffect, useState } from 'react';
import { t, type Lang } from '../../core/strings.ts';

export const SETTINGS_KEY = 'rifq.settings';
export const SIZES = [1.25, 1.5, 1.75, 2, 2.5];
type S = { size: number; dark: boolean };
const DEFAULT: S = { size: 1.5, dark: false };

function read(): S {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { size: SIZES.includes(v?.size) ? v.size : DEFAULT.size, dark: v?.dark === true };
  } catch { return DEFAULT; }
}

// Bottom edge of the sticky header: rows above it are hidden behind the header.
export function headerBottom(): number {
  return document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
}

// The reading place: the first ayah that starts below the sticky header. If none starts on screen
// (one long ayah fills it), the ayah that covers the top of the reading area.
export function topRow(): { el: Element; top: number } | null {
  const h = headerBottom();
  let cover: Element | null = null;
  for (const el of document.querySelectorAll('.ayah-row')) {
    const r = el.getBoundingClientRect();
    if (r.top >= h - 1) return r.top < innerHeight ? { el, top: r.top } : cover ? { el: cover, top: cover.getBoundingClientRect().top } : null;
    if (r.bottom > h) cover = el;
  }
  return cover ? { el: cover, top: cover.getBoundingClientRect().top } : null;
}

function apply(s: S) {
  const anchor = topRow();
  const d = document.documentElement;
  d.style.setProperty('--ayah-size', s.size + 'rem');
  d.classList.toggle('dark', s.dark);
  if (anchor) window.scrollBy({ top: anchor.el.getBoundingClientRect().top - anchor.top, behavior: 'instant' as ScrollBehavior });
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* reading continues without saved settings */ }
}

export default function Settings({ lang }: { lang: Lang }) {
  const [s, setS] = useState<S>(DEFAULT);
  useEffect(() => setS(read()), []);
  // Keeps scroll-padding equal to the sticky header's height, so a linked ayah is not hidden.
  useEffect(() => {
    const el = document.querySelector('.site-header');
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--header-h', Math.ceil(el.getBoundingClientRect().height) + 'px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const change = (n: S) => { apply(n); setS(n); };
  const i = SIZES.indexOf(s.size);
  return (
    <div className="settings" role="group" aria-label={t(lang, 'settingsLabel')}>
      <button type="button" className="btn" data-smaller aria-label={t(lang, 'smaller')} disabled={i <= 0} onClick={() => change({ ...s, size: SIZES[Math.max(0, i - 1)] })}>A-</button>
      <span className="size-label" data-size-label>{t(lang, 'fontSize', { n: i + 1, m: SIZES.length })}</span>
      <button type="button" className="btn" data-larger aria-label={t(lang, 'larger')} disabled={i >= SIZES.length - 1} onClick={() => change({ ...s, size: SIZES[Math.min(SIZES.length - 1, i + 1)] })}>A+</button>
      <button type="button" className="btn" data-night aria-pressed={s.dark} onClick={() => change({ ...s, dark: !s.dark })}>{t(lang, 'night')}</button>
    </div>
  );
}
