// D-084 development page island. It asks RIFQ's own Worker to run the quote check one small part of
// a surah at a time (kit v30: about 10 passages a request, so each Worker request stays light on
// CPU), with a pause between requests, shows the counts and the reviewer list, and offers the list
// as JSON or CSV made in the browser. Nothing is stored or sent anywhere else. The phrases are Tafseer
// text exactly as delivered; they are shown as plain text (no markup is ever interpreted).
//
// AC31 (RQ-005 v1.1, D-149): the Worker also returns each passage's display classes (one letter per
// phrase, the same code and index as /api/tafseer). "Compare with the reader display" then asks
// /api/tafseer for the first ayah of each passage, one request every 1.1 s (under the 60-a-minute
// limit), and counts the passages whose marks agree. Class letters only are compared and shown.
//
// Kit v32 (FIND-AE, D-151 A): the D-079 fingerprint change alarm is shown here, and only here
// (readers never see review notices): counts, and the ayah references whose fingerprint differs.
//
// RQ-007 (kit v34, AC17, AC37): a choice of work. "Arabic" checks TAFSIR_ID exactly as before.
// "English" checks TAFSIR_EN_ID: only phrases in Arabic letters are matched and listed; phrases with
// no Arabic letters are counted only; no fingerprints; the comparison asks /api/tafseer for the
// English passage ("l": "en"). Each run's results and downloads name their work, and a new run
// (or a change of work) starts from empty, so the two works' results never mix (AC10).
import { useRef, useState } from 'react';
import { reviewCsv, type CsvRow as ReviewItem } from '../../core/review-csv.ts';

// Kit v30: 1.1 seconds between requests (each part of a surah is one request; under the
// 60-a-minute Tafseer limit).
const PART_PAUSE_MS = 1100;
const RESULTS = ['matched_own_ayah', 'matched_same_surah', 'matched_elsewhere', 'unmatched', 'too_short', 'fragment'] as const;
const CLASSES = [['O', 'own ayah: Quran font, green, { }'], ['A', 'another ayah: Quran font, brown, ( )'], ['P', 'plain, ( )'], ['N', 'as delivered (unclosed)']] as const;
const COMPARE_PAUSE_MS = 1100;
type Disp = { ref: string; range: string; n: number; c: string };

export default function QuoteCheck({ surahs }: { surahs: number }) {
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('2');
  const [list, setList] = useState<ReviewItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState('idle');
  const [done, setDone] = useState<number[]>([]);
  const stop = useRef(false);
  const [display, setDisplay] = useState<Disp[]>([]);
  const [fpDiffer, setFpDiffer] = useState<string[]>([]);
  const [cmp, setCmp] = useState<{ state: string; done: number; agree: number; differ: { ref: string; check: string; api: string }[]; errors: number }>({ state: 'idle', done: 0, agree: 0, differ: [], errors: 0 });
  const [work, setWork] = useState<'ar' | 'en'>('ar');
  const [ran, setRan] = useState<{ work: 'ar' | 'en'; id: number | null } | null>(null);
  const tag = ran ? `${ran.work}${ran.id === null ? '' : '-' + ran.id}` : work;
  const pick = (w: 'ar' | 'en') => {
    setWork(w); setRan(null);
    setList([]); setCounts({}); setErrors([]); setDone([]); setDisplay([]); setFpDiffer([]); setState('idle');
    setCmp({ state: 'idle', done: 0, agree: 0, differ: [], errors: 0 });
  };

  async function compare() {
    stop.current = false;
    let agree = 0, errors = 0, done = 0;
    const differ: { ref: string; check: string; api: string }[] = [];
    setCmp({ state: 'running', done, agree, differ: [], errors });
    for (const p of display) {
      if (stop.current) { setCmp({ state: 'stopped', done, agree, differ: [...differ], errors }); return; }
      const [s, a] = p.ref.split(':').map(Number);
      try {
        const r = await fetch('/api/tafseer', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ran?.work === 'en' ? { s, a, l: 'en' } : { s, a }) });
        const d = await r.json();
        const m = d?.marks;
        const api = m && typeof m.c === 'string' && m.n === m.c.length ? m.c : d?.status === 'ok' ? '(no marks)' : `(${String(d?.status ?? r.status)})`;
        if (api === p.c) agree++; else if (api.startsWith('(') && d?.status !== 'ok') errors++; else differ.push({ ref: p.ref, check: p.c, api });
      } catch { errors++; }
      done++;
      setCmp({ state: 'running', done, agree, differ: [...differ], errors });
      await new Promise((res) => setTimeout(res, COMPARE_PAUSE_MS));
    }
    setCmp({ state: 'finished', done, agree, differ: [...differ], errors });
  }

  async function run() {
    const a = Math.max(1, Math.min(surahs, Number(from) || 1)), b = Math.max(a, Math.min(surahs, Number(to) || a));
    stop.current = false;
    const w = work;
    setRan({ work: w, id: null });
    setCmp({ state: 'idle', done: 0, agree: 0, differ: [], errors: 0 });
    setList([]); setCounts({}); setErrors([]); setDone([]); setDisplay([]); setFpDiffer([]); setState('running');
    for (let s = a; s <= b; s++) {
      let part: { page: number; skip: number } | null = { page: 1, skip: 0 };
      let parts = 0;
      while (part) {
        if (stop.current) { setState('stopped'); return; }
        if (parts++) await new Promise((res) => setTimeout(res, PART_PAUSE_MS));
        try {
          const r: Response = await fetch('/api/dev/quote-check', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(w === 'en' ? { s, page: part.page, skip: part.skip, w: 'en' } : { s, page: part.page, skip: part.skip }) });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d: any = await r.json();
          if (r.status === 200 && Array.isArray(d.list)) {
            if (Number.isInteger(d.tafsirId)) setRan({ work: w, id: d.tafsirId });
            setList((x) => [...x, ...d.list]);
            setCounts((c) => {
              const n = { ...c };
              n.phrases = (n.phrases ?? 0) + d.summary.phrases;
              n.braces = (n.braces ?? 0) + d.summary.braces;
              n.passages = (n.passages ?? 0) + d.passages;
              n.edge = (n.edge ?? 0) + (d.summary.edgeMatches ?? 0);
              n.requests = (n.requests ?? 0) + 1;
              for (const k of RESULTS) n[k] = (n[k] ?? 0) + (d.summary.byResult[k] ?? 0);
              for (const [k] of CLASSES) n['d' + k] = (n['d' + k] ?? 0) + (d.displayCounts?.[k] ?? 0);
              n.fpChecked = (n.fpChecked ?? 0) + (Number(d.fingerprints?.checked) || 0);
              n.fpSame = (n.fpSame ?? 0) + (Number(d.fingerprints?.same) || 0);
              // RQ-007: phrases with no Arabic letters (English work only): counted, never listed.
              n.otherPhrases = (n.otherPhrases ?? 0) + (Number(d.other?.phrases) || 0);
              n.otherRound = (n.otherRound ?? 0) + (Number(d.other?.byBracket?.round) || 0);
              n.otherOrnate = (n.otherOrnate ?? 0) + (Number(d.other?.byBracket?.ornate) || 0);
              n.otherCurly = (n.otherCurly ?? 0) + (Number(d.other?.byBracket?.curly) || 0);
              n.otherUnclosed = (n.otherUnclosed ?? 0) + (Number(d.other?.unclosed) || 0);
              return n;
            });
            if (Array.isArray(d.fingerprints?.differ)) setFpDiffer((x) => [...x, ...d.fingerprints.differ.filter((r: unknown) => typeof r === 'string')]);
            if (Array.isArray(d.display)) setDisplay((x) => [...x, ...d.display]);
            part = d.next && Number.isInteger(d.next.page) && Number.isInteger(d.next.skip) ? { page: d.next.page, skip: d.next.skip } : null;
          } else {
            setErrors((x) => [...x, `surah ${s} page ${part!.page}: ${d.status ?? r.status}${d.kind ? ' (' + d.kind + ')' : ''}${d.missing ? ' ' + d.missing.join(', ') : ''}`]);
            part = null;
          }
        } catch {
          setErrors((x) => [...x, `surah ${s} page ${part!.page}: network`]);
          part = null;
        }
      }
      setDone((x) => [...x, s]);
      if (s < b) await new Promise((res) => setTimeout(res, PART_PAUSE_MS));
    }
    setState('finished');
  }

  const save = (body: string, type: string, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div data-quote-check>
      <fieldset data-qc-work>
        <legend>Work</legend>
        <label><input type="radio" name="qc-work" value="ar" checked={work === 'ar'} disabled={state === 'running'} onChange={() => pick('ar')} data-qc-work-ar /> Arabic (TAFSIR_ID)</label>{' '}
        <label><input type="radio" name="qc-work" value="en" checked={work === 'en'} disabled={state === 'running'} onChange={() => pick('en')} data-qc-work-en /> English (TAFSIR_EN_ID, RQ-007)</label>
      </fieldset>
      <p>
        <label>From surah <input value={from} onChange={(e) => setFrom(e.target.value)} size={4} inputMode="numeric" dir="ltr" data-qc-from /></label>{' '}
        <label>to <input value={to} onChange={(e) => setTo(e.target.value)} size={4} inputMode="numeric" dir="ltr" data-qc-to /></label>{' '}
        <button type="button" className="btn" data-qc-run disabled={state === 'running'} onClick={() => void run()}>Run the check</button>{' '}
        <button type="button" className="btn" disabled={state !== 'running'} onClick={() => { stop.current = true; }}>Stop</button>{' '}
        <button type="button" className="btn" data-qc-json disabled={!list.length} onClick={() => save(JSON.stringify({ check: 'D-084', work: ran?.work ?? work, tafsirId: ran?.id ?? null, made: new Date().toISOString(), counts, list, errors }, null, 1), 'application/json', ran?.work === 'en' ? `rifq-d084-list-${tag}.json` : 'rifq-d084-reviewer-list.json')}>Download JSON</button>{' '}
        <button type="button" className="btn" data-qc-csv disabled={!list.length} onClick={() => save(reviewCsv(list), 'text/csv;charset=utf-8', ran?.work === 'en' ? `rifq-d084-list-${tag}.csv` : 'rifq-d084-reviewer-list.csv')}>Download CSV</button>
      </p>
      <p role="status" data-qc-progress>Surahs checked: {done.length} ({state}). Requests: <span data-qc-requests>{counts.requests ?? 0}</span>.{ran && <> Work: <span data-qc-ran>{ran.work === 'en' ? 'English' : 'Arabic'}{ran.id === null ? '' : `, ID ${ran.id}`}</span>.</>}</p>
      <table>
        <tbody>
          <tr><th scope="row">Passages</th><td data-qc-passages>{counts.passages ?? 0}</td></tr>
          <tr><th scope="row">Phrases found</th><td data-qc-phrases>{counts.phrases ?? 0}</td></tr>
          {RESULTS.map((k) => <tr key={k}><th scope="row">{k}</th><td data-qc-count={k}>{counts[k] ?? 0}</td></tr>)}
          <tr><th scope="row">Of the matches: edge matches (D-088)</th><td data-qc-edge>{counts.edge ?? 0}</td></tr>
          <tr><th scope="row">In braces (qiraah_or_quote)</th><td data-qc-braces>{counts.braces ?? 0}</td></tr>
          <tr><th scope="row">Errors</th><td data-qc-errors>{errors.length}</td></tr>
          {CLASSES.map(([k, label]) => <tr key={k}><th scope="row">Reader display {k}: {label}</th><td data-qc-display={k}>{counts['d' + k] ?? 0}</td></tr>)}
          {ran?.work === 'en' && <>
            <tr><th scope="row">Bracketed phrases with no Arabic letters (counted, not listed, not restyled; RQ-007 AC17, AC34)</th><td data-qc-other>{counts.otherPhrases ?? 0}</td></tr>
            <tr><th scope="row">Of those: in ( )</th><td data-qc-other-round>{counts.otherRound ?? 0}</td></tr>
            <tr><th scope="row">Of those: in ornate parentheses</th><td data-qc-other-ornate>{counts.otherOrnate ?? 0}</td></tr>
            <tr><th scope="row">Of those: in {'{ }'}</th><td data-qc-other-curly>{counts.otherCurly ?? 0}</td></tr>
            <tr><th scope="row">Of those: unclosed</th><td data-qc-other-unclosed>{counts.otherUnclosed ?? 0}</td></tr>
          </>}
          <tr><th scope="row">D-079 fingerprints checked</th><td data-qc-fp-checked>{counts.fpChecked ?? 0}</td></tr>
          <tr><th scope="row">D-079 fingerprint same</th><td data-qc-fp-same>{counts.fpSame ?? 0}</td></tr>
          <tr><th scope="row">D-079 fingerprint differs (still shown to readers)</th><td data-qc-fp-differ>{fpDiffer.length}</td></tr>
        </tbody>
      </table>
      {fpDiffer.length > 0 && <p data-qc-fp-list>Fingerprint differs at: <span dir="ltr">{fpDiffer.join(', ')}</span></p>}
      <h2>AC31: compare with the reader display</h2>
      <p>Asks /api/tafseer for the first ayah of each passage checked above, one request every 1.1 seconds, and compares its display classes with the ones worked out here. Each request may fetch from the API.</p>
      <p>
        <button type="button" className="btn" data-qc-compare disabled={!display.length || cmp.state === 'running' || state === 'running'} onClick={() => void compare()}>Compare with the reader display</button>{' '}
        <button type="button" className="btn" disabled={cmp.state !== 'running'} onClick={() => { stop.current = true; }}>Stop comparing</button>
      </p>
      <p role="status" data-qc-compare-status>Passages compared: {cmp.done} of {display.length} ({cmp.state}). Agree: <span data-qc-agree>{cmp.agree}</span>. Differ: <span data-qc-differ>{cmp.differ.length}</span>. Errors: <span data-qc-cmp-errors>{cmp.errors}</span>.</p>
      {cmp.differ.length > 0 && <table data-qc-differ-list><thead><tr><th scope="col">Passage</th><th scope="col">This check</th><th scope="col">/api/tafseer</th></tr></thead><tbody>{cmp.differ.map((x) => <tr key={x.ref}><td dir="ltr">{x.ref}</td><td dir="ltr">{x.check}</td><td dir="ltr">{x.api}</td></tr>)}</tbody></table>}
      {errors.length > 0 && <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {list.length > 0 && (
        <>
          <h2>Reviewer list: {list.length}</h2>
          <table data-qc-list>
            <thead><tr><th scope="col">Ayah</th><th scope="col">Passage range</th><th scope="col">Bracket</th><th scope="col">Label</th><th scope="col">Phrase as delivered</th><th scope="col">Letters only</th><th scope="col">Result</th><th scope="col">Matched form</th></tr></thead>
            <tbody>{list.map((r, i) => (
              <tr key={i} data-qc-row={r.result}>
                <td dir="ltr">{r.ref}</td><td dir="ltr">{r.range}</td><td dir="ltr">{r.bracket}</td><td>{r.label}</td>
                <td lang="ar" dir="rtl" translate="no">{r.phrase}</td><td lang="ar" dir="rtl" translate="no">{r.letters}</td><td>{r.result}{r.unclosed ? ' (unclosed)' : ''}</td><td>{r.form ?? ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
