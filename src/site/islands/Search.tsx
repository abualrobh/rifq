// Search island (RQ-002). The form is server-rendered with method POST, so a search sent before
// this island loads still works: the Worker answers it with a results page, and the query travels
// in the request body, never in a URL. Once loaded, the island sends the same POST with fetch.
// The query is kept in memory only and is never written to storage.
import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import type { Offer, SearchOk } from '../../core/api.ts';
import { segment } from '../../core/highlight.ts';
import { MAX_CHARS, validate } from '../../core/query.ts';
import { SearchCounter } from '../../core/ratelimit.ts';
import { PAGE } from '../../core/search-core.ts';
import { ayahPath, surahPath, t, type Lang } from '../../core/strings.ts';
import BidiText from './BidiText.tsx';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'msg'; text: string; alert?: boolean }
  | { kind: 'done'; data: SearchOk };

let counter: SearchCounter | null = null;
function getCounter() {
  if (!counter) {
    let st: Storage | null = null;
    try { st = window.sessionStorage; st.getItem('x'); } catch { st = null; }
    counter = new SearchCounter(st);
  }
  return counter;
}

function Text({ text, hl }: { text: string; hl: number[] }) {
  return <>{segment(text, hl).map((p, i) => (p.hl ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

// Kit v39 (RQ-008 AC66): the word search part of the search, used by the Go to view (GoTo.tsx), which
// has its own input. run(q) is today's search (RQ-002), unchanged: validation (D-050, 100 characters),
// the browser's counter (D-058), POST /api/search with the query in the body only, results with
// highlights and pages. Offers from the Worker are shown only when the Go to view has no direct
// result of its own (showOffers), so the same place is never listed twice.
export type WordSearchApi = { run: (q: string) => void };
export function WordSearch({ lang, ref, showOffers = true }: { lang: Lang; ref?: Ref<WordSearchApi>; showOffers?: boolean }) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const lastQ = useRef('');
  const [state, setStateRaw] = useState<State>({ kind: 'idle' });
  // Counts finished searches (shown as data-seq), so tests and assistive tools can tell a new
  // answer from the previous one even when the text is the same.
  const [seq, setSeq] = useState(0);
  const setState = (s: State) => { setStateRaw(s); if (s.kind !== 'loading') setSeq((n) => n + 1); };
  useImperativeHandle(ref, () => ({ run(q: string) { lastQ.current = q; void go(q, 1); } }));

  async function go(q: string, page: number) {
    const bad = validate(q);
    if (bad === 'empty') return setState({ kind: 'msg', text: t(lang, 'empty') });
    if (bad === 'too_long') return setState({ kind: 'msg', text: t(lang, 'tooLong', { n: [...q].length }), alert: true });
    if (bad === 'latin') return setState({ kind: 'msg', text: t(lang, 'latinOnly'), alert: true });
    const wait = getCounter().take();
    if (wait) return setState({ kind: 'msg', text: t(lang, 'rateLimited', { s: wait }), alert: true });
    setState({ kind: 'loading' });
    try {
      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q, page }),
        // same-origin so a browser sends the cached Basic auth of the private test site's password
        // gate. RIFQ sets no cookies, so nothing else is sent.
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      // The password gate refused the request: the browser no longer holds the password.
      if (r.status === 401) return setState({ kind: 'msg', text: t(lang, 'authAgain'), alert: true });
      if (r.status === 429) {
        const s = Number(r.headers.get('retry-after')) || 60;
        return setState({ kind: 'msg', text: t(lang, 'rateLimited', { s }), alert: true });
      }
      const data = await r.json();
      if (!r.ok) {
        const e = data?.error;
        const text = e === 'latin' ? t(lang, 'latinOnly') : e === 'too_long' ? t(lang, 'tooLong', { n: [...q].length }) : e === 'empty' ? t(lang, 'empty') : t(lang, 'searchError');
        return setState({ kind: 'msg', text, alert: true });
      }
      setState({ kind: 'done', data });
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch {
      setState({ kind: 'msg', text: t(lang, 'searchError'), alert: true });
    }
  }

  const d = state.kind === 'done' ? state.data : null;
  const pages = d ? Math.ceil(d.total / PAGE) : 0;
  const statusText = state.kind === 'loading' ? t(lang, 'searching')
    : state.kind === 'msg' ? state.text
    // Design review M-5: a reference or surah offer with no word match is not "no results".
    : d ? (d.total > 0 ? t(lang, 'resultCount', { n: d.total }) : showOffers && d.offers.length ? t(lang, 'offerCount', { n: d.offers.length }) : t(lang, 'noResults')) : '';
  const offerLabel = (o: Offer) => (o.kind === 'ayah' ? t(lang, 'offerAyah', { s: o.s, a: o.a, name: '' }) : t(lang, 'offerSurah', { s: o.s, name: '' }));
  // Design review H-1: surah names in the interface language, from the source as stored, isolated
  // with <bdi> so they never reorder the numbers around them.
  const nameLang = lang === 'en' ? 'en' : 'ar';
  const nameOf = (x: { name: string; en: string }) => (lang === 'en' ? x.en : x.name);

  return (
    <div className="word-search" data-word-search aria-busy={state.kind === 'loading'}>
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className={state.kind === 'msg' && state.alert ? 'msg alert' : 'msg'} data-search-status data-seq={seq}>{statusText}</p>
        {showOffers && d && d.ref === 'missing' && <p className="msg" data-ref-missing>{t(lang, 'refMissing')}</p>}
        {showOffers && d && d.offers.length > 0 && (
          <nav aria-label={t(lang, 'offersLabel')}>
            <ul className="offers">
              {d.offers.map((o) => (
                <li key={`${o.kind}${o.s}:${o.kind === 'ayah' ? o.a : 0}`}>
                  <a data-offer={o.kind === 'ayah' ? `${o.s}:${o.a}` : `${o.s}`} href={o.kind === 'ayah' ? ayahPath(lang, o.s, o.a) : surahPath(lang, o.s)}>
                    {offerLabel(o)}<bdi lang={nameLang} data-offer-name>{nameOf(o)}</bdi>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {d && d.results.length > 0 && (
          <ol className="results" data-results>
            {d.results.map((r) => (
              <li key={`${r.s}:${r.a}`} data-res={`${r.s}:${r.a}`}>
                <a href={ayahPath(lang, r.s, r.a)} data-res-link><bdi lang={nameLang} data-res-name>{nameOf(r)}</bdi>{t(lang, 'resultRef', { s: r.s, a: r.a })}</a>
                <p className="ayah" lang="ar" dir="rtl" data-res-text><Text text={r.text} hl={r.hl} /></p>
              </li>
            ))}
          </ol>
        )}
        {d && pages > 1 && (
          <nav aria-label={t(lang, 'pagesLabel')} className="pager">
            <button type="button" className="btn" data-prev-page disabled={d.page <= 1} onClick={() => go(lastQ.current, d.page - 1)}>{t(lang, 'prevPage')}</button>
            <span data-page-label>{t(lang, 'resultsPage', { p: d.page, n: pages })}</span>
            <button type="button" className="btn" data-next-page disabled={d.page >= pages} onClick={() => go(lastQ.current, d.page + 1)}>{t(lang, 'nextPage')}</button>
          </nav>
        )}
    </div>
  );
}

// Today's search form (RQ-002), kept for pages that still use it; RQ-008 stage 3 moved home, the
// Search screen and the reader to the Go to view.
export default function Search({ lang }: { lang: Lang }) {
  const input = useRef<HTMLInputElement>(null);
  const words = useRef<WordSearchApi>(null);
  const [len, setLen] = useState(0);
  useEffect(() => { setLen([...(input.current?.value ?? '')].length); }, []);
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    words.current?.run(input.current?.value ?? '');
  }
  const over = len > MAX_CHARS;
  return (
    <section className="search" data-search>
      <form method="post" action="/api/search" role="search" data-astro-reload="" onSubmit={onSubmit}>
        <input type="hidden" name="lang" value={lang} />
        <label htmlFor="q" className="search-label">{t(lang, 'searchLabel')}</label>
        <div className="search-row">
          <input
            ref={input} id="q" name="q" type="search" dir="rtl" lang="ar"
            autoComplete="off" spellCheck={false} aria-describedby="q-hint q-count" aria-invalid={over}
            onInput={(e) => setLen([...e.currentTarget.value].length)}
          />
          <button type="submit" className="btn">{t(lang, 'searchButton')}</button>
        </div>
        <p id="q-hint" className="hint">{t(lang, 'searchHint')} <BidiText text={t(lang, 'searchPlaceholderForm')} lang={lang} /></p>
        <p id="q-count" className={over ? 'hint over' : 'hint'} data-count>{over ? t(lang, 'tooLong', { n: len }) : t(lang, 'charCount', { n: len })}</p>
      </form>
      <WordSearch ref={words} lang={lang} />
    </section>
  );
}
