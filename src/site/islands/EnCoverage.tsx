// RQ-007 open questions 1 and 2 (kit v34, development page /dev/tafseer-en-coverage/): which ayat of
// the chosen surahs the English work (TAFSIR_EN_ID) has a passage for, which range each passage
// covers, and how many bracketed phrases each passage has with and without Arabic letters (P-11),
// by bracket kind. Numbers only: the Worker sends no text and no hash of any text, and this page
// shows none. It asks RIFQ's own Worker for one small part of a surah at a time (about 10 ayat a
// request, as /dev/quote-check/ does), one request every 1.1 seconds, under the 60-a-minute Tafseer
// limit, and counts the requests it made. Nothing is stored or sent anywhere else.
// Kit v35: also the mixed phrases (Arabic and other letters, QA v34 FIND-AS), the empty bracketed
// phrases and the count of the sign U+FDFA (in passages and inside phrases), all numbers only.
import { useRef, useState } from 'react';

const PART_PAUSE_MS = 1100;
type Br = { round: number; ornate: number; curly: number };
type P = { from: number; to: number; chars: number; arabicPhrases: number; otherPhrases: number; arabicByBracket: Br; otherByBracket: Br; unclosed: number; square: number; hasArabicLetters: boolean; mixedPhrases?: number; emptyPhrases?: number; signInPhrases?: number; sign?: number };
type Row = { s: number; a: number; p: P | null };

export default function EnCoverage({ counts }: { counts: number[] }) {
  const surahs = counts.length - 1;
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('2');
  const [state, setState] = useState('idle');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [req, setReq] = useState({ worker: 0, api: 0 });
  const [id, setId] = useState<number | null>(null);
  const stop = useRef(false);

  async function run() {
    const a = Math.max(1, Math.min(surahs, Number(from) || 1)), b = Math.max(a, Math.min(surahs, Number(to) || a));
    stop.current = false;
    setRows([]); setErrors([]); setReq({ worker: 0, api: 0 }); setId(null); setState('running');
    let worker = 0, api = 0;
    for (let s = a; s <= b; s++) {
      const got: P[] = [];
      let part: { page: number; skip: number } | null = { page: 1, skip: 0 };
      let failed = false;
      while (part) {
        if (stop.current) { setState('stopped'); return; }
        if (worker) await new Promise((res) => setTimeout(res, PART_PAUSE_MS));
        worker++;
        try {
          const r: Response = await fetch('/api/dev/tafseer-coverage', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s, page: part.page, skip: part.skip }) });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d: any = await r.json();
          if (r.status === 200 && Array.isArray(d.passages)) {
            api += Number(d.pages) || 0;
            if (Number.isInteger(d.tafsirId)) setId(d.tafsirId);
            got.push(...d.passages);
            part = d.next && Number.isInteger(d.next.page) && Number.isInteger(d.next.skip) ? { page: d.next.page, skip: d.next.skip } : null;
          } else {
            setErrors((x) => [...x, `surah ${s} page ${part!.page}: ${d.status ?? r.status}${d.kind ? ' (' + d.kind + ')' : ''}${d.missing ? ' ' + d.missing.join(', ') : ''}`]);
            part = null; failed = true;
          }
        } catch {
          setErrors((x) => [...x, `surah ${s} page ${part!.page}: network`]);
          part = null; failed = true;
        }
        setReq({ worker, api });
      }
      // One row per ayah of the surah: the passage that covers it, or none.
      const out: Row[] = [];
      for (let n = 1; n <= counts[s]; n++) out.push({ s, a: n, p: got.find((p) => n >= p.from && n <= p.to) ?? null });
      if (!failed) setRows((x) => [...x, ...out]);
    }
    setState('finished');
  }

  const passages = new Map<string, Row>();
  for (const r of rows) if (r.p) passages.set(`${r.s}:${r.p.from}-${r.p.to}`, r);
  const ps = [...passages.values()].map((r) => r.p!);
  const sum = (f: (p: P) => number) => ps.reduce((n, p) => n + f(p), 0);
  const withPassage = rows.filter((r) => r.p).length;
  const lens = ps.map((p) => p.chars).sort((x, y) => x - y);
  const median = lens.length ? (lens.length % 2 ? lens[(lens.length - 1) / 2] : (lens[lens.length / 2 - 1] + lens[lens.length / 2]) / 2) : 0;

  return (
    <div data-en-coverage>
      <p>
        <label>From surah <input value={from} onChange={(e) => setFrom(e.target.value)} size={4} inputMode="numeric" dir="ltr" data-cov-from /></label>{' '}
        <label>to <input value={to} onChange={(e) => setTo(e.target.value)} size={4} inputMode="numeric" dir="ltr" data-cov-to /></label>{' '}
        <button type="button" className="btn" data-cov-run disabled={state === 'running'} onClick={() => void run()}>Run the coverage check</button>{' '}
        <button type="button" className="btn" disabled={state !== 'running'} onClick={() => { stop.current = true; }}>Stop</button>
      </p>
      <p role="status" data-cov-progress>State: <span data-cov-state>{state}</span>. Requests to RIFQ's Worker: <span data-cov-requests>{req.worker}</span>. API pages the Worker read for them: <span data-cov-api>{req.api}</span> (plus a token request when the Worker has none). English work ID: <span data-cov-id>{id ?? 'not known yet'}</span>.</p>
      <table>
        <tbody>
          <tr><th scope="row">Ayat checked</th><td data-cov-ayat>{rows.length}</td></tr>
          <tr><th scope="row">Ayat with a passage</th><td data-cov-with>{withPassage}</td></tr>
          <tr><th scope="row">Ayat with no passage</th><td data-cov-without>{rows.length - withPassage}</td></tr>
          <tr><th scope="row">Passages</th><td data-cov-passages>{ps.length}</td></tr>
          <tr><th scope="row">Passages covering more than one ayah</th><td data-cov-multi>{ps.filter((p) => p.to > p.from).length}</td></tr>
          <tr><th scope="row">Passage length in characters: shortest, median, longest</th><td data-cov-lengths>{lens.length ? `${lens[0]}, ${median}, ${lens[lens.length - 1]}` : ''}</td></tr>
          <tr><th scope="row">Passages with any Arabic letters</th><td data-cov-with-arabic>{ps.filter((p) => p.hasArabicLetters).length}</td></tr>
          <tr><th scope="row">Bracketed phrases with Arabic letters (D-149 display applies)</th><td data-cov-ar>{sum((p) => p.arabicPhrases)}</td></tr>
          <tr><th scope="row">Of those: in ( ), ornate parentheses, {'{ }'}</th><td data-cov-ar-br>{`${sum((p) => p.arabicByBracket.round)}, ${sum((p) => p.arabicByBracket.ornate)}, ${sum((p) => p.arabicByBracket.curly)}`}</td></tr>
          <tr><th scope="row">Of those: mixed, with letters of another script too (Latin, ...; kit v35)</th><td data-cov-mixed>{sum((p) => p.mixedPhrases ?? 0)}</td></tr>
          <tr><th scope="row">Bracketed phrases with no Arabic letters (shown as delivered, AC34)</th><td data-cov-other>{sum((p) => p.otherPhrases)}</td></tr>
          <tr><th scope="row">Of those: in ( ), ornate parentheses, {'{ }'}</th><td data-cov-other-br>{`${sum((p) => p.otherByBracket.round)}, ${sum((p) => p.otherByBracket.ornate)}, ${sum((p) => p.otherByBracket.curly)}`}</td></tr>
          <tr><th scope="row">Unclosed brackets (either kind)</th><td data-cov-unclosed>{sum((p) => p.unclosed)}</td></tr>
          <tr><th scope="row">Empty bracketed phrases: nothing but spaces between the brackets (kit v35)</th><td data-cov-empty>{sum((p) => p.emptyPhrases ?? 0)}</td></tr>
          <tr><th scope="row">Sign U+FDFA (sallallahu alayhi wa sallam): in passages, of which inside bracketed phrases (kit v35)</th><td data-cov-sign>{`${sum((p) => p.sign ?? 0)}, ${sum((p) => p.signInPhrases ?? 0)}`}</td></tr>
          <tr><th scope="row">Square brackets [ (not checked by RIFQ)</th><td data-cov-square>{sum((p) => p.square)}</td></tr>
          <tr><th scope="row">Errors</th><td data-cov-errors>{errors.length}</td></tr>
        </tbody>
      </table>
      {errors.length > 0 && <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {rows.length > 0 && (
        <>
          <h2>Per ayah</h2>
          <table data-cov-table>
            <thead><tr><th scope="col">Ayah</th><th scope="col">Passage</th><th scope="col">Range covered</th><th scope="col">Characters</th><th scope="col">Phrases with Arabic letters</th><th scope="col">Phrases with none</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.s}:${r.a}`} data-cov-row={`${r.s}:${r.a}`} data-cov-has={r.p ? 'yes' : 'no'}>
                <td dir="ltr">{r.s}:{r.a}</td><td>{r.p ? 'yes' : 'no'}</td><td dir="ltr">{r.p ? `${r.s}:${r.p.from}-${r.p.to}` : ''}</td><td>{r.p?.chars ?? ''}</td><td>{r.p?.arabicPhrases ?? ''}</td><td>{r.p?.otherPhrases ?? ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
