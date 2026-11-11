// RQ-004 surah index filter (draft v0.1, AC9 to AC17, AC26). The 114 rows are static HTML built by
// the page, so the list and every link work without JavaScript (AC28, P-5); this island only shows
// or hides rows by their data-row number. It appears once loaded, because it needs JavaScript.
// The filter text stays in this page: it is not sent anywhere and not stored (AC16, P-4).
import { useEffect, useRef, useState } from 'react';
import { filterIndex, visibleRows, type FilterResult } from '../../core/index-filter.ts';
import { MAX_CHARS } from '../../core/query.ts';
import { ayahPath, t, type Lang } from '../../core/strings.ts';

type Props = { lang: Lang; folded: string[]; counts: number[]; names: [string, string][] };

function show(rows: number[] | null) {
  const want = rows ? new Set(rows) : null;
  for (const li of document.querySelectorAll<HTMLElement>('[data-index-list] > li[data-row]')) {
    li.hidden = want ? !want.has(Number(li.dataset.row)) : false;
  }
}

export default function IndexFilter({ lang, folded, counts, names }: Props) {
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FilterResult>({ kind: 'all' });
  // Counts changes, so a repeated message is still announced and tests can tell answers apart.
  const [seq, setSeq] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const total = counts.length - 1;

  useEffect(() => setReady(true), []);
  useEffect(() => { if (ready) show(visibleRows(res)); }, [res, ready]);

  function change(v: string) {
    setQ(v);
    setRes(filterIndex(folded, counts, v));
    setSeq((n) => n + 1);
  }
  function clear() {
    change('');
    input.current?.focus();
  }

  if (!ready) return <div className="filter-reserve" aria-hidden="true" />;

  const rows = visibleRows(res);
  const shown = rows ? rows.length : total;
  const name = (s: number) => names[s - 1]?.[lang === 'ar' ? 0 : 1] ?? '';
  const alert = res.kind === 'latin' || res.kind === 'too_long' || res.kind === 'missing' || (res.kind === 'names' && !res.list.length);
  const status = res.kind === 'latin' ? t(lang, 'latinOnly')
    : res.kind === 'too_long' ? t(lang, 'tooLong', { n: [...q].length })
    : res.kind === 'missing' ? t(lang, 'refMissing')
    : res.kind === 'names' && !res.list.length ? t(lang, 'filterNone')
    : res.kind === 'all' ? (seq ? t(lang, 'filterAll', { n: total }) : '')
    : t(lang, 'filterCount', { n: shown });
  const len = [...q].length;

  return (
    <div className="index-filter" role="search" data-index-filter>
      <label htmlFor="sq" className="search-label">{t(lang, 'filterLabel')}</label>
      <div className="search-row">
        <input
          ref={input} id="sq" type="search" dir="auto" autoComplete="off" spellCheck={false}
          maxLength={MAX_CHARS} value={q} aria-describedby="sq-hint sq-count" aria-controls="surah-list"
          onChange={(e) => change(e.currentTarget.value)}
        />
        {q && <button type="button" className="btn" data-filter-clear onClick={clear}>{t(lang, 'filterClear')}</button>}
      </div>
      <p id="sq-hint" className="hint">{t(lang, 'filterHint')}</p>
      <p id="sq-count" className={len >= MAX_CHARS ? 'hint over' : 'hint'} data-filter-chars>{t(lang, 'charCount', { n: len })}</p>
      <p role="status" aria-live="polite" className={alert ? 'msg alert' : 'msg'} data-filter-status data-seq={seq}>{status}</p>
      {res.kind === 'ref' && res.a !== undefined && (
        <p className="offers"><a data-filter-ayah={`${res.s}:${res.a}`} href={ayahPath(lang, res.s, res.a)}>{t(lang, 'offerAyah', { s: res.s, a: res.a, name: '' })}<bdi lang={lang === 'ar' ? 'ar' : 'en'}>{name(res.s)}</bdi></a></p>
      )}
    </div>
  );
}
