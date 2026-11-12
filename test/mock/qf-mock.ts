// Mock of the Quran Foundation endpoints RIFQ uses, for tests only. It follows the shapes in the
// Content API reference as read on 2026-11-08 (see src/worker/qf.ts). It is NOT the real API: real
// responses, error bodies, markup and ranges have not been seen, and may differ.
//
// Every passage here is made-up Latin test text, clearly marked "MOCK", and is NOT Tafseer. The
// only Arabic it ever holds is a short run cut by program from the Quran source given at run time
// (for the D-078 quote tests); this file holds no Arabic and no Quran text.
//
// Use in unit tests: const m = createMockQf({ quran }); pass m.fetch to the Worker.
// Use in e2e tests: node test/mock/qf-mock.ts <port> (reads RIFQ_RECORD for the quote cases),
// bound to 127.0.0.1 only.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const MOCK_CLIENT_ID = 'mock-client-id';
export const MOCK_CLIENT_SECRET = 'mock-client-secret-made-up';
export const MOCK_TAFSIR_ID = 901;
// A second made-up work whose by_ayah answer has the other plausible shape (see parseByAyah).
export const MOCK_SHAPE_B_ID = 906;
export const PRELIVE_SURAHS = new Set([1, 2]);
// Ayat in surah 2 with special behaviour.
export const CASE = {
  grouped: [3, 4, 5], hostile: 6, none: 7, error500: 8, rate429: 9, slow: 10,
  quoteExact: 11, quoteAltered: 12, changed: 13, reviewed: 14,
  // D-084 cases, every phrase cut from the source by program (see passageText).
  quoteSameSurah: 15, quoteElsewhere: 16, quoteUnmatched: 17, braces: 18, tooShort: 19, wasla: 27, apiAlef: 28,
} as const;
// Ornate parentheses, written as escapes (the public-repository check allows no Arabic-block
// characters outside the strings file).
export const OPEN = '\ufd3f', CLOSE = '\ufd3e';

type Quran = { list: { sora: number; aya_no: number; aya_text: string }[] };
type Opts = { quran?: Quran; expiresIn?: number; slowMs?: number; now?: () => number; noAudioScope?: boolean; arCatalogueFails?: boolean; counts?: number[]; audioOverride?: (id: number, s: number, file: Record<string, unknown>) => Record<string, unknown> };

// The ayah text without the no-break space and number stored at its end (D-068).
export function bareAyah(t: string): string { return t.replace(/\u00a0[\u0660-\u0669\u06f0-\u06f90-9]+$/u, ''); }

// A short run of words cut from the source ayah s:a, by program (never typed or generated).
export function quoteFrom(q: Quran | undefined, s: number, a: number): string | null {
  const x = q?.list.find((y) => y.sora === s && y.aya_no === a);
  if (!x) return null;
  return bareAyah(x.aya_text).split(' ').slice(0, 3).join(' ');
}

// The same run with one byte-level change made by program: the first combining mark is removed,
// or, if there is none, one letter is swapped for the next code point.
export function alter(s: string): string {
  const m = /[\u064b-\u0652]/u.exec(s);
  if (m) return s.slice(0, m.index) + s.slice(m.index + 1);
  const cp = s.codePointAt(0)!;
  return String.fromCodePoint(cp + 1) + s.slice(String.fromCodePoint(cp).length);
}

export function passageText(id: number, s: number, a: number, q?: Quran, version = 2): string | null {
  if (s === 2 && a === CASE.none) return null;
  if (s === 2 && (CASE.grouped as readonly number[]).includes(a)) return `<p>MOCK GROUPED PASSAGE 2:${CASE.grouped[0]}-2:${CASE.grouped[2]} for tafsir ${id}. Not Tafseer: made-up test text.</p>`;
  if (s === 2 && a === CASE.hostile) {
    return `<p>MOCK HOSTILE 2:${a} <b>bold</b> <img src="https://example.invalid/x.png" onerror="window.__pwned=1"> <script>window.__pwned=2</script>`
      + `<a href="javascript:window.__pwned=3">link words</a> <iframe src="https://example.invalid/f"></iframe> &amp; &lt;tag&gt; `
      + `<span style="color:red" onclick="window.__pwned=4">styled words</span> <svg onload="window.__pwned=5"><text>svg words</text></svg></p>`
      + `<style>body{display:none}</style><p>second paragraph &#x41;&#66;</p>`;
  }
  // D-084 quote cases. 11: own words in ornate parentheses, as stored. 12: own words in ( ) with
  // every vowel mark removed and an Arabic-Indic ayah number inside (plain spelling, as observed in
  // Jalalayn). 15: words of 2:20 (same surah). 16: words of 1:2 (another surah). 17: own words with
  // every letter shifted one code point (cannot match). 18: a qira'ah in braces (one own word) and
  // braces around shifted letters. 19: one word from 2:20 alone (too short). 27: own words with
  // the first plain alef written as alef wasla (Uthmani style). 28: see below.
  const D084 = [CASE.quoteExact, CASE.quoteAltered, CASE.quoteSameSurah, CASE.quoteElsewhere, CASE.quoteUnmatched, CASE.braces, CASE.tooShort, CASE.wasla, CASE.apiAlef] as number[];
  if (s === 2 && D084.includes(a)) {
    const own = quoteFrom(q, 2, a);
    if (own === null) return `<p>MOCK QUOTE 2:${a} (no source given). Not Tafseer.</p>`;
    const plain = (x: string) => x.replace(/[\u064b-\u0652\u0670]/gu, '');
    const shift = (x: string) => [...x].map((c) => (/[\u0628-\u0639]/u.test(c) ? String.fromCodePoint(c.codePointAt(0)! + 1) : c)).join('');
    let body = '';
    if (a === CASE.quoteExact) body = `${OPEN}${own}${CLOSE}`;
    else if (a === CASE.quoteAltered) body = `(${plain(own)} ${String.fromCodePoint(0x662)})`;
    else if (a === CASE.quoteSameSurah) body = `(${quoteFrom(q, 2, 20)})`;
    else if (a === CASE.quoteElsewhere) body = `(${quoteFrom(q, 1, 2)})`;
    else if (a === CASE.quoteUnmatched) body = `(${shift(own)})`;
    else if (a === CASE.braces) body = `{${own.split(' ')[0]}} and {${shift(own.split(' ')[0])}}`;
    else if (a === CASE.tooShort) body = `(${(quoteFrom(q, 2, 20) ?? '').split(' ')[0]})`;
    else if (a === CASE.wasla) body = `(${own.replace('\u0627', '\u0671')})`;
    // 28: own words in ornate parentheses with a superscript alef written the way the real API
    // writes it (HAIR SPACE + U+0670 + WORD JOINER), after the first letter of the first word.
    else if (a === CASE.apiAlef) body = `${OPEN}${[...own][0]}\u200a\u0670\u2060${[...own].slice(1).join('')}${CLOSE}`;
    return `<p>MOCK QUOTE 2:${a} before ${body} after. Not Tafseer.</p>`;
  }
  if (s === 2 && a === CASE.changed) return `<p>MOCK PASSAGE 2:${a} version ${version}. Not Tafseer.</p>`;
  return `<p>MOCK PASSAGE ${s}:${a} for tafsir ${id}. Not Tafseer: made-up test text.</p>`;
}

const LIST = [
  { id: MOCK_TAFSIR_ID, name: 'Mock Arabic Tafsir A', author_name: 'Mock Author A', slug: 'mock-ar-a', language_name: 'arabic', translated_name: { name: 'Mock Arabic Tafsir A', language_name: 'english' } },
  { id: 902, name: 'Mock Arabic Tafsir B <script>window.__pwned=6</script>', author_name: 'Mock Author B', slug: 'mock-ar-b', language_name: 'arabic', translated_name: { name: 'Mock B', language_name: 'english' } },
  { id: 903, name: 'Mock English Tafsir C', author_name: 'Mock Author C', slug: 'mock-en-c', language_name: 'english', translated_name: { name: 'Mock C', language_name: 'english' } },
  // Answers by_ayah in "shape B": the passage once at tafsir.text, verses with no text.
  { id: MOCK_SHAPE_B_ID, name: 'Mock Arabic Tafsir D (shape B)', author_name: 'Mock Author D', slug: 'mock-ar-d', language_name: 'arabic', translated_name: { name: 'Mock D', language_name: 'english' } },
  // Made-up entries for the D-076 catalogue highlight. These IDs are NOT Quran Foundation IDs.
  { id: 904, name: 'Mock Tafsir Ibn Kathir (made up)', author_name: 'Mock author', slug: 'mock-ibn-kathir', language_name: 'arabic', translated_name: { name: 'Mock', language_name: 'english' } },
  { id: 905, name: 'Mock English edition', author_name: 'Mock Ibn Katheer', slug: 'mock-en-ik', language_name: 'english', translated_name: { name: 'Mock', language_name: 'english' } },
];

const err = (status: number, type: string) => new Response(JSON.stringify({ message: `mock ${type}`, type, success: false }), { status, headers: { 'content-type': 'application/json' } });
// RQ-006 mock data. The IDs match D-111 so the page's chosen rows can be tested; names are made up.
export const AUDIO_CASE = { full: 7, incomplete: 2, noTimestamps: 6, forbidden: 9, notInPrelive: 4, signed: 97, negative: 161, notListed: 161 } as const;
// Names carry the D-111 surname part RIFQ looks for (src/core/audio.ts), so the offered-reciter
// rules can be tested; everything else about them is made up.
export const MOCK_RECITER_NAMES: Record<number, string> = { 7: 'MOCK Afasy', 2: 'MOCK Abdul Basit', 6: 'MOCK Husary', 9: 'MOCK Minshawi', 4: 'MOCK Shatri', 97: 'MOCK Dossari', 1: 'MOCK Reciter 1 <b>x</b>' };
export const RECITERS = [7, 2, 6, 9, 4, 97, 1].map((id) => ({ id, reciter_id: 500 + id, name: MOCK_RECITER_NAMES[id], beta: false, style: { name: 'Murattal', language_name: 'english' }, qirat: { name: 'Hafs', language_name: 'english' }, translated_name: { name: MOCK_RECITER_NAMES[id], language_name: 'english' } }));
// Arabic-language catalogue values: a made-up name per ID (letters plus the ID digits), and Arabic
// words for the style and riwayah, as code points.
export const AR_WORD = (id: number) => String.fromCodePoint(0x645, 0x642, 0x631, 0x626) + ' ' + id;
export const AR_STYLE = String.fromCodePoint(0x645, 0x631, 0x62a, 0x644);
export const AR_QIRAT = String.fromCodePoint(0x62d, 0x641, 0x635);
// Mock audio files: 128 kbit/s, on the approved host. The e2e tests answer these addresses with a
// made-up silent file through Playwright, so no request leaves the machine.
export const MOCK_AUDIO_PATH = '/mock-rifq-test';
export const mockAudioUrl = (id: number, s: number) => `https://download.quranicaudio.com${MOCK_AUDIO_PATH}/${id}/${s}.mp3`;
export const RECITATIONS = [{ id: 1, reciter_name: 'MOCK Recitation One', style: 'Murattal', translated_name: { name: 'MOCK One', language_name: 'english' } }, { id: 2, reciter_name: 'MOCK Recitation Two', style: 'Mujawwad', translated_name: { name: 'MOCK Two', language_name: 'english' } }];
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

export function createMockQf(opts: Opts = {}) {
  const now = opts.now ?? Date.now;
  const tokens = new Map<string, number>(); // token -> expiry (ms)
  const tokenScope = new Map<string, string>();
  const state = {
    mode: 'normal' as 'normal' | 'down' | 'rate',
    tokenRequests: 0, contentRequests: 0, listRequests: 0, audioRequests: 0,
    tokenBodies: [] as string[],
    contentHeaderNames: [] as string[][],
    paths: [] as string[],
  };
  let n = 0;
  const ayahCount = (s: number) => opts.counts?.[s] ?? opts.quran?.list.filter((x) => x.sora === s).length ?? 0;

  // One surah audio file, per AUDIO_CASE. Timestamps are made-up times; segments are made-up
  // word triplets. MOCK_SIGNATURE stands for a token in a signed URL and must never reach a page.
  function audioFile(id: number, s: number, segments: boolean): Response {
    if (!RECITERS.some((x) => x.id === id) && id !== AUDIO_CASE.notListed) return err(404, 'not_found');
    if (id === AUDIO_CASE.forbidden) return err(403, 'forbidden');
    if (id === AUDIO_CASE.notInPrelive && s === 2) return err(404, 'not_found');
    if (!PRELIVE_SURAHS.has(s)) return err(404, 'not_found');
    const n = ayahCount(s);
    let ts: { verse_key: string; timestamp_from: number; timestamp_to: number; duration: number; segments?: number[][] }[] = Array.from({ length: n }, (_, i) => ({
      verse_key: `${s}:${i + 1}`, timestamp_from: i * 5000, timestamp_to: i * 5000 + 4900, duration: 4900, ...(segments ? { segments: [[1, i * 5000, i * 5000 + 900]] } : {}),
    }));
    if (id === AUDIO_CASE.incomplete && s === 2) ts = ts.slice(0, -1);
    if (id === AUDIO_CASE.negative) ts[0] = { ...ts[0], duration: -1 };
    const url = id === AUDIO_CASE.signed ? `${mockAudioUrl(id, s)}?token=MOCK_SIGNATURE&expires=1` : mockAudioUrl(id, s);
    const file: Record<string, unknown> = { id: id * 1000 + s, chapter_id: s, file_size: n * 5000 * 16, format: 'mp3', audio_url: url, duration: id === AUDIO_CASE.negative ? null : n * 5000, ...(id === AUDIO_CASE.noTimestamps ? {} : { timestamps: ts }) };
    state.audioRequests++;
    return ok({ audio_file: opts.audioOverride ? opts.audioOverride(id, s, file) : file });
  }

  async function handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === '/__mock/mode' && req.method === 'POST') { state.mode = ((await req.json()) as { mode: typeof state.mode }).mode; return ok({ mode: state.mode }); }
    if (u.pathname === '/__mock/stats') return ok(state);
    if (u.pathname === '/__mock/revoke' && req.method === 'POST') { tokens.clear(); return ok({ revoked: true }); }
    if (u.pathname === '/oauth2/token') {
      state.tokenRequests++;
      if (req.method !== 'POST') return err(405, 'invalid_request');
      const body = await req.text();
      state.tokenBodies.push(body);
      const auth = req.headers.get('authorization') ?? '';
      const want = 'Basic ' + Buffer.from(`${MOCK_CLIENT_ID}:${MOCK_CLIENT_SECRET}`).toString('base64');
      if (auth !== want) return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401, headers: { 'content-type': 'application/json' } });
      const p = new URLSearchParams(body);
      if (p.get('grant_type') !== 'client_credentials') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      const scope = p.get('scope') ?? '';
      if (scope !== 'content.tafsirs.read' && scope !== 'content.quran.read' && !(scope === 'content.audio.read' && !opts.noAudioScope)) return new Response(JSON.stringify({ error: 'invalid_scope' }), { status: 400 });
      const tok = `mock-token-${++n}`;
      const exp = opts.expiresIn ?? 3600;
      tokens.set(tok, now() + exp * 1000);
      tokenScope.set(tok, scope);
      return ok({ access_token: tok, token_type: 'bearer', expires_in: exp, scope });
    }
    if (!u.pathname.startsWith('/content/api/v4/')) return err(404, 'invalid_path');
    state.contentRequests++;
    state.paths.push(u.pathname + u.search);
    state.contentHeaderNames.push([...req.headers.keys()].sort());
    const tok = req.headers.get('x-auth-token') ?? '';
    const exp = tokens.get(tok);
    if (req.headers.get('x-client-id') !== MOCK_CLIENT_ID || exp === undefined || exp <= now()) return err(401, 'invalid_token');
    if (state.mode === 'down') return err(503, 'service_unavailable');
    if (state.mode === 'rate') return err(429, 'rate_limit_exceeded');
    const path = u.pathname.slice('/content/api/v4'.length);
    const audio = path.startsWith('/chapter_recitations/') || path === '/resources/chapter_reciters' || path === '/resources/recitations';
    const needs = path.startsWith('/verses/') ? 'content.quran.read' : audio ? 'content.audio.read' : 'content.tafsirs.read';
    if (tokenScope.get(tok) !== needs) return err(403, 'insufficient_scope');
    // D-081: /verses/by_chapter/{n}?fields=text_qpc_hafs. Text is cut by program from the Quran
    // source given at run time, with fixed changes on surah 1 to test every category:
    // 1:1 as stored (with the number ending), 1:2 ending cut, 1:3 ending written with an ASCII
    // space, 1:4 one mark removed, 1:5 field missing; every other ayah with the ending cut.
    const vm = /^\/verses\/by_chapter\/(\d+)$/.exec(path);
    if (vm) {
      const s = Number(vm[1]);
      if (!PRELIVE_SURAHS.has(s) || !opts.quran) return err(404, 'not_found');
      const all = opts.quran.list.filter((x) => x.sora === s);
      const per = Math.min(50, Math.max(1, Number(u.searchParams.get('per_page') ?? '10')));
      const page = Math.max(1, Number(u.searchParams.get('page') ?? '1'));
      const want = (u.searchParams.get('fields') ?? '').split(',');
      const total = Math.ceil(all.length / per);
      const verses = all.slice((page - 1) * per, page * per).map((x, i) => {
        const bare = bareAyah(x.aya_text);
        const t = s === 1 && x.aya_no === 1 ? x.aya_text : s === 1 && x.aya_no === 3 ? x.aya_text.replace('\u00a0', ' ') : s === 1 && x.aya_no === 4 ? alter(bare) : bare;
        return { id: 90000 + i, verse_number: x.aya_no, verse_key: `${s}:${x.aya_no}`, ...(want.includes('text_qpc_hafs') && !(s === 1 && x.aya_no === 5) ? { text_qpc_hafs: t } : {}) };
      });
      return ok({ verses, pagination: { per_page: per, current_page: page, next_page: page < total ? page + 1 : null, total_pages: total, total_records: all.length } });
    }
    if (path === '/resources/tafsirs') { state.listRequests++; return ok({ tafsirs: LIST }); }
    // RQ-006 /dev/reciters/ checks. Made-up names; the IDs are the D-111 IDs so the page's chosen
    // list can be tested, and each one shows a different case (see AUDIO_CASE).
    // With language=ar the mock answers as QF may: style, qirat, name and translated name in Arabic
    // (made-up words written as code points; only strings.ts may hold Arabic characters).
    if (path === '/resources/chapter_reciters' && opts.arCatalogueFails && u.searchParams.get('language') === 'ar') return err(503, 'service_unavailable');
    if (path === '/resources/chapter_reciters') return ok({ reciters: u.searchParams.get('language') === 'ar' ? RECITERS.map((r) => ({ ...r, name: AR_WORD(r.id), style: { name: AR_STYLE, language_name: 'arabic' }, qirat: { name: AR_QIRAT, language_name: 'arabic' }, translated_name: { name: AR_WORD(r.id), language_name: 'arabic' } })) : RECITERS });
    if (path === '/resources/recitations') return ok({ recitations: RECITATIONS });
    const am = /^\/chapter_recitations\/(\d+)\/(\d+)$/.exec(path);
    if (am) return audioFile(Number(am[1]), Number(am[2]), u.searchParams.get('segments') === 'true');
    let m = /^\/tafsirs\/(\d+)\/by_ayah\/(\d+):(\d+)$/.exec(path);
    if (m) {
      const [id, s, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!LIST.some((x) => x.id === id)) return err(404, 'not_found');
      if (!PRELIVE_SURAHS.has(s)) return err(404, 'not_found');
      if (s === 2 && a === CASE.error500) return err(500, 'internal_server_error');
      if (s === 2 && a === CASE.rate429) return err(429, 'rate_limit_exceeded');
      if (s === 2 && a === CASE.slow) await new Promise((r) => setTimeout(r, opts.slowMs ?? 8000));
      const text = passageText(id, s, a, opts.quran);
      const rec = (t: string) => ({ id: 70000 + a, resource_id: id, resource_name: LIST.find((x) => x.id === id)!.name, language_id: 0, slug: 'mock', translated_name: { name: 'Mock', language_name: 'english' }, text: t, ...(u.searchParams.get('fields')?.includes('language_name') ? { language_name: LIST.find((x) => x.id === id)!.language_name } : {}) });
      const groupKeys = s === 2 && (CASE.grouped as readonly number[]).includes(a) ? CASE.grouped.map((x) => `2:${x}`) : [`${s}:${a}`];
      if (id === MOCK_SHAPE_B_ID) {
        const meta = LIST.find((x) => x.id === id)!;
        const verses: Record<string, unknown> = {};
        groupKeys.forEach((k, i) => { verses[k] = { id: 60000 + a + i }; });
        return ok({ tafsir: { verses, resource_id: id, resource_name: meta.name, language_id: 0, slug: meta.slug, translated_name: { name: 'Mock D', language_name: 'english' }, text: text ?? '', ...(u.searchParams.get('fields')?.includes('language_name') ? { language_name: meta.language_name } : {}) } });
      }
      const verses: Record<string, unknown> = {};
      if (text !== null) {
        const keys = s === 2 && (CASE.grouped as readonly number[]).includes(a) ? CASE.grouped.map((x) => `2:${x}`) : [`${s}:${a}`];
        for (const k of keys) verses[k] = rec(text);
      }
      return ok({ tafsir: { verses } });
    }
    m = /^\/tafsirs\/(\d+)\/by_chapter\/(\d+)$/.exec(path);
    if (m) {
      const [id, s] = [Number(m[1]), Number(m[2])];
      if (!PRELIVE_SURAHS.has(s) || !opts.quran) return err(404, 'not_found');
      const ayat = opts.quran.list.filter((x) => x.sora === s).map((x) => x.aya_no);
      const per = Math.min(50, Math.max(1, Number(u.searchParams.get('per_page') ?? '10')));
      const page = Math.max(1, Number(u.searchParams.get('page') ?? '1'));
      const slice = ayat.slice((page - 1) * per, page * per);
      const items = slice.map((a) => ({ a, t: passageText(id, s, a, opts.quran) })).filter((x) => x.t !== null)
        .map((x) => ({ id: 80000 + x.a, resource_id: id, verse_id: 0, language_id: 0, text: x.t, language_name: 'arabic', resource_name: 'mock', verse_key: `${s}:${x.a}`, chapter_id: s, verse_number: x.a, slug: 'mock' }));
      const total = Math.ceil(ayat.length / per);
      return ok({ tafsirs: items, pagination: { per_page: per, current_page: page, next_page: page < total ? page + 1 : null, total_pages: total, total_records: ayat.length } });
    }
    return err(404, 'invalid_path');
  }

  const fetchFn = (input: string, init: RequestInit = {}) => {
    const { signal, ...rest } = init;
    const p = handle(new Request(input, rest));
    if (!signal) return p;
    return new Promise<Response>((res, rej) => {
      if (signal.aborted) return rej(new Error('aborted'));
      signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
      p.then(res, rej);
    });
  };
  return { handle, fetch: fetchFn, state, tokens };
}

// Node server for the e2e tests and the local kit check, on 127.0.0.1 only.
export async function startMockServer(port: number, opts: Opts = {}) {
  const m = createMockQf(opts);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const r = await m.handle(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { server, mock: m };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? '8815');
  let quran: Quran | undefined;
  if (process.env.RIFQ_RECORD) {
    const { loadSource } = await import('../../src/core/source-adapter.ts');
    quran = loadSource(process.env.RIFQ_RECORD);
  }
  await startMockServer(port, { quran, slowMs: Number(process.env.MOCK_SLOW_MS ?? '8000') });
  process.stdout.write(`mock QF on 127.0.0.1:${port}\n`);
}
