// Search island (RQ-002). The form is server-rendered with method POST, so a search sent before
// this island loads still works: the Worker answers it with a results page, and the query travels
// in the request body, never in a URL. Once loaded, the island sends the same POST with fetch.
// The query is kept in memory only and is never written to storage.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Offer, SearchOk } from '../../core/api.ts';
import { segment } from '../../core/highlight.ts';
import { MAX_CHARS, validate } from '../../core/query.ts';
import { SearchCounter } from '../../core/ratelimit.ts';
import { PAGE } from '../../core/search-core.ts';
import { ayahPath, surahPath, t, type Lang } from '../../core/strings.ts';

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

export default function Search({ lang }: { lang: Lang }) {
  const input = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const lastQ = useRef('');
  const [len, setLen] = useState(0);
  const [state, setStateRaw] = useState<State>({ kind: 'idle' });
  // Counts finished searches (shown as data-seq), so tests and assistive tools can tell a new
  // answer from the previous one even when the text is the same.
  const [seq, setSeq] = useState(0);
  const setState = (s: State) => { setStateRaw(s); if (s.kind !== 'loading') setSeq((n) => n + 1); };

  // Text typed before the island loaded stays in the input (it is uncontrolled); count it now.
  useEffect(() => { setLen([...(input.current?.value ?? '')].length); }, []);

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

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = input.current?.value ?? '';
    lastQ.current = q;
    void go(q, 1);
  }

  const over = len > MAX_CHARS;
  const d = state.kind === 'done' ? state.data : null;
  const pages = d ? Math.ceil(d.total / PAGE) : 0;
  const statusText = state.kind === 'loading' ? t(lang, 'searching')
    : state.kind === 'msg' ? state.text
    : d ? (d.total === 0 ? t(lang, 'noResults') : t(lang, 'resultCount', { n: d.total })) : '';
  const offerLabel = (o: Offer) => (o.kind === 'ayah' ? t(lang, 'offerAyah', { s: o.s, a: o.a, name: '' }) : t(lang, 'offerSurah', { s: o.s, name: '' }));

  return (
    <section className="search" data-search>
      <form method="post" action="/api/search" role="search" onSubmit={onSubmit} aria-busy={state.kind === 'loading'}>
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
        <p id="q-hint" className="hint">{t(lang, 'searchHint')} {t(lang, 'searchPlaceholderForm')}</p>
        <p id="q-count" className={over ? 'hint over' : 'hint'} data-count>{over ? t(lang, 'tooLong', { n: len }) : t(lang, 'charCount', { n: len })}</p>
      </form>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className={state.kind === 'msg' && state.alert ? 'msg alert' : 'msg'} data-search-status data-seq={seq}>{statusText}</p>
      {d && d.ref === 'missing' && <p className="msg" data-ref-missing>{t(lang, 'refMissing')}</p>}
      {d && d.offers.length > 0 && (
        <nav aria-label={t(lang, 'offersLabel')}>
          <ul className="offers">
            {d.offers.map((o) => (
              <li key={`${o.kind}${o.s}:${o.kind === 'ayah' ? o.a : 0}`}>
                <a data-offer={o.kind === 'ayah' ? `${o.s}:${o.a}` : `${o.s}`} href={o.kind === 'ayah' ? ayahPath(lang, o.s, o.a) : surahPath(lang, o.s)}>
                  {offerLabel(o)}<span lang="ar" dir="rtl">{o.name}</span>
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
              <a href={ayahPath(lang, r.s, r.a)}>{t(lang, 'openResult', { name: '', s: r.s, a: r.a })}<span lang="ar" dir="rtl">{r.name}</span></a>
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
    </section>
  );
}
