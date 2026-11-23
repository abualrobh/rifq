// RQ-005 Tafseer view. It shows the chosen ayah in the static Quran section (it only toggles which
// row is visible; the Quran text itself is never in this script, AC5), asks RIFQ's own Worker for
// the Tafseer (AC12), and shows it in its own labelled section (AC6).
//
// Untrusted markup (AC23): the passage string is turned into React elements through
// src/core/tafseer-html.ts: plain text and a short list of tags with no attributes. Nothing is ever
// passed to innerHTML, so no script runs and no outside resource loads.
// Nothing is stored: no reading history, no Tafseer copy, nothing in browser storage (AC22).
//
// D-149 bracket display (RQ-005 v1.1 AC29 to AC37; D-156 A): the Worker sends one class letter per
// bracketed phrase (`marks`) with the unchanged passage. markedNodes (src/core/tafseer-marks.ts)
// reads the passage through the same tokenizer and allow-list as sanitize, finds the same phrases
// and swaps only their two bracket characters; the words go into elements built here with fixed
// class names. Own-ayah and other-ayah phrases are quotations (q, D-153 C), with no added words.
// Missing or unfitting marks: the passage as delivered, with no message (AC37).
//
// RQ-007 (kit v34): in the English interface the request says "l": "en" and the Worker answers
// from the English work (TAFSIR_EN_ID). The passage is marked lang="en" dir="ltr" (AC19); each
// Arabic run inside it is put in its own lang="ar" dir="rtl" element without changing a character
// (AC20, src/core/bidi.ts arabicRuns). The AC7 note (tafseerEnNote) sits outside the passage, and
// source details add Translator, Abridgement and Original work, with the language shown as
// "English" (AC14). No review line for English (AC16). A work that is not set, or not English, shows
// tafseerEnNotConfigured in development builds and tafseerUnavailable in release builds (AC8, AC12).
// The Arabic interface is unchanged.
//
// Kit v36 (English passages only; display only, the Worker answers and the matching files are
// unchanged): the work's <h1>/<h2> headings are shown as headings on their own lines (QA v35
// FIND-BB); a <<...>> quotation split by markup inside an English line is one right-to-left element;
// a line that is Arabic apart from a few Latin words is right to left with those words isolated;
// nested brackets and curly quotes around Arabic runs (FIND-BA). No character is added or changed.
//
// RQ-008 stage 2 (kit v38, AC38 to AC49, A2): the same view is also shown in the Tafseer panel over
// the reader (islands/AyahPanels.tsx). The panel passes a `host`: it says which ayah to open first,
// shows that ayah in the panel's own Quran section (show) and moves to the next or previous surah
// at an edge (edge). Without a host (the Tafseer page) nothing changes: the hash, the static rows,
// the back link and the language link work exactly as in kit v37. What this view renders is the
// same in both places, so the passage, range, bracket display, messages, English note, source
// details, credit and the previous and next buttons are the same code and the same markup.
import { goReplace } from '../client/nav.ts';
import { createElement, Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { sanitize, type Node } from '../../core/tafseer-html.ts';
import { markedNodes, type MNode } from '../../core/tafseer-marks.ts';
import { surahPath, t, tafseerPath, type Lang } from '../../core/strings.ts';
import BidiText from './BidiText.tsx';
import { arabicRuns, bidiParts, hasOtherLetter, isArabicLine, isMostlyArabicLine, type RunEdges } from '../../core/bidi.ts';
import { headingBlocks, HEADING_TAGS, QUOTE_GROUP, quoteGroups } from '../../core/tafseer-display.ts';
import { markedText } from '../../core/tafseer-marks.ts';
import { notConfiguredMessage } from '../lib/tafseer-messages.ts';

type Source = { tafsirId: number; title: string | null; author: string | null; edition: string | null; publisher: string | null; language: string | null; provider: string; translator?: string | null; abridgement?: string | null; original?: string | null };
type Ok = { status: 'ok'; s: number; a: number; range: { s: number; from: number; to: number }; text: string; source: Source; marks?: unknown };
type View =
  | { kind: 'loading' }
  | { kind: 'ok'; d: Ok }
  | { kind: 'none' } | { kind: 'unavailable' } | { kind: 'not_configured' } | { kind: 'auth' };

// The Tafseer panel (RQ-008, kit v38). start: the first ayah shown (1 to count). show(n, focus):
// show ayah n in the panel's Quran section (focus: move focus to its reference line, as the page
// does). edge(dir): move to the previous surah's last ayah (-1) or the next surah's first ayah (+1).
export type TafseerHost = { start: number; show: (n: number, focus: boolean) => void; edge: (dir: -1 | 1) => void };
type Props = { lang: Lang; s: number; count: number; prevCount: number; last: number; dev?: boolean; host?: TafseerHost };

// "#a5" or "#a5;from=2:4" (the ayah the reader left in the reader, for the back link, AC18).
export function parseHash(h: string, count: number): { a: number; from: [number, number] | null } {
  const m = /^#a(\d{1,4})(?:;from=(\d{1,3}):(\d{1,4}))?$/.exec(h);
  const a = m ? Number(m[1]) : 1;
  return { a: a >= 1 && a <= count ? a : 1, from: m && m[2] ? [Number(m[2]), Number(m[3])] : null };
}

// RQ-007 AC20: in a passage that is not Arabic, each Arabic run of a text node gets its own
// lang="ar" dir="rtl" element; the characters are the same, in the same order.
function textOf(t: string, key: number | string, runs: boolean, edges?: RunEdges): ReactNode {
  if (!runs) return createElement(Fragment, { key }, t);
  const parts = arabicRuns(t, edges);
  if (parts.length === 1 && !parts[0].ar) return createElement(Fragment, { key }, t);
  return createElement(Fragment, { key }, ...parts.map((p, j) => (p.ar ? createElement('span', { key: j, lang: 'ar', dir: 'rtl', 'data-ar-run': '' }, p.text) : p.text)));
}

// Kit v36 (FIND-BA 2): inside a line that is mostly Arabic, each run of Latin words is isolated left
// to right and marked English (the same split as interface text, bidiParts); the characters are
// the same, in the same order.
function isoText(t: string, key: number | string): ReactNode {
  const parts = bidiParts(t, true);
  if (parts.length === 1 && !parts[0].ltr) return createElement(Fragment, { key }, t);
  return createElement(Fragment, { key }, ...parts.map((p, j) => (p.ltr ? createElement('bdi', { key: j, dir: 'ltr', lang: 'en', 'data-en-run': '' }, p.text) : p.text)));
}

// Block tags whose whole text can be one Arabic line (kit v35, B2; kit v36: the work's headings).
const LINE_TAGS = new Set(['p', 'div', 'blockquote', 'li', 'h3', 'h4', 'h5', 'h6', ...HEADING_TAGS]);
// Elements after or before which a text starts or ends a line (kit v36, FIND-BA 1).
const LINE_BREAKS = new Set(['br', 'p', 'div', 'blockquote', 'ul', 'ol', 'li', 'h3', 'h4', 'h5', 'h6', ...HEADING_TAGS]);
const breaks = (n: Node | MNode | undefined) => n !== undefined && typeof n !== 'string' && !('tfq' in n) && LINE_BREAKS.has(n.tag);
// The work's headings (kit v36, FIND-BB): h1 as h3 and h2 as h4 inside the Tafseer section, whose
// own heading is an h2.
const HEADING_AS: Record<string, string> = { 'tf-h1': 'h3', 'tf-h2': 'h4' };
const plainText = (nodes: (Node | MNode)[]): string => markedText(nodes as MNode[]);

// `runs` (RQ-007, English passages only): mark Arabic runs. The Arabic interface never sets it, so
// its output is unchanged from kit v33. `block` (kit v36): the nodes are the whole content of a
// block, so the first starts a line and the last ends one. `iso` (kit v36): the nodes are inside a
// mostly Arabic line (isMostlyArabicLine).
function render(nodes: (Node | MNode)[], arabic = true, runs = false, block = false, iso = false): ReactNode[] {
  return nodes.map((n, i) => {
    if (typeof n === 'string') {
      if (iso) return isoText(n, i);
      if (!runs) return textOf(n, i, runs);
      return textOf(n, i, runs, { open: breaks(nodes[i + 1]) || (block && i === nodes.length - 1), close: breaks(nodes[i - 1]) || (block && i === 0) });
    }
    if ('tfq' in n) {
      // Kit v36: inside a mostly Arabic line, a phrase keeps its class; its Latin words are isolated.
      if (iso) {
        if (n.tfq === 'P') return createElement('span', { key: i, className: 'tfq tfq-plain', 'data-tfq': 'plain' }, n.open, isoText(n.text, 't'), n.close);
        const own = n.tfq === 'O';
        const cls = { key: i, className: own ? 'tfq tfq-own' : 'tfq tfq-other', 'data-tfq': own ? 'own' : 'other' };
        if (hasOtherLetter(n.text)) return createElement('span', { ...cls, 'data-tfq-mixed': '' }, n.open, createElement('q', null, isoText(n.text, 't')), n.close);
        return createElement('span', cls, n.open, createElement('q', null, n.text), n.close);
      }
      // Plain: only the brackets change. Own and other ayah: Quran font and colour (CSS), and the
      // words are a quotation for assistive technology (D-153 C). Inside a passage that is not
      // Arabic, the Arabic phrase keeps its own language and direction.
      if (n.tfq === 'P') return createElement('span', { key: i, className: 'tfq tfq-plain', 'data-tfq': 'plain' }, n.open, textOf(n.text, 't', runs), n.close);
      const own = n.tfq === 'O';
      const cls = { key: i, className: own ? 'tfq tfq-own' : 'tfq tfq-other', 'data-tfq': own ? 'own' : 'other' };
      // Kit v35 (B3, QA v34 FIND-AS; AC20, AC22): a matched phrase that also holds English (or any
      // non-Arabic) letters keeps its class, colour, font and brackets, but is not marked Arabic as
      // a whole: only its Arabic runs are, so its English words keep their order and language.
      if (!arabic && hasOtherLetter(n.text)) return createElement('span', { ...cls, 'data-tfq-mixed': '' }, n.open, createElement('q', null, textOf(n.text, 't', runs)), n.close);
      return createElement('span', { ...cls, ...(arabic ? {} : { lang: 'ar', dir: 'rtl' }) },
        n.open, createElement('q', null, n.text), n.close);
    }
    if (n.tag === 'br') return createElement('br', { key: i });
    // Kit v36 (FIND-BA 1): a quotation split by markup in an English line, as one right-to-left
    // element. Inside an Arabic line it needs no element of its own.
    if (n.tag === QUOTE_GROUP) {
      if (!runs) return createElement(Fragment, { key: i }, ...render(n.children, arabic, runs, false, iso));
      return createElement('span', { key: i, lang: 'ar', dir: 'rtl', 'data-ar-run': '', 'data-ar-quote': '' }, ...render(n.children, true, false));
    }
    // Kit v36 (FIND-BB): the work's own headings, each a block of its own.
    const tag = HEADING_AS[n.tag] ?? n.tag;
    const hd = HEADING_AS[n.tag] ? { 'data-tf-h': n.tag.slice(4) } : {};
    // Kit v35 (B2, RQ-007 R-5, AC20): in an English passage, a paragraph (or other block) whose
    // whole text is one Arabic line (Arabic letters, no letter of another script) is laid out right
    // to left as a whole, exactly as the Arabic passage is, with its quotation marks, question mark
    // and numbers in place. No character changes.
    if (runs && LINE_TAGS.has(n.tag) && isArabicLine(plainText(n.children))) {
      return createElement(tag, { key: i, ...hd, lang: 'ar', dir: 'rtl', 'data-ar-line': '' }, ...render(n.children, true, false));
    }
    // Kit v36 (FIND-BA 2): Arabic with a few Latin words (a name, a book title) is also a right to
    // left line; the Latin words are isolated left to right.
    if (runs && LINE_TAGS.has(n.tag) && isMostlyArabicLine(plainText(n.children))) {
      return createElement(tag, { key: i, ...hd, lang: 'ar', dir: 'rtl', 'data-ar-line': '', 'data-ar-mixed': '' }, ...render(n.children, true, false, false, true));
    }
    if (iso) return createElement(tag, { key: i, ...hd }, ...render(n.children, arabic, false, false, true));
    return createElement(tag, { key: i, ...hd }, ...render(n.children, arabic, runs, runs && LINE_TAGS.has(n.tag)));
  });
}

// The display nodes of a passage: with the D-149 marks when they fit, otherwise as delivered.
export function passageNodes(text: string, marks: unknown): { nodes: (Node | MNode)[]; marked: boolean } {
  const m = marks === undefined ? null : markedNodes(text, marks);
  return m ? { nodes: m.nodes, marked: true } : { nodes: sanitize(text), marked: false };
}

// Kit v36: the English passage's display nodes, with the work's headings as blocks (FIND-BB) and
// quotations split by markup grouped (FIND-BA 1). The Arabic passage does not come here.
export function englishNodes(text: string, nodes: (Node | MNode)[]): MNode[] {
  return quoteGroups(headingBlocks(text, nodes as MNode[]).nodes);
}

export default function TafseerView({ lang, s, count, prevCount, last, dev = false, host }: Props) {
  const [a, setA] = useState(1);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const from = useRef<[number, number] | null>(null);
  const seq = useRef(0);
  const seen = useRef(new Map<string, View>());
  const moved = useRef(false);

  const fromPart = () => (from.current ? `;from=${from.current[0]}:${from.current[1]}` : '');

  const show = useCallback((n: number, focus: boolean) => {
    if (host) { host.show(n, focus); return; }
    const rows = document.querySelectorAll<HTMLElement>('.tf-row');
    rows.forEach((r, i) => { r.hidden = i !== n - 1; });
    try { history.replaceState(history.state, '', `#a${n}${fromPart()}`); } catch { /* the view still works */ }
    const back = document.querySelector<HTMLAnchorElement>('a[data-back]');
    const f = from.current ?? [s, n];
    if (back) back.href = `${surahPath(lang, f[0])}#a${f[1]}`;
    const sw = document.getElementById('lang-switch') as HTMLAnchorElement | null;
    if (sw) sw.href = `${tafseerPath(lang === 'ar' ? 'en' : 'ar', s)}#a${n}${fromPart()}`;
    if (focus) rows[n - 1]?.querySelector<HTMLElement>('[data-tf-ref]')?.focus();
  }, [lang, s, host]);

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
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(lang === 'en' ? { s, a: n, l: 'en' } : { s, a: n }),
      });
      let d: Record<string, unknown> = {};
      try { d = await r.json(); } catch { d = {}; }
      if (r.status === 401) next = { kind: 'auth' };
      else if (r.status === 200 && d.status === 'ok' && typeof d.text === 'string') next = { kind: 'ok', d: d as unknown as Ok };
      else if (r.status === 404 && d.status === 'none') next = { kind: 'none' };
      else if (d.status === 'not_configured') next = { kind: 'not_configured' };
      else next = { kind: 'unavailable' };
    } catch {
      next = { kind: 'unavailable' };
    }
    if (next.kind === 'ok' || next.kind === 'none') seen.current.set(key, next);
    if (id === seq.current) setView(next);
  }, [s, lang]);

  useEffect(() => {
    if (host) {
      const n = host.start >= 1 && host.start <= count ? host.start : 1;
      setA(n);
      show(n, false);
      void load(n);
      return;
    }
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
  }, [count, s, show, load, host]);

  const go = (n: number) => {
    moved.current = true;
    if (n >= 1 && n <= count) { setA(n); show(n, true); void load(n); return; }
    if (host) { if (n < 1 && s > 1) host.edge(-1); if (n > count && s < last) host.edge(1); return; }
    // Across a surah edge: the next or previous surah's Tafseer page, replacing this history entry
    // (in place since RQ-006 v1.3, so a recitation keeps playing, AC62)
    // so the browser's Back button still returns to the reader (AC18).
    if (n < 1 && s > 1) goReplace(`${tafseerPath(lang, s - 1)}#a${prevCount}${fromPart()}`);
    if (n > count && s < last) goReplace(`${tafseerPath(lang, s + 1)}#a1${fromPart()}`);
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
        {lang === 'en' && <>
          <dt>{t(lang, 'tfTranslator')}</dt><dd data-tf-src-translator><bdi>{src?.translator ?? notStated}</bdi></dd>
          <dt>{t(lang, 'tfAbridgement')}</dt><dd data-tf-src-abridgement><bdi>{src?.abridgement ?? notStated}</bdi></dd>
          <dt>{t(lang, 'tfOriginal')}</dt><dd data-tf-src-original><bdi>{src?.original ?? notStated}</bdi></dd>
        </>}
        <dt>{t(lang, 'tfLanguage')}</dt><dd data-tf-src-language><bdi>{lang === 'en' && (src?.language ?? '').trim().toLowerCase() === 'english' ? t('en', 'langEnglish') : src?.language ?? notStated}</bdi></dd>
        <dt>{t(lang, 'tfId')}</dt><dd data-tf-src-id><bdi dir="ltr">{src ? String(src.tafsirId) : notStated}</bdi></dd>
        <dt>{t(lang, 'tfProvider')}</dt><dd data-tf-src-provider><bdi dir="ltr">Quran Foundation</bdi></dd>
      </dl>
    </details>
  );

  let body: ReactNode;
  if (view.kind === 'loading') body = <p className="msg">{t(lang, 'tafseerLoading')}</p>;
  else if (view.kind === 'none') body = <p className="msg" data-tf-msg="none">{t(lang, 'tafseerNone')}</p>;
  else if (view.kind === 'unavailable') body = <p className="msg alert" data-tf-msg="unavailable">{t(lang, 'tafseerUnavailable')}</p>;
  else if (view.kind === 'not_configured' && lang === 'en') {
    // D-175 A: release builds show tafseerUnavailable (AC12); development builds name D-136 (AC8).
    const m = notConfiguredMessage(lang, dev);
    body = m.msg === 'not_configured'
      ? <p className="msg alert" data-tf-msg="not_configured"><BidiText text={t(lang, m.key)} lang={lang} /></p>
      : <p className="msg alert" data-tf-msg="unavailable">{t(lang, m.key)}</p>;
  }
  else if (view.kind === 'not_configured') body = <p className="msg alert" data-tf-msg="not_configured"><BidiText text={t(lang, 'tafseerNotConfigured')} lang={lang} /></p>;
  else if (view.kind === 'auth') body = <p className="msg alert" data-tf-msg="auth">{t(lang, 'tafseerAuthAgain')}</p>;
  else {
    const d = view.d;
    // RQ-007: the English interface asks for the English work only, so its passage is English (AC19).
    const english = lang === 'en';
    const arabic = !english && (d.source.language ?? '').trim().toLowerCase() === 'arabic';
    const shown = passageNodes(d.text, d.marks);
    body = (
      <>
        {d.range.from !== d.range.to && <p className="tf-range" data-tf-range>{t(lang, 'tafseerRange', { s: d.range.s, from: d.range.from, to: d.range.to })}</p>}
        {english && <p className="tf-en-note" data-tf-en-note>{t('en', 'tafseerEnNote')}</p>}
        <div className="tf-text" lang={arabic ? 'ar' : english ? 'en' : undefined} dir={arabic ? 'rtl' : english ? 'ltr' : 'auto'} translate="no" data-tf-text data-tf-marked={shown.marked ? '1' : '0'}>{english ? render(englishNodes(d.text, shown.nodes), false, true, true) : render(shown.nodes, arabic, english)}</div>
        {/* RQ-005 v1.1 AC26/AC27 (D-146, D-151 A, kit v32 FIND-AE): readers see no review line or notice at all; a D-079 fingerprint mismatch shows on /dev/quote-check/ only. */}
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
