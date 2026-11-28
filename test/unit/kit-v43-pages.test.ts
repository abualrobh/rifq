// Kit v43 (part 2), unit level: RQ-009 v0.3 page mode (D-286). Made-up references only; no Quran text
// and no Arabic characters (the page keyword comes from strings.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mushafHash, mushafPath, MUSHAF_HASH, pageJuz, pageOf, pagesOf, pageStarts, partsOf, startOf, surahPageRuns, PAGES } from '../../src/core/mushaf.ts';
import { gotoResults } from '../../src/core/goto.ts';
import { STRINGS, t } from '../../src/core/strings.ts';
import { markPageTipSeen, markTipsSeen, pageTipSeen, tipsSeen, clearTipsSeen } from '../../src/core/tips.ts';

// A made-up file: 604 pages of two ayat; a surah every 13 ayat, so some surahs start mid-page.
const fake = () => { const out: { sora: number; aya_no: number; page: number; jozz: number }[] = []; const n: Record<number, number> = {}; let i = 0; for (let p = 1; p <= PAGES; p++) for (let k = 0; k < 2; k++) { const s = 1 + Math.floor(i++ / 13); n[s] = (n[s] ?? 0) + 1; out.push({ sora: s, aya_no: n[s], page: p, jozz: 1 + Math.floor((p - 1) / 20) }); } return out; };

test('AC7, AC49: pagesOf keeps every ayah once in order and stops naming the page or ayah', () => {
  const list = fake();
  const pages = pagesOf(list);
  assert.equal(pages.length, PAGES + 1);
  assert.equal(pages.slice(1).flat().length, list.length);
  assert.deepEqual(pages.slice(1).flat(), list);
  assert.throws(() => pagesOf(list.map((x, i) => (i === 10 ? { ...x, page: 0 } : x))), /ayah \d+:\d+ has no page/);
  assert.throws(() => pagesOf(list.map((x, i) => (i === 10 ? { ...x, page: 999 } : x))), /has no page from 1 to 604/);
  assert.throws(() => pagesOf(list.map((x, i) => (i === 11 ? { ...x, page: 1 } : x))), /page goes down at ayah/);
  assert.throws(() => pagesOf(list.filter((x) => x.page !== 300)), /page 300 has no ayah/);
});

test('pageStarts, pageOf, startOf: the first ayah of each page and the page of any ayah', () => {
  const list = fake();
  const st = pageStarts(pagesOf(list));
  assert.equal(st.length, PAGES + 1);
  for (const x of list) assert.equal(pageOf(st, x.sora, x.aya_no), x.page, `${x.sora}:${x.aya_no}`);
  assert.deepEqual(startOf(st, 1), { s: list[0].sora, a: list[0].aya_no });
  assert.equal(startOf(st, 0), null);
  assert.equal(pageOf([], 1, 1), 0);
});

test('partsOf, pageJuz, surahPageRuns, addresses', () => {
  const list = fake();
  const pages = pagesOf(list);
  const p = pages.findIndex((x, i) => i > 0 && new Set(x.map((y) => y.sora)).size > 1);
  const parts = partsOf(pages[p]);
  assert.ok(parts.length >= 2);
  assert.equal(parts[1].starts, true);
  assert.deepEqual(pageJuz(pages[20]), [1, 1]);
  assert.deepEqual(pageJuz(pages[21]), [2, 2]);
  const s1 = list.filter((x) => x.sora === 1);
  assert.equal(surahPageRuns(s1), '1:2,2:2,3:2,4:2,5:2,6:2,7:1');
  assert.equal(mushafPath('ar', 7), '/page/7/');
  assert.equal(mushafPath('en', 7), '/en/page/7/');
  assert.equal(mushafHash(2, 5, true), '#m2-5;tafseer');
  assert.ok(MUSHAF_HASH.test('#m2-5') && MUSHAF_HASH.test('#m2-5;tafseer') && !MUSHAF_HASH.test('#a5'));
});

test('AC23, AC116: Go to page: keyword with or without its article, Arabic-Indic digits, "page N" in English only, out of range, bare number', () => {
  const list = fake();
  const st = pageStarts(pagesOf(list));
  const nS = list[list.length - 1].sora;
  const counts = [0, ...Array.from({ length: nS }, (_, s) => list.filter((x) => x.sora === s + 1).length)];
  const d = (lang: 'ar' | 'en') => ({ lang, folded: counts.map(() => 'made'), en: counts.map(() => ['made', 'up'] as [string, string]), counts, juz: [{ juz: 1, s: 1, a: 1 }], pages: st });
  const kw = t('ar', 'kindPage'), al = String.fromCodePoint(0x627, 0x644);
  for (const lang of ['ar', 'en'] as const) {
    assert.deepEqual(gotoResults(`${kw} 50`, d(lang)).results[0], { kind: 'page', p: 50, ...startOf(st, 50)! });
    assert.equal(gotoResults(`${al}${kw} ${String.fromCodePoint(0x665, 0x660)}`, d(lang)).results[0]?.kind, 'page');
    assert.equal(gotoResults(`${kw} 0`, d(lang)).msg, 'pageMissing');
    assert.equal(gotoResults(`${kw} 605`, d(lang)).msg, 'pageMissing');
    assert.equal(gotoResults('50', d(lang)).results[0]?.kind, 'surah');
  }
  assert.equal(gotoResults('page 50', d('en')).results[0]?.kind, 'page');
  assert.notEqual(gotoResults('page 50', d('ar')).results[0]?.kind, 'page');
  assert.equal(gotoResults(`${kw} 50`, { ...d('ar'), pages: null }).results.find((r) => r.kind === 'page'), undefined);
});

test('AC120: the page tip value shares rifq.tips: "1", "p", "1p"; Show tips again clears both', () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
  assert.equal(pageTipSeen(st).seen, false);
  assert.ok(markPageTipSeen(st)); assert.equal(m.get('rifq.tips'), 'p'); assert.equal(tipsSeen(st).seen, false);
  assert.ok(markTipsSeen(st)); assert.equal(m.get('rifq.tips'), '1p'); assert.equal(tipsSeen(st).seen, true); assert.equal(pageTipSeen(st).seen, true);
  m.set('rifq.tips', '1'); assert.ok(markPageTipSeen(st)); assert.equal(m.get('rifq.tips'), '1p');
  assert.ok(clearTipsSeen(st)); assert.equal(tipsSeen(st).seen, false); assert.equal(pageTipSeen(st).seen, false);
});

test('RQ-009 strings: 23 new keys in both tables, gotoLabel changed to name pages; placeholders match', () => {
  const NEW = ['readingView', 'viewScroll', 'viewPages', 'readingViewHelp', 'toPages', 'toScroll', 'mushafPage', 'mushafPageName', 'pageTurned', 'mushafGoPage', 'pageJuzTwo', 'kindPage', 'gotoPageSub', 'pageMissing', 'pageNumberDev', 'tipPagesTitle', 'tipPagesBody', 'playingOnPage', 'pageNavLabel', 'swipeHint', 'pageNextShort', 'pagePrevShort', 'pageSurahTitle'];
  assert.equal(NEW.length, 23);
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of NEW) {
    const a = (STRINGS.ar as Record<string, string>)[k], e = (STRINGS.en as Record<string, string>)[k];
    assert.ok(a && e, k);
    assert.equal(ph(a), ph(e), k);
  }
  assert.equal(STRINGS.en.gotoLabel, 'Go to a surah, ayah, juz or page');
});

test('AC50, AC124: page mode is built in development builds only (source rules of the build and the pages)', async () => {
  const { readFileSync } = await import('node:fs');
  const b = readFileSync(new URL('../../scripts/build.ts', import.meta.url), 'utf8');
  assert.match(b, /const pagesOn = mode !== 'release';/);
  assert.match(b, /process\.env\.RIFQ_PAGE_STARTS = 'null'/);
  assert.match(b, /mushafLeak = !pagesOn && \(existsSync\(join\(outDir, 'site', 'page'\)\)/);
  const d = readFileSync(new URL('../../src/site/lib/data.ts', import.meta.url), 'utf8');
  assert.match(d, /export const pagesOn = dev && process\.env\.RIFQ_PAGES !== 'off';/);
  assert.match(d, /export const mushafPages = pagesOn \? pagesOf\(src\.list\) : \[\];/);
  const v = readFileSync(new URL('../../src/site/client/view.ts', import.meta.url), 'utf8');
  assert.match(v, /export const pagesOn = \(\) => !!STARTS && STARTS\.length === 605;/);
});
