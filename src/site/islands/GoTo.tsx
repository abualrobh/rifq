// RQ-008 Go to view (kit v39, stage 3): AC10 (the home box) and AC59 to AC69, D-190 C, D-092.
// One labelled input, the "Go directly" list, example chips and the note notSaved (AC59).
// Kit v40 (D-216 A, D-213 A, QA v39 FIND-CD): the «ابحث في نص القرآن» heading and the word-search row
// are gone; everything is typed in the one box. Direct results show as the reader types; Enter (the
// phone keyboard's Search key, enterkeyhint="search") opens the first direct result when there is
// one, and otherwise runs the word search. The hint under the box (gotoHowTo) says so. The same view is on the Search screen (Search tab and the reader's Go to
// button) and in the home box (P-3: the results show under the box).
// - Direct results (AC60 to AC63) are worked out here from build data (src/core/goto.ts) as the reader
//   types, with no button and no request (AC64, AC65). Each result says its kind in words (kindAyah,
//   kindSurah, kindJuz), and their number is announced politely (offerCount).
// - Word search (AC66) runs only when asked: Enter with no direct result (D-213 A). It is today's search
//   (RQ-002): POST /api/search with the query in the body only, Arabic only, 100 characters, the
//   browser's 30-per-minute message (D-058) and the Worker's limit (D-061), results with highlights
//   and pages, D-011 text unchanged. Without JavaScript the form still posts to /api/search.
// - Nothing typed is stored, put in the address, the history state or a cookie (AC67). The input is
//   uncontrolled and starts empty on every page; there is no list of recent searches.
// - A chosen result opens the reader in place (Astro's router, so a recitation keeps playing, AC68).
// - Example chips (AC69, P-14): 2:255, the name of surah 2 with 255, the name of surah 36, the juz
//   keyword with 30, and 36. The names come from the approved file at build time (props), never from
//   strings.ts.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { gotoResults, type GotoOut, type GotoResult } from '../../core/goto.ts';
import { MAX_CHARS } from '../../core/query.ts';
import { juzOfAyah } from '../../core/recent.ts';
import { ayahPath, ayatLabel, surahPath, t, type Lang } from '../../core/strings.ts';
import { fill, refNode } from '../client/fill.ts';
import { WordSearch, type WordSearchApi } from './Search.tsx';
import BidiText from './BidiText.tsx';

type Props = {
  lang: Lang; folded: string[]; en?: [string, string][]; counts: number[]; names: [string, string][];
  juz: { juz: number; s: number; a: number }[]; juzOk: boolean; home?: boolean;
};

const chevron = <svg className="goto-dir" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export default function GoTo({ lang, folded, en, counts, names, juz, juzOk, home = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLElement>(null);
  const words = useRef<WordSearchApi>(null);
  const [q, setQ] = useState('');
  const [out, setOut] = useState<GotoOut>({ results: [], msg: null });
  const [seq, setSeq] = useState(0);
  const nameLang = lang === 'en' ? 'en' : 'ar';
  const nameOf = (s: number) => names[s - 1]?.[lang === 'en' ? 1 : 0] ?? '';
  const data = { lang, folded, en, counts, juz };
  const id = 'q';

  function change(v: string) {
    const o = gotoResults(v, data);
    setQ(v);
    setOut(o);
    setSeq((n) => n + 1);
    // FIND-CD: an earlier word search's answer ("No results", or results for other words) is not left
    // under new direct results or a message of the box's own.
    if (o.results.length || o.msg) words.current?.reset();
  }
  // Text typed before this island loaded stays in the input; read it now.
  useEffect(() => { const v = input.current?.value ?? ''; if (v) change(v); }, []);

  const hrefOf = (r: GotoResult) => (r.kind === 'surah' ? surahPath(lang, r.s) : ayahPath(lang, r.s, r.a));

  // D-213 A (P-13): Enter opens the first direct result when there is one (the same link a tap would
  // follow, so the reader opens in place, AC68); no word search runs, so no "No results" shows under
  // the direct results and only their count is announced (FIND-CD). With no direct result and no
  // message of its own, Enter runs today's word search (RQ-002). When the box already shows its own
  // message (refMissing, juzMissing, latinOnly, tooLong) the word search is not sent: that message
  // stays the one answer (builder's choice, for Hamzeh to confirm; latinOnly and tooLong are the word
  // search's own checks too, so its answer would be the same message spoken a second time).
  function enter(v: string) {
    const o = gotoResults(v, data);
    if (o.results.length) {
      const first = box.current?.querySelector<HTMLAnchorElement>('a[data-goto-result]');
      if (first) { first.click(); return; }
    }
    if (o.msg) { words.current?.reset(); return; }
    words.current?.run(v);
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    enter(input.current?.value ?? '');
  }
  function chip(v: string) {
    if (input.current) input.current.value = v;
    change(v);
    input.current?.focus();
  }

  const n = out.results.length;
  const len = [...q].length;
  const status = out.msg === 'tooLong' ? t(lang, 'tooLong', { n: len })
    : out.msg ? t(lang, out.msg)
    : n ? t(lang, 'offerCount', { n }) : '';
  const juzOf = (s: number, a: number) => (juzOk ? juzOfAyah(juz, s, a) : 0);
  const sub = (s: number, a: number) => { const j = juzOf(s, a); return j ? fill(lang, 'ayahActionsSub', { ref: refNode(s, a), j: <bdi dir="ltr">{j}</bdi> }) : refNode(s, a); };

  const row = (r: GotoResult) => {
    const key = r.kind === 'juz' ? `j${r.j}` : r.kind === 'ayah' ? `a${r.s}:${r.a}` : `s${r.s}`;
    const ref = r.kind === 'juz' ? String(r.j) : r.kind === 'ayah' ? `${r.s}:${r.a}` : String(r.s);
    const kind = t(lang, r.kind === 'ayah' ? 'kindAyah' : r.kind === 'surah' ? 'kindSurah' : 'kindJuz');
    const title = r.kind === 'ayah' ? fill(lang, 'gotoAyahResult', { name: <bdi lang={nameLang}>{nameOf(r.s)}</bdi>, a: <bdi dir="ltr">{r.a}</bdi> })
      : r.kind === 'surah' ? <bdi lang={nameLang}>{nameOf(r.s)}</bdi>
      : t(lang, 'juzOf', { n: r.j });
    const line = r.kind === 'ayah' ? sub(r.s, r.a)
      : r.kind === 'surah' ? t(lang, 'gotoSurahSub', { s: r.s, n: ayatLabel(lang, counts[r.s]) })
      : fill(lang, 'gotoJuzSub', { ref: refNode(r.s, r.a) });
    return (
      <li key={key}>
        <a href={hrefOf(r)} className="goto-res" data-goto-result={r.kind} data-goto-ref={ref}>
          <span className="goto-kind" data-goto-kind>{kind}</span>
          <span className="goto-text"><span className="goto-title">{title}</span><span className="goto-sub">{line}</span></span>
          {chevron}
        </a>
      </li>
    );
  };

  // P-14 examples; the names are the file's (props), the juz keyword is the kindJuz string.
  const examples = [
    '2:255',
    `${nameOf(2)} 255`,
    nameOf(36),
    `${t(lang, 'kindJuz')} 30`,
    '36',
  ].filter((x) => x.trim());

  // Enter is handled here, not through the browser's implicit form submission (which a
  // form with one field and no submit button did not always make: a missed search in the e2e run).
  // Esc clears the box.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); enter(e.currentTarget.value); return; }
    if (e.key === 'Escape' && q) { e.preventDefault(); chip(''); }
  };

  return (
    <section className="goto search" data-search ref={box} data-goto data-goto-home={home ? '1' : '0'}>
      <form method="post" action="/api/search" role="search" data-astro-reload="" onSubmit={onSubmit}>
        <input type="hidden" name="lang" value={lang} />
        <label htmlFor={id} className="search-label">{t(lang, home ? 'gotoLabel' : 'gotoSearchLabel')}</label>
        <div className="goto-field">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input ref={input} id={id} name="q" type="search" dir="auto" autoComplete="off" spellCheck={false} enterKeyHint="search"
            placeholder={t(lang, 'gotoPlaceholder', { ref: '2:255', name: nameOf(2), a: 255, j: 30 })}
            aria-describedby={`${id}-how ${id}-note ${id}-hint ${id}-count`} aria-invalid={len > MAX_CHARS}
            onInput={(e) => change(e.currentTarget.value)} onKeyDown={onKey} data-goto-input />
        </div>
        <p id={`${id}-how`} className="hint goto-how" data-goto-how><BidiText text={t(lang, 'gotoHowTo')} lang={lang} /></p>
        <p id={`${id}-count`} className={len > MAX_CHARS ? 'hint over' : 'hint'} data-count>{len > MAX_CHARS ? t(lang, 'tooLong', { n: len }) : t(lang, 'charCount', { n: len })}</p>
      </form>
      <p role="status" aria-live="polite" className={out.msg ? 'msg alert' : 'msg'} data-goto-status data-seq={seq}>{status}</p>
      {n > 0 && (
        <nav aria-label={t(lang, 'offersLabel')} data-goto-direct>
          <h2 className="goto-h">{t(lang, 'offersLabel')}</h2>
          <ul className="goto-list">{out.results.map(row)}</ul>
        </nav>
      )}
      {/* RQ-002 AC15: the word search's own rule (Arabic only, 100 characters) and the D-027 note, as
          on the search form of kit v38. */}
      <p id="q-hint" className="hint">{t(lang, 'searchHint')} <BidiText text={t(lang, 'searchPlaceholderForm')} lang={lang} /></p>
      <WordSearch ref={words} lang={lang} showOffers={n === 0 && !out.msg} />
      <h2 className="goto-h">{t(lang, 'youCanType')}</h2>
      <ul className="goto-chips" data-goto-chips>
        {examples.map((x) => <li key={x}><button type="button" className="goto-chip" data-goto-chip={x} onClick={() => chip(x)}><bdi>{x}</bdi></button></li>)}
      </ul>
      <p id={`${id}-note`} className="hint goto-note" data-goto-note>{t(lang, 'notSaved')}</p>
    </section>
  );
}
