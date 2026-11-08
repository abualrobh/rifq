// D-084 development page island. It asks RIFQ's own Worker to run the quote check one surah at a
// time, with a pause between surahs, shows the counts and the reviewer list, and offers the list as
// JSON or CSV made in the browser. Nothing is stored or sent anywhere else. The phrases are Tafseer
// text exactly as delivered; they are shown as plain text (no markup is ever interpreted).
import { useRef, useState } from 'react';
import { reviewCsv, type CsvRow as ReviewItem } from '../../core/review-csv.ts';

// Proposal: 1 second between surahs, as on the text check page.
const SURAH_PAUSE_MS = 1000;
const RESULTS = ['matched_own_ayah', 'matched_same_surah', 'matched_elsewhere', 'unmatched', 'too_short', 'fragment'] as const;

export default function QuoteCheck({ surahs }: { surahs: number }) {
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('2');
  const [list, setList] = useState<ReviewItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState('idle');
  const [done, setDone] = useState<number[]>([]);
  const stop = useRef(false);

  async function run() {
    const a = Math.max(1, Math.min(surahs, Number(from) || 1)), b = Math.max(a, Math.min(surahs, Number(to) || a));
    stop.current = false;
    setList([]); setCounts({}); setErrors([]); setDone([]); setState('running');
    for (let s = a; s <= b; s++) {
      if (stop.current) { setState('stopped'); return; }
      try {
        const r = await fetch('/api/dev/quote-check', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s }) });
        const d = await r.json();
        if (r.status === 200 && Array.isArray(d.list)) {
          setList((x) => [...x, ...d.list]);
          setCounts((c) => {
            const n = { ...c };
            n.phrases = (n.phrases ?? 0) + d.summary.phrases;
            n.braces = (n.braces ?? 0) + d.summary.braces;
            n.passages = (n.passages ?? 0) + d.passages;
            n.edge = (n.edge ?? 0) + (d.summary.edgeMatches ?? 0);
            for (const k of RESULTS) n[k] = (n[k] ?? 0) + (d.summary.byResult[k] ?? 0);
            return n;
          });
        } else setErrors((x) => [...x, `surah ${s}: ${d.status ?? r.status}${d.kind ? ' (' + d.kind + ')' : ''}${d.missing ? ' ' + d.missing.join(', ') : ''}`]);
      } catch {
        setErrors((x) => [...x, `surah ${s}: network`]);
      }
      setDone((x) => [...x, s]);
      if (s < b) await new Promise((res) => setTimeout(res, SURAH_PAUSE_MS));
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
      <p>
        <label>From surah <input value={from} onChange={(e) => setFrom(e.target.value)} size={4} inputMode="numeric" dir="ltr" data-qc-from /></label>{' '}
        <label>to <input value={to} onChange={(e) => setTo(e.target.value)} size={4} inputMode="numeric" dir="ltr" data-qc-to /></label>{' '}
        <button type="button" className="btn" data-qc-run disabled={state === 'running'} onClick={() => void run()}>Run the check</button>{' '}
        <button type="button" className="btn" disabled={state !== 'running'} onClick={() => { stop.current = true; }}>Stop</button>{' '}
        <button type="button" className="btn" data-qc-json disabled={!list.length} onClick={() => save(JSON.stringify({ check: 'D-084', made: new Date().toISOString(), counts, list, errors }, null, 1), 'application/json', 'rifq-d084-reviewer-list.json')}>Download JSON</button>{' '}
        <button type="button" className="btn" data-qc-csv disabled={!list.length} onClick={() => save(reviewCsv(list), 'text/csv;charset=utf-8', 'rifq-d084-reviewer-list.csv')}>Download CSV</button>
      </p>
      <p role="status" data-qc-progress>Surahs checked: {done.length} ({state}).</p>
      <table>
        <tbody>
          <tr><th scope="row">Passages</th><td data-qc-passages>{counts.passages ?? 0}</td></tr>
          <tr><th scope="row">Phrases found</th><td data-qc-phrases>{counts.phrases ?? 0}</td></tr>
          {RESULTS.map((k) => <tr key={k}><th scope="row">{k}</th><td data-qc-count={k}>{counts[k] ?? 0}</td></tr>)}
          <tr><th scope="row">Of the matches: edge matches (D-088)</th><td data-qc-edge>{counts.edge ?? 0}</td></tr>
          <tr><th scope="row">In braces (qiraah_or_quote)</th><td data-qc-braces>{counts.braces ?? 0}</td></tr>
          <tr><th scope="row">Errors</th><td data-qc-errors>{errors.length}</td></tr>
        </tbody>
      </table>
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
