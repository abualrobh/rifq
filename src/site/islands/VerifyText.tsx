// D-081 development page island. It asks RIFQ's own Worker to check one surah at a time, with a
// pause between surahs, and shows counts and the references that differ. It never receives or
// shows any Quran text: only references, categories and SHA-256 hashes. Results stay in this tab
// until Hamzeh downloads them as JSON (made in the browser, never sent anywhere or stored).
import { useRef, useState } from 'react';

type Row = { ref: string; result: string; api: string | null; full: string; bare: string };
// Proposal: 1 second between surahs (114 requests, about 2 to 4 minutes in all).
const SURAH_PAUSE_MS = 1000;

export default function VerifyText({ surahs }: { surahs: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [done, setDone] = useState(0);
  const [state, setState] = useState<'idle' | 'running' | 'stopped' | 'finished'>('idle');
  const [errors, setErrors] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const stop = useRef(false);

  async function run() {
    stop.current = false;
    setRows([]); setErrors([]); setExtra([]); setDone(0); setState('running');
    for (let s = 1; s <= surahs; s++) {
      if (stop.current) { setState('stopped'); return; }
      try {
        const r = await fetch('/api/dev/verify-text', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ s }) });
        const d = await r.json();
        if (r.status === 200 && Array.isArray(d.rows)) { setRows((x) => [...x, ...d.rows]); if (d.extra?.length) setExtra((x) => [...x, ...d.extra]); }
        else setErrors((x) => [...x, `surah ${s}: ${d.status ?? r.status}${d.kind ? ' (' + d.kind + ')' : ''}${d.missing ? ' ' + d.missing.join(', ') : ''}`]);
      } catch {
        setErrors((x) => [...x, `surah ${s}: network`]);
      }
      setDone(s);
      if (s < surahs) await new Promise((res) => setTimeout(res, SURAH_PAUSE_MS));
    }
    setState('finished');
  }

  const count = (k: string) => rows.filter((r) => r.result === k).length;
  const differ = rows.filter((r) => r.result === 'differs' || r.result === 'missing');
  const download = () => {
    const blob = new Blob([JSON.stringify({ check: 'D-081', field: 'text_qpc_hafs', made: new Date().toISOString(), rows: rows.map(({ ref, result, api, full, bare }) => ({ ref, result, apiSha256: api, ourSha256WithNumber: full, ourSha256WithoutNumber: bare })), extra, errors }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rifq-d081-text-check.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div data-verify>
      <p>
        <button type="button" className="btn" data-verify-run disabled={state === 'running'} onClick={() => void run()}>Run the check</button>{' '}
        <button type="button" className="btn" data-verify-stop disabled={state !== 'running'} onClick={() => { stop.current = true; }}>Stop</button>{' '}
        <button type="button" className="btn" data-verify-download disabled={!rows.length} onClick={download}>Download JSON (references and hashes)</button>
      </p>
      <p role="status" data-verify-progress>Surahs checked: {done} of {surahs} ({state}).</p>
      <table>
        <tbody>
          <tr><th scope="row">Ayat checked</th><td data-v-total>{rows.length}</td></tr>
          <tr><th scope="row">Same bytes, with the ayah-number ending</th><td data-v-same-with>{count('same_with_number')}</td></tr>
          <tr><th scope="row">Same bytes, API has no number ending</th><td data-v-same-without>{count('same_without_number')}</td></tr>
          <tr><th scope="row">Same words, number ending written differently</th><td data-v-number-form>{count('same_text_number_form')}</td></tr>
          <tr><th scope="row">Differ</th><td data-v-differs>{count('differs')}</td></tr>
          <tr><th scope="row">Missing from the API</th><td data-v-missing>{count('missing')}</td></tr>
          <tr><th scope="row">In the API but not in RIFQ's file</th><td data-v-extra>{extra.length}</td></tr>
          <tr><th scope="row">Errors</th><td data-v-errors>{errors.length}</td></tr>
        </tbody>
      </table>
      {differ.length > 0 && <><h2>References that differ or are missing</h2><p dir="ltr" data-v-refs>{differ.map((r) => `${r.ref} (${r.result})`).join(', ')}</p></>}
      {extra.length > 0 && <p dir="ltr">Extra references: {extra.join(', ')}</p>}
      {errors.length > 0 && <><h2>Errors</h2><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
    </div>
  );
}
