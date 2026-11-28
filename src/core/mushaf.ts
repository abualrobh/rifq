// RQ-009 v0.3 (D-286, kit v43): page reading mode, flowing text. Pure TypeScript, shared by the
// build (Node) and the browser. No Quran text here: pages are lists of references.
//
// Page boundaries come from the `page` field of the approved file (today the D-045 development
// copy, not yet approved, D-192). AC7 and AC49: the build stops, naming the page or ayah, if an ayah
// has no page or one outside 1 to 604, if pages go down in Quran order, or if a page has no ayah.
// The browser gets only the first ayah of each page (pageStarts, 604 numbers), from which it works
// out the page of any ayah (pageOf).

export const PAGES = 604;
export type PageRef = { s: number; a: number };
type HasPage = { sora: number; aya_no: number; page?: number; jozz?: number };

// Every page's ayat, in Quran order (index 0 unused). Throws with the page or ayah named.
export function pagesOf<T extends HasPage>(list: readonly T[]): T[][] {
  const pages: T[][] = Array.from({ length: PAGES + 1 }, () => []);
  let prev = 0;
  for (const x of list) {
    const p = x.page;
    if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > PAGES) throw new Error(`page mode: ayah ${x.sora}:${x.aya_no} has no page from 1 to ${PAGES}`);
    if ((p as number) < prev) throw new Error(`page mode: page goes down at ayah ${x.sora}:${x.aya_no} (${prev} -> ${p})`);
    prev = p as number;
    pages[p as number].push(x);
  }
  for (let p = 1; p <= PAGES; p++) if (!pages[p].length) throw new Error(`page mode: page ${p} has no ayah`);
  return pages;
}

// The first ayah of each page, packed as s * 1000 + a (index 0 unused: 0).
export function pageStarts<T extends HasPage>(pages: readonly T[][]): number[] {
  return [0, ...pages.slice(1).map((p) => p[0].sora * 1000 + p[0].aya_no)];
}

// The page holding ayah s:a, from the page starts (binary search); 0 when starts are missing.
export function pageOf(starts: readonly number[], s: number, a: number): number {
  const k = s * 1000 + a;
  let lo = 1, hi = starts.length - 1, ans = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (starts[m] <= k) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}
export const startOf = (starts: readonly number[], p: number): PageRef | null => (p >= 1 && p < starts.length ? { s: Math.floor(starts[p] / 1000), a: starts[p] % 1000 } : null);

// The juz of a page's first and last ayah (AC9: two juz on pages 121 and 502 in the development file).
export function pageJuz<T extends HasPage>(items: readonly T[]): [number, number] {
  const js = items.map((x) => x.jozz).filter((j): j is number => Number.isInteger(j));
  return js.length ? [js[0], js[js.length - 1]] : [0, 0];
}

// One surah part of a page: the ayat of one surah on it, and whether the surah starts on this page.
export function partsOf<T extends HasPage>(items: readonly T[]): { s: number; starts: boolean; items: T[] }[] {
  const out: { s: number; starts: boolean; items: T[] }[] = [];
  for (const x of items) {
    let last = out[out.length - 1];
    if (!last || last.s !== x.sora) { last = { s: x.sora, starts: x.aya_no === 1, items: [] }; out.push(last); }
    last.items.push(x);
  }
  return out;
}

// Ayah runs per page for one surah: the page of each ayah as "page:count" runs (reader pages carry
// this so the early script can open the right Mushaf page before the first paint, AC25).
export function surahPageRuns<T extends HasPage>(items: readonly T[]): string {
  const out: string[] = [];
  let p = -1, n = 0;
  for (const x of items) {
    if (x.page === p) { n++; continue; }
    if (n) out.push(`${p}:${n}`);
    p = x.page as number; n = 1;
  }
  if (n) out.push(`${p}:${n}`);
  return out.join(',');
}

// Addresses (D-282 A): /page/N/ and /en/page/N/; the ayah on a Mushaf page is #mS-A, its Tafseer
// panel #mS-A;tafseer.
export const mushafPath = (lang: 'ar' | 'en', p: number) => `${lang === 'en' ? '/en' : ''}/page/${p}/`;
export const mushafHash = (s: number, a: number, tafseer = false) => `#m${s}-${a}${tafseer ? ';tafseer' : ''}`;
export const MUSHAF_HASH = /^#m(\d{1,3})-(\d{1,3})(;tafseer)?$/;
export const MUSHAF_PATH = /^\/(?:en\/)?page\/(\d{1,3})\/$/;
