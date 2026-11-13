// Development page GET /dev/reciters/ (RQ-006 audio, D-110 to D-118): checks, from RIFQ's own
// Quran Foundation account, which reciters and timing data the API gives, before the audio
// feature is built. It exists only in development builds with the password gate on, like
// /dev/tafseer-catalogue/. Plain HTML with no script.
//
// API paths used (Content API v4, under /content/api/v4), and where each was read (2026-11-12):
// - GET /resources/chapter_reciters (?language=en): the list of chapter reciters (surah audio).
//   Fields id, reciter_id, name, beta, style {name, language_name}, qirat {name, language_name},
//   translated_name: https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/chapter-reciters/
// - GET /resources/recitations (?language=en): the ayah-by-ayah recitations. Fields id,
//   reciter_name, style, translated_name {name, language_name}:
//   https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/recitations/
// - GET /chapter_recitations/{reciter_id}/{chapter_number}?segments=true: one surah's audio file.
//   Fields audio_file {id, chapter_id, file_size (bytes), format, audio_url, duration (ms, may be
//   null), timestamps [{verse_key, timestamp_from, timestamp_to, duration, segments}]}; timestamps
//   are "present when timing data is available":
//   https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/chapter-reciter-audio-file/
// - All three take the granular scope content.audio.read (legacy content.read): the operation
//   catalogue generated from Quran Foundation's API specs in their SDK (github.com/quran/api-js,
//   packages/api/src/generated/specs/operation-catalog.json, main branch, read 2026-11-12), because
//   the reference pages do not state the scope. Paths for the two lists are from the same file.
// Nothing here has been run against the real API.
//
// What the page shows: reciter and recitation names as the API gives them (escaped), and for each
// chosen reciter and surah whether the call worked, the audio host name only (never the full URL,
// which may carry a signature), whether the URL has a query string, format, size, duration and
// whether per-ayah timestamps are present and complete. No audio is played, fetched or stored; no
// Quran text is shown; word segments are counted, never shown. Errors are shown plainly, with the
// HTTP status and the API's error type. Credentials and tokens stay in qf.ts; nothing is logged.
import { escapeHtml } from '../core/highlight.ts';
import { CONTENT_PREFIX, qfConfig, QfClient, QfError, TIMEOUT_MS, type QfConfig, type QfSecrets } from './qf.ts';

export const RECITERS_PATH = '/dev/reciters/';
export const AUDIO_SCOPE = 'content.audio.read';
// D-111, in order (Mishary Rashid Alafasy is the default): chapter-reciter IDs from the public
// quran.com v4 list (12 Nov). This page is how they are confirmed against RIFQ's own catalogue.
export const CHOSEN_RECITERS = [7, 2, 6, 9, 4, 97, 161] as const;
export const CHECK_SURAHS = [1, 2] as const;
export const CHAPTER_RECITERS_PATH = '/resources/chapter_reciters';
export const RECITATIONS_PATH = '/resources/recitations';
export const chapterAudioPath = (reciter: number, s: number) => `/chapter_recitations/${reciter}/${s}`;

type FetchFn = (u: string, i: RequestInit) => Promise<Response>;
type Deps = { fetch?: FetchFn; timeoutMs?: number; client?: QfClient };
export type RecitersCfg = { dev: boolean; counts?: number[] };

// A call's outcome: the JSON, or a plain error with the HTTP status and the API's error type.
type Got = { ok: true; data: unknown } | { ok: false; status: number | null; reason: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export type ChapterReciter = { id: number; reciterId: number | null; name: string | null; style: string | null; qirat: string | null; beta: boolean | null };
export function parseChapterReciters(j: unknown): ChapterReciter[] | null {
  const a = obj(j)?.reciters;
  if (!Array.isArray(a)) return null;
  return a.flatMap((x) => {
    const o = obj(x);
    const id = num(o?.id);
    if (!o || id === null) return [];
    return [{ id, reciterId: num(o.reciter_id), name: str(o.name), style: str(obj(o.style)?.name), qirat: str(obj(o.qirat)?.name), beta: typeof o.beta === 'boolean' ? o.beta : null }];
  });
}

export type Recitation = { id: number; reciterName: string | null; style: string | null; translated: string | null };
export function parseRecitations(j: unknown): Recitation[] | null {
  const a = obj(j)?.recitations;
  if (!Array.isArray(a)) return null;
  return a.flatMap((x) => {
    const o = obj(x);
    const id = num(o?.id);
    if (!o || id === null) return [];
    return [{ id, reciterName: str(o.reciter_name), style: str(o.style), translated: str(obj(o.translated_name)?.name) }];
  });
}

export type TimingCheck = { present: boolean; count: number; expected: number | null; complete: boolean; problems: string[]; withSegments: number; negative: number };
export type AudioCheck = { host: string | null; hasQuery: boolean; format: string | null; fileSize: number | null; duration: number | null; timing: TimingCheck };

// Reads one audio_file answer. The URL is reduced to its host name here and never kept whole.
export function checkAudioFile(j: unknown, s: number, expected: number | null): AudioCheck | null {
  const f = obj(obj(j)?.audio_file);
  if (!f) return null;
  let host: string | null = null, hasQuery = false;
  const u = str(f.audio_url);
  if (u) { try { const p = new URL(u); host = p.host; hasQuery = p.search.length > 1; } catch { host = null; } }
  const ts = f.timestamps;
  const problems: string[] = [];
  let count = 0, withSegments = 0, negative = 0, complete = false;
  const present = Array.isArray(ts);
  if (present) {
    const list = ts as unknown[];
    count = list.length;
    let prevTo = -1, inOrder = true;
    list.forEach((x, i) => {
      const o = obj(x);
      const key = str(o?.verse_key), from = num(o?.timestamp_from), to = num(o?.timestamp_to), d = num(o?.duration);
      if (key !== `${s}:${i + 1}`) inOrder = false;
      if (from === null || to === null || to < from) problems.push(`entry ${i + 1}: start or end missing or end before start`);
      else if (from < prevTo) problems.push(`entry ${i + 1}: starts before the previous one ends`);
      if (to !== null) prevTo = to;
      if (d !== null && d < 0) negative++;
      if (Array.isArray(o?.segments)) withSegments++;
    });
    if (!inOrder) problems.push('verse keys are not exactly ' + `${s}:1 to ${s}:${count}` + ' in order');
    if (expected !== null && count !== expected) problems.push(`${count} entries for ${expected} ayat`);
    complete = expected !== null && count === expected && problems.length === 0;
  }
  return { host, hasQuery, format: str(f.format), fileSize: num(f.file_size), duration: num(f.duration), timing: { present, count, expected, complete, problems: problems.slice(0, 5), withSegments, negative } };
}

export function makeReciters(cfg: RecitersCfg, deps: Deps = {}) {
  const fetchFn: FetchFn = deps.fetch ?? ((u, i) => fetch(u, i));
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const qf = deps.client ?? new QfClient(deps.fetch, Date.now, timeoutMs);

  // One GET with the content.audio.read token. A 401 clears the token and retries once (Quick
  // Start). The error type from the API's error body is kept (a short word such as "forbidden");
  // the message is not shown.
  async function get(q: QfConfig, path: string, query: Record<string, string> = {}): Promise<Got> {
    const qs = new URLSearchParams(query).toString();
    const url = q.apiBase + CONTENT_PREFIX + path + (qs ? '?' + qs : '');
    for (let attempt = 0; attempt < 2; attempt++) {
      let tok: string;
      try { tok = await qf.accessToken(q, AUDIO_SCOPE); } catch (e) {
        const k = e instanceof QfError ? e.kind : 'unavailable';
        return { ok: false, status: null, reason: k === 'auth' ? `token refused for scope ${AUDIO_SCOPE} (the account may not have this scope)` : `token request failed (${k})` };
      }
      let r: Response;
      try {
        r = await fetchFn(url, { method: 'GET', headers: { 'x-auth-token': tok, 'x-client-id': q.clientId, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      } catch { return { ok: false, status: null, reason: 'no answer (network error or timeout)' }; }
      if (r.status === 401 && attempt === 0) { await r.body?.cancel(); qf.clearToken(AUDIO_SCOPE); continue; }
      if (!r.ok) {
        let type = '';
        try { const t = str(obj(await r.json())?.type); if (t && /^[a-z_]{1,40}$/.test(t)) type = t; } catch { /* no JSON body */ }
        const why = r.status === 403 ? 'forbidden (scope or access missing)' : r.status === 404 ? 'not found (for example not available in pre-live)' : r.status === 429 ? 'rate limited' : r.status === 401 ? 'not authorised' : 'refused or failed';
        return { ok: false, status: r.status, reason: why + (type ? `, type "${type}"` : '') };
      }
      try { return { ok: true, data: await r.json() }; } catch { return { ok: false, status: r.status, reason: 'answer is not JSON' }; }
    }
    return { ok: false, status: 401, reason: 'not authorised' };
  }

  // extra: HTML added at the end of the page (the temporary RQ-006 player-check section).
  async function page(env: QfSecrets, extra = ''): Promise<{ status: number; html: string }> {
    const h = escapeHtml;
    const head = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DEVELOPMENT PAGE: Reciters and timing - RIFQ</title><link rel="stylesheet" href="/rifq-basic.css"></head>
<body><p class="banner" role="note">DEVELOPMENT PAGE. Private, for Hamzeh only, to confirm D-111 before RQ-006 audio is built. Not part of RIFQ, not reviewed, not for release. No audio is played or stored here.</p><main>
<h1>Reciters and timing data from the Quran Foundation API</h1>`;
    const foot = '</main></body></html>';
    const q = qfConfig(env, cfg.dev);
    if ('missing' in q) return { status: 503, html: `${head}<p role="alert">Not configured. Missing Worker settings: ${h(q.missing.join(', '))}.</p>${foot}` };
    const err = (g: Got & { ok: false }) => `<span class="msg" role="alert" data-error>Failed${g.status !== null ? ` (HTTP ${g.status})` : ''}: ${h(g.reason)}.</span>`;
    const cell = (v: string | number | null) => (v === null ? '<em>not given</em>' : h(String(v)));

    const [cr, rc] = await Promise.all([get(q, CHAPTER_RECITERS_PATH, { language: 'en' }), get(q, RECITATIONS_PATH, { language: 'en' })]);
    const reciters = cr.ok ? parseChapterReciters(cr.data) : null;
    const recitations = rc.ok ? parseRecitations(rc.data) : null;
    const byId = new Map((reciters ?? []).map((x) => [x.id, x]));

    const checks = await Promise.all(CHOSEN_RECITERS.flatMap((id) => CHECK_SURAHS.map(async (s) => {
      const g = await get(q, chapterAudioPath(id, s), { segments: 'true' });
      const expected = cfg.counts && s < cfg.counts.length ? cfg.counts[s] : null;
      return { id, s, g, a: g.ok ? checkAudioFile(g.data, s, expected) : null };
    })));

    const mins = (ms: number | null) => (ms === null ? null : `${ms} ms (${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')})`);
    const audioRows = checks.map(({ id, s, g, a }) => {
      const r = byId.get(id);
      const lead = `<td>${id}</td><td>${r ? h(r.name ?? 'not stated') : '<em>not in the list</em>'}</td><td>${s}</td>`;
      if (!g.ok) return `<tr data-audio="${id}:${s}" data-ok="no">${lead}<td colspan="6">${err(g)}</td></tr>`;
      if (!a) return `<tr data-audio="${id}:${s}" data-ok="no">${lead}<td colspan="6"><span class="msg" role="alert" data-error>The answer has no audio_file.</span></td></tr>`;
      const t = a.timing;
      const timing = !t.present ? '<strong data-timing="none">No timestamps</strong>'
        : t.complete ? `<span data-timing="complete">Complete: ${t.count} of ${t.expected}</span>`
        : `<strong data-timing="incomplete">Incomplete: ${t.count}${t.expected !== null ? ` of ${t.expected}` : ''}</strong>${t.problems.length ? ` (${h(t.problems.join('; '))})` : ''}`;
      const extra = t.present ? `<br>Word segments on ${t.withSegments} of ${t.count} entries (counted, not shown).${t.negative ? ` ${t.negative} negative durations.` : ''}` : '';
      return `<tr data-audio="${id}:${s}" data-ok="yes">${lead}<td>Works</td><td data-host>${cell(a.host)}${a.hasQuery ? '<br><em data-signed>URL has a query string (possibly signed; not shown)</em>' : ''}</td><td>${cell(a.format)}</td><td>${a.fileSize === null ? '<em>not given</em>' : `${h(String(a.fileSize))} bytes`}</td><td>${a.duration === null ? '<em>not given</em>' : h(mins(a.duration)!)}</td><td>${timing}${extra}</td></tr>`;
    }).join('');

    const chosenRows = CHOSEN_RECITERS.map((id, i) => {
      const r = byId.get(id);
      return `<tr data-chosen="${id}"><td>${i + 1}${i === 0 ? ' (default)' : ''}</td><td>${id}</td><td>${r ? h(r.name ?? 'not stated') : `<strong data-missing>${reciters ? 'Not in this account\'s list' : 'List not available'}</strong>`}</td><td>${r ? cell(r.style) : ''}</td><td>${r ? cell(r.qirat) : ''}</td><td>${r?.reciterId ?? ''}</td></tr>`;
    }).join('');

    const listTable = reciters
      ? `<table data-chapter-reciters><thead><tr><th scope="col">ID</th><th scope="col">Reciter ID</th><th scope="col">Name</th><th scope="col">Style</th><th scope="col">Qirat</th><th scope="col">Beta</th></tr></thead><tbody>${reciters.map((x) => `<tr${CHOSEN_RECITERS.includes(x.id as never) ? ' class="match"' : ''}><td>${x.id}</td><td>${x.reciterId ?? ''}</td><td>${cell(x.name)}</td><td>${cell(x.style)}</td><td>${cell(x.qirat)}</td><td>${x.beta === null ? '' : x.beta ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table>`
      : cr.ok ? '<p class="msg" role="alert" data-error>The answer has no reciters list.</p>' : `<p>${err(cr)}</p>`;
    const recTable = recitations
      ? `<table data-recitations><thead><tr><th scope="col">ID</th><th scope="col">Reciter name</th><th scope="col">Style</th><th scope="col">Translated name</th></tr></thead><tbody>${recitations.map((x) => `<tr><td>${x.id}</td><td>${cell(x.reciterName)}</td><td>${cell(x.style)}</td><td>${cell(x.translated)}</td></tr>`).join('')}</tbody></table>`
      : rc.ok ? '<p class="msg" role="alert" data-error>The answer has no recitations list.</p>' : `<p>${err(rc)}</p>`;

    return { status: 200, html: `${head}
<p>API environment: <strong>${h(q.env)}</strong>. Scope asked for: <code>${AUDIO_SCOPE}</code>. Pre-live data may cover only surahs 1 and 2. Every value is shown as the API returns it on this page load; nothing is stored. This page makes ${2 + checks.length} API calls each time it is opened.</p>
<h2>D-111 reciters in this account's chapter-reciter list</h2>
<table data-chosen-table><thead><tr><th scope="col">Order</th><th scope="col">Chapter-reciter ID</th><th scope="col">Name</th><th scope="col">Style</th><th scope="col">Qirat</th><th scope="col">Reciter ID</th></tr></thead><tbody>${chosenRows}</tbody></table>
<p>D-118 needs Hafs and D-111 needs Murattal: check the style and qirat columns. IDs come from the public quran.com list and are confirmed only if they appear here with the expected name.</p>
<h2>Surah audio files and per-ayah timestamps (surahs 1 and 2)</h2>
<p>D-110 needs complete per-ayah timestamps: one entry per ayah, in order. The ayah count is from the approved Quran file. The audio address is reduced to its host name.</p>
<table data-audio-table><thead><tr><th scope="col">Chapter-reciter ID</th><th scope="col">Name</th><th scope="col">Surah</th><th scope="col">Call</th><th scope="col">Audio host</th><th scope="col">Format</th><th scope="col">File size</th><th scope="col">Duration</th><th scope="col">Per-ayah timestamps</th></tr></thead><tbody>${audioRows}</tbody></table>
<h2>All chapter reciters (<code>${CHAPTER_RECITERS_PATH}</code>)${reciters ? `: ${reciters.length}` : ''}</h2>
${listTable}
<h2>Ayah-by-ayah recitations (<code>${RECITATIONS_PATH}</code>)${recitations ? `: ${recitations.length}` : ''}</h2>
<p>These IDs are a different list from the chapter-reciter IDs and are not used for surah audio.</p>
${recTable}
${extra}
${foot}` };
  }

  return { page };
}
