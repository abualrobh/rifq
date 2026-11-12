// RQ-005 Tafseer view. It shows the chosen ayah in the static Quran section (it only toggles which
// row is visible; the Quran text itself is never in this script, AC5), asks RIFQ's own Worker for
// the Tafseer (AC12), and shows it in its own labelled section (AC6).
//
// Untrusted markup (AC23): the passage string is turned into React elements through
// src/core/tafseer-html.ts: plain text and a short list of tags with no attributes. Nothing is ever
// passed to innerHTML, so no script runs and no outside resource loads.
// Nothing is stored: no reading history, no Tafseer copy, nothing in browser storage (AC22).
import { createElement, Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { sanitize, type Node } from '../../core/tafseer-html.ts';
import { surahPath, t, tafseerPath, type Lang } from '../../core/strings.ts';
import BidiText from './BidiText.tsx';

type Source = { tafsirId: number; title: string | null; author: string | null; edition: string | null; publisher: string | null; language: string | null; provider: string };
type Ok = { status: 'ok'; s: number; a: number; range: { s: number; from: number; to: number }; text: string; source: Source; review: { state: 'none' } | { state: 'match'; reviewed: string } };
type View =
  | { kind: 'loading' }
  | { kind: 'ok'; d: Ok }
  | { kind: 'changed'; reviewed: string; source: Source | null }
  | { kind: 'none' } | { kind: 'unavailable' } | { kind: 'not_configured' } | { kind: 'auth' };

type Props = { lang: Lang; s: number; count: number; prevCount: number; last: number };

// "#a5" or "#a5;from=2:4" (the ayah the reader left in the reader, for the back link, AC18).
export function parseHash(h: string, count: number): { a: number; from: [number, number] | null } {
  const m = /^#a(\d{1,4})(?:;from=(\d{1,3}):(\d{1,4}))?$/.exec(h);
  const a = m ? Number(m[1]) : 1;
  return { a: a >= 1 && a <= count ? a : 1, from: m && m[2] ? [Number(m[2]), Number(m[3])] : null };
}

function render(nodes: Node[]): ReactNode[] {
  return nodes.map((n, i) => (typeof n === 'string' ? createElement(Fragment, { key: i }, n) : n.tag === 'br' ? createElement('br', { key: i }) : createElement(n.tag, { key: i }, ...render(n.children))));
}

export default function TafseerView({ lang, s, count, prevCount, last }: Props) {
  const [a, setA] = useState(1);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const from = useRef<[number, number] | null>(null);
  const seq = useRef(0);
  const seen = useRef(new Map<string, View>());
  const moved = useRef(false);

  const fromPart = () => (from.current ? `;from=${from.current[0]}:${from.current[1]}` : '');

  const show = useCallback((n: number, focus: boolean) => {
    const rows = document.querySelectorAll<HTMLElement>('.tf-row');
    rows.forEach((r, i) => { r.hidden = i !== n - 1; });
    try { history.replaceState(null, '', `#a${n}${fromPart()}`); } catch { /* the view still works */ }
    const back = document.querySelector<HTMLAnchorElement>('a[data-back]');
    const f = from.current ?? [s, n];
    if (back) back.href = `${surahPath(lang, f[0])}#a${f[1]}`;
    const sw = document.getElementById('lang-switch') as HTMLAnchorElement | null;
    if (sw) sw.href = `${tafseerPath(lang === 'ar' ? 'en' : 'ar', s)}#a${n}${fromPart()}`;
    if (focus) rows[n - 1]?.querySelector<HTMLElement>('[data-tf-ref]')?.focus();
  }, [lang, s]);

  const load = useCallback(async (n: number) => {
    const key = `${s}:${n}`;
    const id = ++seq.current;
    // AC3: inside a range already shown, the same passage and range are shown again.
    for (const v of seen.current.values()) {
      if (v.kind === 'ok' && v.d.range.s === s && n >= v.d.range.from && n <= v.d.range.to) { setView(v); return; }
    }
    const known = seen.current.get(key);
    if (known) { setView(known); return; }
    setView({ kind: 'loading' });
    let next: View;
    try {
      const r = await fetch('/api/tafseer', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s, a: n }),
      });
      let d: Record<string, unknown> = {};
      try { d = await r.json(); } catch { d = {}; }
      if (r.status === 401) next = { kind: 'auth' };
      else if (r.status === 200 && d.status === 'ok' && typeof d.text === 'string') next = { kind: 'ok', d: d as unknown as Ok };
      else if (r.status === 200 && d.status === 'changed') next = { kind: 'changed', reviewed: String(d.reviewed ?? ''), source: (d.source as Source) ?? null };
      else if (r.status === 404 && d.status === 'none') next = { kind: 'none' };
      else if (d.status === 'not_configured') next = { kind: 'not_configured' };
      else next = { kind: 'unavailable' };
    } catch {
      next = { kind: 'unavailable' };
    }
    if (next.kind === 'ok' || next.kind === 'none' || next.kind === 'changed') seen.current.set(key, next);
    if (id === seq.current) setView(next);
  }, [s]);

  useEffect(() => {
    const h = parseHash(location.hash, count);
    from.current = h.from ?? [s, h.a];
    setA(h.a);
    show(h.a, false);
    void load(h.a);
    // A link to another ayah of this surah changes only the hash: follow it.
    const onHash = () => {
      const x = parseHash(location.hash, count);
      if (x.from) from.current = x.from;
      setA(x.a);
      show(x.a, false);
      void load(x.a);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [count, s, show, load]);

  const go = (n: number) => {
    moved.current = true;
    if (n >= 1 && n <= count) { setA(n); show(n, true); void load(n); return; }
    // Across a surah edge: the next or previous surah's Tafseer page, replacing this history entry
    // so the browser's Back button still returns to the reader (AC18).
    if (n < 1 && s > 1) location.replace(`${tafseerPath(lang, s - 1)}#a${prevCount}${fromPart()}`);
    if (n > count && s < last) location.replace(`${tafseerPath(lang, s + 1)}#a1${fromPart()}`);
  };

  const notStated = t(lang, 'notStated');
  const sourceList = (src: Source | null) => (
    <details className="tf-source" data-tf-source>
      <summary>{t(lang, 'tafseerSourceDetails')}</summary>
      <dl>
        <dt>{t(lang, 'tfTitle')}</dt><dd data-tf-src-title><bdi>{src?.title ?? notStated}</bdi></dd>
        <dt>{t(lang, 'tfAuthor')}</dt><dd data-tf-src-author><bdi>{src?.author ?? notStated}</bdi></dd>
        <dt>{t(lang, 'tfEdition')}</dt><dd data-tf-src-edition><bdi>{src?.edition ?? notStated}</bdi></dd>
        <dt>{t(lang, 'tfPublisher')}</dt><dd data-tf-src-publisher><bdi>{src?.publisher ?? notStated}</bdi></dd>
        <dt>{t(lang, 'tfLanguage')}</dt><dd data-tf-src-language><bdi>{src?.language ?? notStated}</bdi></dd>
        <dt>{t(lang, 'tfId')}</dt><dd data-tf-src-id><bdi dir="ltr">{src ? String(src.tafsirId) : notStated}</bdi></dd>
        <dt>{t(lang, 'tfProvider')}</dt><dd data-tf-src-provider><bdi dir="ltr">Quran Foundation</bdi></dd>
      </dl>
    </details>
  );

  let body: ReactNode;
  if (view.kind === 'loading') body = <p className="msg">{t(lang, 'tafseerLoading')}</p>;
  else if (view.kind === 'none') body = <p className="msg" data-tf-msg="none">{t(lang, 'tafseerNone')}</p>;
  else if (view.kind === 'unavailable') body = <p className="msg alert" data-tf-msg="unavailable">{t(lang, 'tafseerUnavailable')}</p>;
  else if (view.kind === 'not_configured') body = <p className="msg alert" data-tf-msg="not_configured"><BidiText text={t(lang, 'tafseerNotConfigured')} lang={lang} /></p>;
  else if (view.kind === 'auth') body = <p className="msg alert" data-tf-msg="auth">{t(lang, 'tafseerAuthAgain')}</p>;
  else if (view.kind === 'changed') body = <><p className="msg alert" data-tf-msg="changed">{t(lang, 'tafseerChanged', { d: view.reviewed })}</p>{sourceList(view.source)}</>;
  else {
    const d = view.d;
    const arabic = (d.source.language ?? '').trim().toLowerCase() === 'arabic';
    body = (
      <>
        {d.range.from !== d.range.to && <p className="tf-range" data-tf-range>{t(lang, 'tafseerRange', { s: d.range.s, from: d.range.from, to: d.range.to })}</p>}
        <div className="tf-text" lang={arabic ? 'ar' : undefined} dir={arabic ? 'rtl' : 'auto'} translate="no" data-tf-text>{render(sanitize(d.text))}</div>
        <p className="tf-review" data-tf-review={d.review.state}>{d.review.state === 'match' ? t(lang, 'reviewMatch', { d: d.review.reviewed }) : <BidiText text={t(lang, 'reviewNone')} lang={lang} />}</p>
        {sourceList(d.source)}
      </>
    );
  }

  const atStart = s === 1 && a === 1;
  const atEnd = s === last && a === count;
  return (
    <div className="tf-view" data-tf-status={view.kind} data-tf-ayah={`${s}:${a}`}>
      <div aria-live="polite" aria-busy={view.kind === 'loading'}>{body}</div>
      <p className="tf-credit" data-tf-credit><BidiText text={t(lang, 'tafseerCredit')} lang={lang} /></p>
      <nav className="tf-nav" aria-label={t(lang, 'ayahNavLabel')}>
        {!atStart && <button type="button" className="btn" data-tf-prev onClick={() => go(a - 1)}>{t(lang, 'prevAyah')}</button>}
        {!atEnd && <button type="button" className="btn" data-tf-next onClick={() => go(a + 1)}>{t(lang, 'nextAyah')}</button>}
      </nav>
    </div>
  );
}
