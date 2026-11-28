// Font size and night mode (RQ-001 AC8). The ayah at the top of the screen stays in place when the
// size or theme changes. Settings stay on the device and are never sent anywhere.
// RQ-008 (kit v37): the night toggle left the header (Hamzeh, 21 Nov; AC72); the light/dark switch
// is on the Settings screen (islands/SettingsScreen.tsx), which uses read() and apply() below. The
// header keeps the text-size Display control on reader and Tafseer pages only (D-193 A, "What moves
// where"); on other pages this island shows nothing and only keeps --header-h measured.
import { useEffect, useState } from 'react';
import { t, type Lang } from '../../core/strings.ts';
import { headerBottom, topRow } from '../client/place.ts';
import { viewField } from '../client/view.ts';

export const SETTINGS_KEY = 'rifq.settings';
export const SIZES = [1.25, 1.5, 1.75, 2, 2.5];
type S = { size: number; dark: boolean };
const DEFAULT: S = { size: 1.5, dark: false };

export type { S as SettingsValue };
export function read(): S {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { size: SIZES.includes(v?.size) ? v.size : DEFAULT.size, dark: v?.dark === true };
  } catch { return DEFAULT; }
}

// RQ-006 AC15: the chosen reciter is kept on the device with the other settings, as a chapter-
// reciter ID only. Writing the size or theme keeps it, and writing it keeps them.
function rawSettings(): Record<string, unknown> {
  try { const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function reciterField(): { reciter?: number } {
  const r = rawSettings().reciter;
  return Number.isInteger(r) && (r as number) > 0 && (r as number) < 100000 ? { reciter: r as number } : {};
}
export function readReciter(): number | null { return reciterField().reciter ?? null; }
// Returns false when the choice could not be stored (AC16).
export function writeReciter(id: number): boolean {
  try {
    const v = rawSettings();
    const keep: Record<string, unknown> = {};
    if (SIZES.includes(v.size as number)) keep.size = v.size;
    if (v.dark === true || v.dark === false) keep.dark = v.dark;
    if (v.view === 'pages') keep.view = 'pages'; // kit v43 (RQ-009 AC4): the reading view is kept
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...keep, reciter: id }));
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').reciter === id;
  } catch { return false; }
}

// headerBottom and topRow live in client/place.ts since kit v38 (the router uses them too).
export { headerBottom, topRow };

// Returns false when the setting could not be stored (RQ-008 AC76); it still applies to the page.
export function apply(s: S): boolean {
  const anchor = topRow();
  const d = document.documentElement;
  d.style.setProperty('--ayah-size', s.size + 'rem');
  d.classList.toggle('dark', s.dark);
  if (anchor) window.scrollBy({ top: anchor.el.getBoundingClientRect().top - anchor.top, behavior: 'instant' as ScrollBehavior });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, ...reciterField(), ...viewField() }));
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return v?.size === s.size && v?.dark === s.dark;
  } catch { return false; /* reading continues without saved settings */ }
}

export default function Settings({ lang, size = false }: { lang: Lang; size?: boolean }) {
  const [s, setS] = useState<S>(DEFAULT);
  // Phone width: the controls sit behind one Display button (design review H-2). The panel opens
  // over the text, so opening it never moves the reading place. Wider screens show them inline.
  // Kit v39 (RQ-008 AC50, D-193 A): the button is named "Text size" (textSize), as in Settings.
  const [open, setOpen] = useState(false);
  useEffect(() => { setS(read()); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
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
  if (!size) return null;
  return (
    <div className="settings" role="group" aria-label={t(lang, 'settingsLabel')}>
      <button type="button" className="btn display-toggle" data-display-toggle aria-expanded={open} aria-controls="display-panel" onClick={() => setOpen(!open)}>{t(lang, 'textSize')}</button>
      <div id="display-panel" className={open ? 'display-panel open' : 'display-panel'} data-display-panel>
      <button type="button" className="btn" data-smaller aria-label={t(lang, 'smaller')} disabled={i <= 0} onClick={() => change({ ...s, size: SIZES[Math.max(0, i - 1)] })}><bdi dir="ltr">A-</bdi></button>
      <span className="size-label" data-size-label>{t(lang, 'fontSize', { n: i + 1, m: SIZES.length })}</span>
      <button type="button" className="btn" data-larger aria-label={t(lang, 'larger')} disabled={i >= SIZES.length - 1} onClick={() => change({ ...s, size: SIZES[Math.min(SIZES.length - 1, i + 1)] })}><bdi dir="ltr">A+</bdi></button>
      </div>
    </div>
  );
}
